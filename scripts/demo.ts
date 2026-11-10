// Runs the full demo scenario from section 9 with one command.
//   tsx demo.ts --mode local    : Anvil with a SIMULATED controller using a test key. No NEAR needed.
//   tsx demo.ts --mode testnet  : Sepolia, Base Sepolia, Robinhood testnet and NEAR testnet. The hack happens on all three chains,
//                                 the council on NEAR votes in the third chain, then one approval opens the offer on all three.
//   Add --stage to reuse the controller and Pactum contracts in deployments/, so it only costs gas. It creates a new hack
//   and a new offer, then on the main chain stops right after openCase so a viewer can return and claim in the app.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { baseSepolia, foundry, robinhoodTestnet, sepolia } from "viem/chains";
import {
  ONE_TOKEN,
  ROOT,
  artifact,
  buildRefundTree,
  detail,
  formatTokens,
  loadRootEnv,
  step,
  toJson,
  type CaseTerms,
} from "./lib/common.ts";
import {
  accessKeyCount,
  approveChain,
  approveGuardians,
  approveOffer,
  createFaucetAccount,
  createSubAccount,
  richestAccount,
  topUpAccounts,
  deployController,
  deriveEvmAddress,
  expectNearFailure,
  getProposal,
  proposeChain,
  proposeGuardians,
  proposeOffer,
  removeAllAccessKeys,
  retrySignature,
  toNearTerms,
  view,
  voteCancel,
  type NearCredentials,
  type NearProposal,
} from "./lib/near.ts";

type Mode = "local" | "testnet";

const TOTAL_STEPS = 8;
const DERIVATION_PATH = "pactum-1";
const MAX_REWARD_BPS = 2000;
const THRESHOLD = 2;
const HOUR = 3600n;
// Enough to pay storage for a contract of about 205 KB. Proposers pay storage for their own proposals.
const CONTROLLER_DEPOSIT = 3n * 10n ** 24n;

// Anvil's default mnemonic, which everyone knows. Local mode only.
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const anvilAccount = (index: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });

const ALLOCATIONS = [600_000n * ONE_TOKEN, 300_000n * ONE_TOKEN, 100_000n * ONE_TOKEN];
const TOTAL_LOSS = 1_000_000n * ONE_TOKEN;
const OFFER_TEXT = "Keep 10% if the funds come back within 72 hours, or 5% within 7 days. Send everything to the contract and the reward comes back in the same transaction.";

interface Actors {
  deployer: LocalAccount;
  alice: LocalAccount;
  bob: LocalAccount;
  carol: LocalAccount;
  attacker: LocalAccount;
  rewardWallet: Address;
}

// How the controller signature is obtained. This is the only difference between the two modes.
interface ControllerSide {
  label: string;
  address: Address;
  deploy(deployments: { chainId: bigint; pactum: Address }[]): Promise<void>;
  addChain(chainId: bigint, pactum: Address, label: string): Promise<void>;
  // One approval for the whole offer, returning one signature per case in order.
  signOffer(cases: { terms: CaseTerms; digest: Hex }[], evidence: string): Promise<{ signatures: Hex[]; record: Record<string, unknown> }>;
  // Proposes an offer and casts one approval, so the other one can be clicked on the Guardians page.
  proposeForApproval?(cases: { terms: CaseTerms; digest: Hex }[], evidence: string): Promise<{ id: string; record: Record<string, unknown> }>;
  // Rehearses what is only needed in an incident: replacing a guardian, and cancelling a large signed offer.
  drill?(chains: ChainRun[], actors: Actors, tree: ReturnType<typeof buildRefundTree>): Promise<void>;
}

// An EVM chain the demo runs on, with its deployed contracts and the name of its results file.
interface ChainRun {
  network: "local" | "sepolia" | "base-sepolia" | "robinhood-testnet";
  label: string;
  evm: Evm;
  contracts: { MockUSD: Address; VulnerableVault: Address; Pactum: Address; PublicNotes: Address };
  notesBlock: bigint;
}

function parseMode(): Mode {
  const index = process.argv.indexOf("--mode");
  const mode = index >= 0 ? process.argv[index + 1] : "local";
  if (mode !== "local" && mode !== "testnet") throw new Error(`Unknown mode ${mode}`);
  return mode;
}

class Evm {
  readonly publicClient: PublicClient;
  readonly chain: Chain;
  readonly rpc: string;
  readonly txs: Record<string, Hash> = {};

  constructor(chain: Chain, rpc: string) {
    this.chain = chain;
    this.rpc = rpc;
    // Base Sepolia's block format changes viem's types, but the functions used here are the same.
    this.publicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  }

  wallet(account: LocalAccount): WalletClient {
    return createWalletClient({ account, chain: this.chain, transport: http(this.rpc) });
  }

  async deploy(from: LocalAccount, name: string, file: string, args: unknown[]): Promise<Address> {
    const { abi, bytecode } = artifact(name, file);
    const hash = await this.wallet(from).deployContract({ abi, bytecode, args, account: from, chain: this.chain });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deploy of ${name} failed`);
    this.txs[`deploy${name}`] = hash;
    return receipt.contractAddress;
  }

  async send(from: LocalAccount, to: Address, abi: Abi, functionName: string, args: unknown[], label?: string) {
    const hash = await this.wallet(from).sendTransaction({
      account: from,
      chain: this.chain,
      to,
      data: encodeFunctionData({ abi, functionName, args }),
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    if (label) this.txs[label] = hash;
    return receipt;
  }

  async read<T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<T> {
    return (await this.publicClient.readContract({ address, abi, functionName, args })) as T;
  }
}

// Starts a temporary Anvil that stops when the script ends.
async function startAnvil(port: number): Promise<() => void> {
  const child = spawn("anvil", ["--silent", "--port", String(port)], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return () => child.kill();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error("Anvil did not start");
}

function simulatedController(): ControllerSide {
  const account = anvilAccount(9);
  return {
    label: "SIMULATED (local test key, no Chain Signatures)",
    address: account.address,
    async deploy() {},
    async addChain() {},
    async signOffer(cases) {
      detail("controller", "SIMULATED: signing with a local test key, not NEAR");
      return { signatures: await Promise.all(cases.map(({ digest }) => account.sign!({ hash: digest }))), record: { simulated: true } };
    },
  };
}

// Results of the last full run, so --stage can reuse them without deploying anything on NEAR.
function savedRun(network: string) {
  const path = new URL(`deployments/${network}.json`, ROOT);
  if (!existsSync(path)) throw new Error(`deployments/${network}.json not found. Run first: make demo-testnet`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    contracts: { Pactum: Address; PublicNotes: Address };
    notesBlock: string;
    controllerAddress: Address;
    near: { controllerAccount: string; txs: Record<string, string> };
  };
}

// Creates a new controller unless `reuse` is set: then it only calls the existing one, which nobody can change since it has no keys.
async function nearController(reuse: boolean): Promise<ControllerSide> {
  // Guardians are reused between runs. The controller is always new because that account has every key removed.
  const { guardians, stranger } = await loadOrCreateNearAccounts();
  await topUpAccounts([...guardians, stranger], 6n * 10n ** 23n, 10n ** 24n);
  const saved = reuse ? savedRun("sepolia") : undefined;
  // Takes funds from the account with the most NEAR. A parent account has no rights over its sub-accounts.
  const fresh = saved ? undefined : await createSubAccount(await richestAccount([...guardians, stranger]), "ctrl", CONTROLLER_DEPOSIT);
  const controller = { accountId: saved ? saved.near.controllerAccount : fresh!.accountId };
  const address = await deriveEvmAddress(controller.accountId, DERIVATION_PATH);
  if (saved && address.toLowerCase() !== saved.controllerAddress.toLowerCase()) throw new Error(`Saved controller address does not match ${address}`);
  const wasm = readFileSync(new URL(saved ? "deployments/pactum_controller.wasm" : "controller/target/near/pactum_controller.wasm", ROOT));
  // Saves the exact deployed file in the repo so make verify can compare it with the code hash on NEAR.
  if (fresh) {
    mkdirSync(new URL("deployments/", ROOT), { recursive: true });
    writeFileSync(new URL("deployments/pactum_controller.wasm", ROOT), wasm);
  }
  // Keeps the original run's deploy and vote transactions so the interface lists them all.
  const sharedTxs: Record<string, string> = {};
  for (const key of ["deployController", "removeKeys", "proposeChain", "approveChain1", "approveChain2"]) {
    const hash = saved?.near.txs[key];
    if (hash) sharedTxs[key] = hash;
  }
  // The contract may differ from the saved file if the file was edited by hand, so ask the contract itself.
  const requireServed = async (deployments: { chainId: bigint; pactum: Address }[]) => {
    const config = await view<{ deployments: { chain_id: string; pactum: string }[] }>(controller.accountId, "get_config");
    for (const { chainId, pactum } of deployments) {
      const served = config.deployments.some((item) => item.chain_id === chainId.toString() && item.pactum.toLowerCase() === pactum.toLowerCase());
      if (!served) throw new Error(`${controller.accountId} does not serve ${pactum} on chain ${chainId}`);
    }
  };

  // Waits until every case is done, and asks for more signatures while any are unsigned. One transaction signs at most 3.
  const signUntil = async (caller: NearCredentials, id: string, done: (proposal: NearProposal) => boolean) => {
    const txs: string[] = [];
    let proposal = await getProposal(controller.accountId, id);
    for (let attempt = 0; attempt < 120 && !done(proposal); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      proposal = await getProposal(controller.accountId, id);
      if (done(proposal)) break;
      const inFlight = proposal.cases.some((item) => item.status === "Signing" || item.status === "RevokeSigning");
      if (!inFlight) txs.push(await retrySignature(caller, controller.accountId, id));
    }
    if (!done(proposal)) throw new Error(`Signing did not finish for proposal ${id}`);
    return { proposal, txs };
  };

  return {
    label: `Chain Signatures through ${controller.accountId}`,
    address,
    async deploy(deployments) {
      if (!fresh) {
        await requireServed(deployments);
        detail("near contract", `${controller.accountId} (reused, nothing deployed on NEAR)`);
        return;
      }
      sharedTxs.deployController = await deployController(fresh, wasm, {
        guardians: guardians.map((guardian) => guardian.accountId),
        threshold: THRESHOLD,
        deployments,
        derivationPath: DERIVATION_PATH,
        maxRewardBps: MAX_REWARD_BPS,
      });
      sharedTxs.removeKeys = await removeAllAccessKeys(fresh);
      const keys = await accessKeyCount(controller.accountId);
      if (keys !== 0) throw new Error(`Controller still has ${keys} access keys`);
      detail("near contract", `${controller.accountId} (0 access keys left)`);
    },
    // The controller was created without this chain. The council votes it in, and the signing address does not change.
    async addChain(chainId, pactum, label) {
      if (!fresh) {
        await requireServed([{ chainId, pactum }]);
        return;
      }
      const [first, second] = guardians as [NearCredentials, NearCredentials, NearCredentials];
      if (!(await expectNearFailure(stranger, controller.accountId, "propose_chain", { chain_id: chainId.toString(), pactum }, "caller is not a guardian"))) {
        throw new Error("A stranger was able to propose a chain");
      }
      detail("stranger's chain", "rejected on NEAR");
      const { id, txHash } = await proposeChain(first, controller.accountId, chainId, pactum);
      sharedTxs.proposeChain = txHash;
      sharedTxs.approveChain1 = await approveChain(first, controller.accountId, id);
      sharedTxs.approveChain2 = await approveChain(second, controller.accountId, id);
      const again = await deriveEvmAddress(controller.accountId, DERIVATION_PATH);
      if (again !== address) throw new Error(`Signing address changed: ${again}`);
      detail("chain vote", `2 guardians added ${label}, signing address unchanged`);
    },
    async signOffer(cases, evidence) {
      const [first, second] = guardians as [NearCredentials, NearCredentials, NearCredentials];
      const allTerms = cases.map((item) => item.terms);
      for (const { terms, digest } of cases) {
        const onChainDigest = await view<Hex>(controller.accountId, "case_digest", { terms: toNearTerms(terms) });
        if (onChainDigest !== digest) throw new Error(`Digest mismatch: NEAR ${onChainDigest}, EVM ${digest}`);
      }
      detail("digests", `${cases.length} chains, the same on NEAR and EVM`);

      if (!(await expectNearFailure(stranger, controller.accountId, "propose_offer", { cases: allTerms.map(toNearTerms), evidence }, "caller is not a guardian"))) {
        throw new Error("A stranger was able to propose an offer");
      }
      detail("stranger proposal", "rejected on NEAR");

      const { id, txHash } = await proposeOffer(first, controller.accountId, allTerms, evidence);
      const offerTxs: Record<string, string> = { propose: txHash };
      offerTxs.approve1 = await approveOffer(first, controller.accountId, id);
      const pending = await getProposal(controller.accountId, id);
      if (pending.status !== "Pending") throw new Error(`Expected Pending, got ${pending.status}`);
      detail("guardian 1 of 2", `${first.accountId} approved, still ${pending.status}`);

      if (!(await expectNearFailure(stranger, controller.accountId, "on_signed", { proposal_id: id, index: 0 }, "is private"))) {
        throw new Error("A stranger was able to call on_signed");
      }
      detail("forged callback", "rejected on NEAR (#[private])");

      const started = Date.now();
      offerTxs.approve2 = await approveOffer(second, controller.accountId, id);
      detail("guardian 2 of 2", `${second.accountId} approved`);
      // Signatures arrive after the approval transaction. A failed case is signed again; only approved hashes can be signed.
      const { proposal, txs: retries } = await signUntil(first, id, (item) => item.status === "Signed");
      if (retries[0]) offerTxs.retry = retries[0];
      detail("chain signatures", `${cases.length} signatures in ${((Date.now() - started) / 1000).toFixed(1)}s, from one approval round`);
      return {
        signatures: proposal.cases.map((item) => item.signature as Hex),
        record: {
          simulated: false,
          controllerAccount: controller.accountId,
          derivationPath: DERIVATION_PATH,
          guardians: guardians.map((guardian) => guardian.accountId),
          threshold: THRESHOLD,
          proposalId: id,
          txs: { ...sharedTxs, ...offerTxs },
        },
      };
    },
    async proposeForApproval(cases, evidence) {
      const [first] = guardians as [NearCredentials];
      const { id } = await proposeOffer(first, controller.accountId, cases.map((item) => item.terms), evidence);
      await approveOffer(first, controller.accountId, id);
      const record = { simulated: false, controllerAccount: controller.accountId, derivationPath: DERIVATION_PATH, guardians: guardians.map((guardian) => guardian.accountId), threshold: THRESHOLD, proposalId: id, txs: { ...sharedTxs } };
      return { id, record };
    },
    async drill(chains, actors, tree) {
      const [first, second, third] = guardians as [NearCredentials, NearCredentials, NearCredentials];
      const deskAbi = artifact("Pactum", "Pactum.sol").abi;
      const memberIds = guardians.map((guardian) => guardian.accountId);
      const txs: Record<string, string> = {};

      // Replaces a guardian: the third one leaves, a new one joins, then they swap back so the council is as before.
      const swapped = [first.accountId, second.accountId, stranger.accountId];
      const out = await proposeGuardians(first, controller.accountId, swapped, THRESHOLD);
      txs.proposeGuardians = out.txHash;
      txs.approveGuardians1 = await approveGuardians(first, controller.accountId, out.id);
      txs.approveGuardians2 = await approveGuardians(second, controller.accountId, out.id);
      const during = await view<{ guardians: string[] }>(controller.accountId, "get_config");
      if (during.guardians.join() !== swapped.join()) throw new Error("The guardian vote did not apply");
      if (!(await expectNearFailure(third, controller.accountId, "propose_guardians", { guardians: memberIds, threshold: THRESHOLD }, "caller is not a guardian"))) {
        throw new Error("A removed guardian could still act");
      }
      detail("guardian vote", "one guardian replaced, and the removed one was rejected on NEAR");
      const back = await proposeGuardians(stranger, controller.accountId, memberIds, THRESHOLD);
      txs.restoreGuardians = back.txHash;
      txs.restoreGuardians1 = await approveGuardians(first, controller.accountId, back.id);
      txs.restoreGuardians2 = await approveGuardians(second, controller.accountId, back.id);
      const again = await deriveEvmAddress(controller.accountId, DERIVATION_PATH);
      if (again !== address) throw new Error(`Signing address changed: ${again}`);
      detail("guardian vote", "voted back, signing address unchanged");

      // The largest offer the contract allows: 12 cases on 3 chains and a text of exactly 4096 bytes. Every signature is real.
      const text = "Drill, not a real offer. Guardians approve the largest offer the contract allows, then vote to cancel it before any case opens. ".padEnd(4096, ".");
      const block = await Promise.all(chains.map((chain) => chain.evm.publicClient.getBlock()));
      const terms: { chain: ChainRun; terms: CaseTerms }[] = Array.from({ length: 12 }, (_, index) => {
        const position = index % chains.length;
        const chain = chains[position]!;
        return {
          chain,
          terms: {
            caseId: keccak256(stringToHex(`pactum-drill:${chain.contracts.Pactum}:${index}`)),
            token: chain.contracts.MockUSD,
            totalLoss: TOTAL_LOSS,
            maxReturn: TOTAL_LOSS,
            rewardCap: 150_000n * ONE_TOKEN,
            refundRoot: tree.root,
            evidenceHash: keccak256(stringToHex(text)),
            tiers: [{ until: block[position]!.timestamp + 168n * HOUR, rewardBps: 500 }],
            nonce: 1000n + BigInt(index),
            chainId: BigInt(chain.evm.chain.id),
          },
        };
      });
      const proposed = await proposeOffer(first, controller.accountId, terms.map((item) => item.terms), text);
      txs.proposeLarge = proposed.txHash;
      txs.approveLarge1 = await approveOffer(first, controller.accountId, proposed.id);
      const signStart = Date.now();
      txs.approveLarge2 = await approveOffer(second, controller.accountId, proposed.id);
      const signed = await signUntil(first, proposed.id, (item) => item.status === "Signed");
      const signSeconds = (Date.now() - signStart) / 1000;
      detail("largest offer", `${signed.proposal.cases.length} signatures in ${signSeconds.toFixed(1)}s, ${text.length} bytes of text`);

      // The case-opening signature works now. After revocation it no longer does.
      const opens = (index: number, signature: Hex) => terms[index]!.chain.evm.publicClient.simulateContract({
        account: actors.deployer,
        address: terms[index]!.chain.contracts.Pactum,
        abi: deskAbi,
        functionName: "openCase",
        args: [terms[index]!.terms, signature],
      }).then(() => "opens").catch((error: Error) => error.message);
      for (const [index, item] of signed.proposal.cases.entries()) {
        const result = await opens(index, item.signature as Hex);
        if (result !== "opens") throw new Error(`A signed case could not open before the cancel: ${result}`);
      }

      txs.cancel1 = await voteCancel(first, controller.accountId, proposed.id);
      const cancelStart = Date.now();
      txs.cancel2 = await voteCancel(second, controller.accountId, proposed.id);
      const cancelled = await signUntil(first, proposed.id, (item) => item.cases.every((entry) => entry.status === "Revoked"));
      const revokeSeconds = (Date.now() - cancelStart) / 1000;
      detail("cancel vote", `${cancelled.proposal.cases.length} revocations in ${revokeSeconds.toFixed(1)}s`);

      const revocations: Record<string, unknown>[] = [];
      for (const [index, item] of cancelled.proposal.cases.entries()) {
        const { chain, terms: caseTerms } = terms[index]!;
        await chain.evm.send(actors.deployer, chain.contracts.Pactum, deskAbi, "revokeNonce", [caseTerms.nonce, item.revocation], "revokeNonce");
        const after = await opens(index, item.signature as Hex);
        if (!after.includes("NonceUsed")) throw new Error(`A revoked offer could still open: ${after}`);
        revocations.push({ network: chain.network, caseIndex: index, nonce: caseTerms.nonce, tx: chain.evm.txs.revokeNonce, terms: caseTerms });
      }
      detail("revoked on chain", `${revocations.length} offers, each openCase now fails with NonceUsed`);

      writeFileSync(new URL("deployments/drill.json", ROOT), toJson({
        controllerAccount: controller.accountId,
        proposalId: proposed.id,
        guardianProposals: [out.id, back.id],
        signSeconds,
        revokeSeconds,
        textBytes: text.length,
        txs,
        revocations,
      }));
      console.log("  saved deployments/drill.json");
    },
  };
}

// Test NEAR keys live in .env.testnet, which .gitignore excludes.
async function loadOrCreateNearAccounts(): Promise<{ guardians: NearCredentials[]; stranger: NearCredentials }> {
  const path = new URL(".env.testnet", ROOT);
  if (existsSync(path)) {
    const line = readFileSync(path, "utf8").split("\n").find((item) => item.startsWith("NEAR_DEMO_ACCOUNTS="));
    if (line) return JSON.parse(line.slice("NEAR_DEMO_ACCOUNTS=".length));
  }
  detail("near", "creating guardian accounts through the faucet");
  const accounts = {
    guardians: [
      await createFaucetAccount("rd-guardian-a"),
      await createFaucetAccount("rd-guardian-b"),
      await createFaucetAccount("rd-guardian-c"),
    ],
    stranger: await createFaucetAccount("rd-stranger"),
  };
  writeFileSync(path, `NEAR_DEMO_ACCOUNTS=${JSON.stringify(accounts)}\n`, { mode: 0o600 });
  return accounts;
}

// Demo roles on Sepolia: keys are created once and kept in .env (excluded by .gitignore), never printed.
function loadOrCreateSepoliaActors(): Actors {
  loadRootEnv();
  const deployerKey = process.env.SEPOLIA_PRIVATE_KEY as Hex | undefined;
  if (!deployerKey) throw new Error("SEPOLIA_PRIVATE_KEY is missing from .env");
  const envPath = new URL(".env", ROOT);
  const names = ["ALICE", "BOB", "CAROL", "ATTACKER", "REWARD"] as const;
  const keys: Partial<Record<(typeof names)[number], Hex>> = {};
  let appended = "";
  for (const name of names) {
    const envName = `DEMO_${name}_KEY`;
    let key = process.env[envName] as Hex | undefined;
    if (!key) {
      key = generatePrivateKey();
      appended += `${envName}=${key}\n`;
      process.env[envName] = key;
    }
    keys[name] = key;
  }
  if (appended) writeFileSync(envPath, `${readFileSync(envPath, "utf8")}${appended}`, { mode: 0o600 });
  return {
    deployer: privateKeyToAccount(deployerKey),
    alice: privateKeyToAccount(keys.ALICE!),
    bob: privateKeyToAccount(keys.BOB!),
    carol: privateKeyToAccount(keys.CAROL!),
    attacker: privateKeyToAccount(keys.ATTACKER!),
    rewardWallet: privateKeyToAccount(keys.REWARD!).address,
  };
}

function anvilActors(): Actors {
  return {
    deployer: anvilAccount(0),
    alice: anvilAccount(1),
    bob: anvilAccount(2),
    carol: anvilAccount(3),
    attacker: anvilAccount(4),
    rewardWallet: anvilAccount(5).address,
  };
}

// Each role on Sepolia needs a little ETH for gas, taken from the deployer wallet.
async function fundActors(evm: Evm, actors: Actors, amount = "0.01"): Promise<void> {
  const enough = parseEther(amount) / 5n;
  for (const actor of [actors.alice, actors.bob, actors.carol, actors.attacker]) {
    const balance = await evm.publicClient.getBalance({ address: actor.address });
    if (balance >= enough) continue;
    const hash = await evm.wallet(actors.deployer).sendTransaction({
      account: actors.deployer,
      chain: evm.chain,
      to: actor.address,
      value: parseEther(amount),
    });
    await evm.publicClient.waitForTransactionReceipt({ hash });
  }
}

async function main() {
  const mode = parseMode();
  const stage = process.argv.includes("--stage");
  const stopAnvil = mode === "local" ? await startAnvil(8546) : () => {};
  try {
    await run(mode, stage);
  } finally {
    // With --stage on local, Anvil has to keep running for the interface.
    if (!stage) stopAnvil();
  }
  if (stage && mode === "local") {
    console.log("\nAnvil keeps running on port 8546 for the web app. Press Ctrl-C to stop.");
    process.on("SIGINT", () => {
      stopAnvil();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      stopAnvil();
      process.exit(0);
    });
    await new Promise(() => {});
  }
}

// Deploys one chain's contracts. The NEAR controller needs every chain's Pactum address when it is created,
// so this step finishes on all chains before the controller is deployed.
async function deployChain(network: ChainRun["network"], label: string, evm: Evm, actors: Actors, controllerAddress: Address, reuse = false): Promise<ChainRun> {
  // The token and fake protocol are always new because the story needs a new hack. Pactum is shared by every case.
  const usd = await evm.deploy(actors.deployer, "MockUSD", "MockUSD.sol", []);
  const vault = await evm.deploy(actors.deployer, "VulnerableVault", "VulnerableVault.sol", [usd]);
  if (reuse) {
    const saved = savedRun(network);
    detail(`Pactum on ${label}`, `${saved.contracts.Pactum} (reused)`);
    return {
      network,
      label,
      evm,
      contracts: { MockUSD: usd, VulnerableVault: vault, Pactum: saved.contracts.Pactum, PublicNotes: saved.contracts.PublicNotes },
      notesBlock: BigInt(saved.notesBlock),
    };
  }
  const desk = await evm.deploy(actors.deployer, "Pactum", "Pactum.sol", [controllerAddress]);
  const publicNotes = await evm.deploy(actors.deployer, "PublicNotes", "PublicNotes.sol", []);
  const notesBlock = (await evm.publicClient.getTransactionReceipt({ hash: evm.txs.deployPublicNotes! })).blockNumber;
  detail(`Pactum on ${label}`, desk);
  return { network, label, evm, contracts: { MockUSD: usd, VulnerableVault: vault, Pactum: desk, PublicNotes: publicNotes }, notesBlock };
}

async function run(mode: Mode, stage: boolean) {
  console.log(`Pactum demo${mode === "local" ? " on a local Anvil node" : " on testnet"}. Do not send real or stolen funds.`);
  console.log(`mode: ${mode}${mode === "local" ? " (controller is SIMULATED, no Chain Signatures)" : ""}`);

  loadRootEnv();
  const actors = mode === "local" ? anvilActors() : loadOrCreateSepoliaActors();
  const usdAbi = artifact("MockUSD", "MockUSD.sol").abi;
  const vaultAbi = artifact("VulnerableVault", "VulnerableVault.sol").abi;
  const deskAbi = artifact("Pactum", "Pactum.sol").abi;

  step(1, TOTAL_STEPS, "Deploy contracts");
  const reuse = mode === "testnet" && stage;
  const controller = mode === "local" ? simulatedController() : await nearController(reuse);
  const chains: ChainRun[] = [];
  if (mode === "local") {
    chains.push(await deployChain("local", "Anvil", new Evm(foundry, "http://127.0.0.1:8546"), actors, controller.address));
  } else {
    const sepoliaEvm = new Evm(sepolia, process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com");
    const baseEvm = new Evm(baseSepolia, process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com");
    const robinhoodEvm = new Evm(robinhoodTestnet, process.env.ROBINHOOD_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com");
    await fundActors(sepoliaEvm, actors);
    await fundActors(baseEvm, actors);
    // Gas here is very cheap: about 0.00003 ETH measured for the whole deploy step.
    await fundActors(robinhoodEvm, actors, "0.0005");
    chains.push(await deployChain("sepolia", "Sepolia", sepoliaEvm, actors, controller.address, reuse));
    chains.push(await deployChain("base-sepolia", "Base Sepolia", baseEvm, actors, controller.address, reuse));
    chains.push(await deployChain("robinhood-testnet", "Robinhood testnet", robinhoodEvm, actors, controller.address, reuse));
  }
  const toDeployment = (chain: ChainRun) => ({ chainId: BigInt(chain.evm.chain.id), pactum: chain.contracts.Pactum });
  // The last chain is not there at creation: when funds move to a new chain, the council votes it in.
  const lateChain = chains.length > 1 ? chains[chains.length - 1]! : undefined;
  await controller.deploy(chains.filter((chain) => chain !== lateChain).map(toDeployment));
  if (lateChain) await controller.addChain(BigInt(lateChain.evm.chain.id), lateChain.contracts.Pactum, lateChain.label);
  detail("controller address", `${controller.address} (the same on every chain)`);
  detail("controlled by", controller.label);

  const users = [actors.alice, actors.bob, actors.carol];
  for (const chain of chains) {
    const { evm } = chain;
    const { MockUSD: usd, VulnerableVault: vault } = chain.contracts;
    step(2, TOTAL_STEPS, `Users deposit into the demo protocol on ${chain.label}`);
    for (const [index, user] of users.entries()) {
      const allocation = ALLOCATIONS[index]!;
      await evm.send(actors.deployer, usd, usdAbi, "mint", [user.address, allocation]);
      await evm.send(user, usd, usdAbi, "approve", [vault, allocation]);
      await evm.send(user, vault, vaultAbi, "deposit", [allocation], `deposit${index}`);
    }
    detail("vault balance", `${formatTokens(await evm.read<bigint>(usd, usdAbi, "balanceOf", [vault]))} mUSD`);

    step(3, TOTAL_STEPS, `Attacker exploits the bug on ${chain.label}`);
    await evm.send(actors.attacker, vault, vaultAbi, "emergencyWithdraw", [actors.attacker.address], "drain");
    detail("stolen", `${formatTokens(await evm.read<bigint>(usd, usdAbi, "balanceOf", [actors.attacker.address]))} mUSD`);
    detail("vault balance", `${formatTokens(await evm.read<bigint>(usd, usdAbi, "balanceOf", [vault]))} mUSD`);
  }

  step(4, TOTAL_STEPS, "Guardians read one offer on NEAR and approve once, the controller signs for every chain");
  // The same users and amounts on every chain, so the refund tree is the same.
  const tree = buildRefundTree(users.map((user, index) => ({ account: user.address, allocation: ALLOCATIONS[index]! })));
  const evidence = {
    incident: "Demo protocol",
    offer: { conditions: OFFER_TEXT },
    chains: chains.map((chain) => ({
      chainId: chain.evm.chain.id,
      protocol: chain.contracts.VulnerableVault,
      token: chain.contracts.MockUSD,
      drainTx: chain.evm.txs.drain,
      totalLoss: TOTAL_LOSS.toString(),
    })),
    allocations: tree.allocations.map(({ account, allocation }) => ({ account, allocation: allocation.toString() })),
  };
  // This exact string is hashed and stored on NEAR, so guardians can read what they approve.
  const evidenceText = JSON.stringify(evidence);
  const offerCases = await Promise.all(
    chains.map(async (chain) => {
      const block = await chain.evm.publicClient.getBlock();
      const terms: CaseTerms = {
        caseId: keccak256(stringToHex(`pactum-demo:${chain.contracts.Pactum}:${chain.contracts.MockUSD}`)),
        token: chain.contracts.MockUSD,
        totalLoss: TOTAL_LOSS,
        maxReturn: TOTAL_LOSS,
        rewardCap: 150_000n * ONE_TOKEN,
        refundRoot: tree.root,
        evidenceHash: keccak256(stringToHex(evidenceText)),
        tiers: [
          { until: block.timestamp + 72n * HOUR, rewardBps: 1000 },
          { until: block.timestamp + 168n * HOUR, rewardBps: 500 },
        ],
        // When Pactum is reused, the old nonces are already spent on both NEAR and the EVM.
        nonce: reuse ? block.timestamp : 1n,
        chainId: BigInt(chain.evm.chain.id),
      };
      return { terms, digest: await chain.evm.read<Hex>(chain.contracts.Pactum, deskAbi, "hashCaseTerms", [terms]) };
    }),
  );

  // --stage on testnet: stop here with one approval, so the viewer approves, relays the signature and returns funds on this very case.
  if (mode === "testnet" && stage && controller.proposeForApproval) {
    const { id, record } = await controller.proposeForApproval(offerCases, evidenceText);
    const main = chains[0]!;
    const deployment = {
      network: main.network,
      chainId: main.evm.chain.id,
      stage: "awaiting-approval",
      openBlock: await main.evm.publicClient.getBlockNumber(),
      contracts: main.contracts,
      notesBlock: main.notesBlock,
      controllerAddress: controller.address,
      near: { ...record, caseIndex: 0 },
      otherChains: chains.slice(1).map((other) => ({ network: other.network, chainId: other.evm.chain.id, Pactum: other.contracts.Pactum })),
      actors: { users: users.map((user) => user.address), attacker: actors.attacker.address, rewardWallet: actors.rewardWallet, relayer: actors.deployer.address },
      terms: offerCases[0]!.terms,
      digest: offerCases[0]!.digest,
      evidence,
      allocations: tree.allocations,
      txs: main.evm.txs,
    };
    await writeStageFiles(mode, deployment);
    console.log(`\nProposal ${id} has one of two approvals. Approve it on the Guardians page in the app, send it to Sepolia, then return and claim.`);
    return;
  }

  const { signatures, record } = await controller.signOffer(offerCases, evidenceText);

  // The main chain runs last: with --stage it stops so the viewer continues in the interface.
  for (const chain of [...chains].reverse()) {
    console.log(`\n=== ${chain.label} ===`);
    const index = chains.indexOf(chain);
    const near = mode === "local" ? record : { ...record, caseIndex: index };
    await finishChain(mode, stage && chain === chains[0], chain, controller, actors, chains, offerCases[index]!, signatures[index]!, near, evidence, tree);
  }

  if (mode === "testnet" && !stage && controller.drill) {
    console.log("\n=== Drill: replace a guardian, then cancel a signed offer ===");
    await controller.drill(chains, actors, tree);
  }
}

// The interface reads this file and the viewer clicks through the remaining steps.
async function writeStageFiles(mode: Mode, deployment: unknown) {
  mkdirSync(new URL("web/public/", ROOT), { recursive: true });
  writeFileSync(new URL("web/public/deployment.json", ROOT), toJson(deployment));
  if (mode !== "testnet") return;
  // Test keys for screen recording, read only by the dev server. The file is excluded by .gitignore.
  const demoKeys = { attacker: process.env.DEMO_ATTACKER_KEY, alice: process.env.DEMO_ALICE_KEY, bob: process.env.DEMO_BOB_KEY, carol: process.env.DEMO_CAROL_KEY };
  // NEAR keys of the test guardians, so approvals can be clicked on the Guardians page while recording.
  const { guardians } = await loadOrCreateNearAccounts();
  writeFileSync(new URL("web/.env.local", ROOT), `VITE_DEMO_KEYS=${JSON.stringify(demoKeys)}\nVITE_DEMO_GUARDIANS=${JSON.stringify(guardians)}\n`, { mode: 0o600 });
}

// The rest on one chain: open the case with the existing signature, return funds, claim refunds.
async function finishChain(
  mode: Mode,
  stage: boolean,
  chain: ChainRun,
  controller: ControllerSide,
  actors: Actors,
  chains: ChainRun[],
  { terms, digest }: { terms: CaseTerms; digest: Hex },
  signature: Hex,
  near: Record<string, unknown>,
  evidence: Record<string, unknown>,
  tree: ReturnType<typeof buildRefundTree>,
) {
  const { evm } = chain;
  const { MockUSD: usd, VulnerableVault: vault, Pactum: desk, PublicNotes: publicNotes } = chain.contracts;
  const usdAbi = artifact("MockUSD", "MockUSD.sol").abi;
  const deskAbi = artifact("Pactum", "Pactum.sol").abi;
  const users = [actors.alice, actors.bob, actors.carol];
  const stolen = await evm.read<bigint>(usd, usdAbi, "balanceOf", [actors.attacker.address]);
  detail("MockUSD", usd);
  detail("VulnerableVault", vault);
  detail("Pactum", desk);
  detail("PublicNotes", publicNotes);

  step(5, TOTAL_STEPS, "Anyone relays the signature to open the case");
  // The deployer submits it here, but the contract does not care who sends it.
  await evm.send(actors.deployer, desk, deskAbi, "openCase", [terms, signature], "openCase");
  const [, bps, until] = await evm.read<[boolean, number, bigint]>(desk, deskAbi, "currentTier", [terms.caseId]);
  detail("reward now", `${bps / 100}% until ${new Date(Number(until) * 1000).toISOString()}`);
  const [quotedReward, quotedRefund] = await evm.read<[bigint, bigint]>(desk, deskAbi, "quote", [terms.caseId, stolen]);
  detail("quote", `return ${formatTokens(stolen)}, reward ${formatTokens(quotedReward)}, refund ${formatTokens(quotedRefund)}`);

  const openReceipt = await evm.publicClient.getTransactionReceipt({ hash: evm.txs.openCase! });
  const deployment = {
    network: chain.network,
    chainId: evm.chain.id,
    rpc: mode === "local" ? evm.rpc : undefined,
    stage: stage ? "open" : "complete",
    openBlock: openReceipt.blockNumber,
    contracts: chain.contracts,
    notesBlock: chain.notesBlock,
    controllerAddress: controller.address,
    near,
    // The other chains this controller serves.
    otherChains: chains.filter((other) => other !== chain).map((other) => ({ network: other.network, chainId: other.evm.chain.id, Pactum: other.contracts.Pactum })),
    actors: {
      users: users.map((user) => user.address),
      attacker: actors.attacker.address,
      rewardWallet: actors.rewardWallet,
      relayer: actors.deployer.address,
    },
    terms,
    digest,
    signature,
    evidence,
    allocations: tree.allocations,
    txs: evm.txs,
  };

  if (stage) {
    await writeStageFiles(mode, deployment);
    console.log("\nCase is open. Saved web/public/deployment.json. Continue in the web app.");
    return;
  }

  step(6, TOTAL_STEPS, "Attacker returns the funds in one transaction");
  await evm.send(actors.attacker, usd, usdAbi, "approve", [desk, stolen], "approveReturn");
  const returnReceipt = await evm.send(
    actors.attacker,
    desk,
    deskAbi,
    "returnFunds",
    [terms.caseId, stolen, actors.rewardWallet, quotedReward],
    "returnFunds",
  );
  const returned = parseEventLogs({ abi: deskAbi, logs: returnReceipt.logs, eventName: "FundsReturned" })[0] as unknown as {
    args: { received: bigint; reward: bigint; refund: bigint };
  };
  detail("received", `${formatTokens(returned.args.received)} mUSD`);
  detail("reward", `${formatTokens(returned.args.reward)} mUSD to ${actors.rewardWallet}`);
  detail("refund pool", `${formatTokens(returned.args.refund)} mUSD held by Pactum`);
  detail("same transaction", returnReceipt.transactionHash);

  step(7, TOTAL_STEPS, "Users claim their refunds with Merkle proofs");
  for (const [index, entry] of tree.allocations.entries()) {
    await evm.send(actors.deployer, desk, deskAbi, "claimRefund", [terms.caseId, entry.account, entry.allocation, entry.proof], `claim${index}`);
    const balance = await evm.read<bigint>(usd, usdAbi, "balanceOf", [entry.account]);
    detail(`user ${index + 1}`, `deposited ${formatTokens(entry.allocation)}, got back ${formatTokens(balance)} mUSD`);
  }

  step(8, TOTAL_STEPS, "The team tries to withdraw");
  const withdrawResult = await evm.publicClient
    .call({
      account: controller.address,
      to: desk,
      data: encodeFunctionData({
        abi: [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const,
        functionName: "withdraw",
        // Zero amount: if the function existed the call would succeed even with no tokens left in the contract.
        args: [usd, 0n],
      }),
    })
    .then(() => "succeeded")
    .catch(() => "reverted");
  if (withdrawResult !== "reverted") throw new Error("Withdraw call did not revert");
  detail("withdraw from controller", "reverted: the function does not exist");

  const finalCase = await evm.read<{ totalReward: bigint; totalRefund: bigint; totalClaimed: bigint; totalReturned: bigint }>(
    desk,
    deskAbi,
    "getCase",
    [terms.caseId],
  );
  if (finalCase.totalReward + finalCase.totalRefund !== finalCase.totalReturned) throw new Error("Accounting mismatch");

  console.log("\nResult");
  console.log(`  stolen ${formatTokens(stolen)}; reward ${formatTokens(finalCase.totalReward)}; refund pool ${formatTokens(finalCase.totalRefund)}; claimed ${formatTokens(finalCase.totalClaimed)}`);
  console.log(mode === "local" ? "  PASS (controller was SIMULATED)" : "  PASS (controller signed through Chain Signatures on NEAR testnet)");

  if (mode === "testnet") {
    const dir = new URL("deployments/", ROOT);
    if (!existsSync(dir)) mkdirSync(dir);
    // --stage stops on the main chain, so it does not overwrite the verified results of the full run.
    if (!process.argv.includes("--stage")) {
      writeFileSync(new URL(`${chain.network}.json`, dir), toJson(deployment));
      console.log(`  saved deployments/${chain.network}.json`);
    }
  }
}


main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
