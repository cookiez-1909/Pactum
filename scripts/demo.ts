// Runs the full demo scenario from section 9 with one command.
//   tsx demo.ts --mode local    : Anvil with a SIMULATED controller using a test key. No NEAR needed.
//   tsx demo.ts --mode testnet  : Sepolia, Base Sepolia, Robinhood testnet and NEAR testnet. One controller on NEAR signs for all three chains.
//   Add --stage: on the main chain, stop right after openCase so the viewer returns funds and claims refunds in the interface.
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
  approveCase,
  createFaucetAccount,
  createSubAccount,
  richestAccount,
  deployController,
  deriveEvmAddress,
  expectNearFailure,
  getProposal,
  proposeCase,
  removeAllAccessKeys,
  toNearTerms,
  view,
  type NearCredentials,
} from "./lib/near.ts";

type Mode = "local" | "testnet";

const TOTAL_STEPS = 8;
const DERIVATION_PATH = "pactum-1";
const MAX_REWARD_BPS = 2000;
const THRESHOLD = 2;
const HOUR = 3600n;
// Enough to pay storage for the 166 KB contract and the proposals.
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
  // Also returns this chain's own record: the proposal id and its NEAR transactions.
  sign(terms: CaseTerms, digest: Hex, evidence: string): Promise<{ signature: Hex; record: Record<string, unknown> }>;
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
    async sign(_terms, digest) {
      detail("controller", "SIMULATED: signing with a local test key, not NEAR");
      return { signature: await account.sign!({ hash: digest }), record: { simulated: true } };
    },
  };
}

async function nearController(): Promise<ControllerSide> {
  // Guardians are reused between runs. The controller is always new because that account has every key removed.
  const { guardians, stranger } = await loadOrCreateNearAccounts();
  // Takes funds from the account with the most NEAR. A parent account has no rights over its sub-accounts.
  const funder = await richestAccount([...guardians, stranger]);
  const controller = await createSubAccount(funder, "ctrl", CONTROLLER_DEPOSIT);
  const address = await deriveEvmAddress(controller.accountId, DERIVATION_PATH);
  const wasm = readFileSync(new URL("controller/target/near/pactum_controller.wasm", ROOT));
  // Saves the exact deployed file in the repo so make verify can compare it with the code hash on NEAR.
  if (!process.argv.includes("--stage")) {
    mkdirSync(new URL("deployments/", ROOT), { recursive: true });
    writeFileSync(new URL("deployments/pactum_controller.wasm", ROOT), wasm);
  }
  const sharedTxs: Record<string, string> = {};

  return {
    label: `Chain Signatures through ${controller.accountId}`,
    address,
    async deploy(deployments) {
      sharedTxs.deployController = await deployController(controller, wasm, {
        guardians: guardians.map((guardian) => guardian.accountId),
        threshold: THRESHOLD,
        deployments,
        derivationPath: DERIVATION_PATH,
        maxRewardBps: MAX_REWARD_BPS,
      });
      sharedTxs.removeKeys = await removeAllAccessKeys(controller);
      const keys = await accessKeyCount(controller.accountId);
      if (keys !== 0) throw new Error(`Controller still has ${keys} access keys`);
      detail("near contract", `${controller.accountId} (0 access keys left)`);
    },
    async sign(terms, digest, evidence) {
      const nearTxs: Record<string, string> = { ...sharedTxs };
      const [first, second] = guardians as [NearCredentials, NearCredentials, NearCredentials];
      const onChainDigest = await view<Hex>(controller.accountId, "case_digest", { terms: toNearTerms(terms) });
      if (onChainDigest !== digest) throw new Error(`Digest mismatch: NEAR ${onChainDigest}, EVM ${digest}`);
      detail("digest", `${digest} (same on NEAR and EVM)`);

      if (!(await expectNearFailure(stranger, controller.accountId, "propose_case", { terms: toNearTerms(terms), evidence }, "caller is not a guardian"))) {
        throw new Error("A stranger was able to propose a case");
      }
      detail("stranger proposal", "rejected on NEAR");

      const { id, txHash } = await proposeCase(first, controller.accountId, terms, evidence);
      nearTxs.propose = txHash;
      nearTxs.approve1 = await approveCase(first, controller.accountId, id);
      const pending = await getProposal(controller.accountId, id);
      if (pending.status !== "Pending") throw new Error(`Expected Pending, got ${pending.status}`);
      detail("guardian 1 of 2", `${first.accountId} approved, still ${pending.status}`);

      if (
        !(await expectNearFailure(stranger, controller.accountId, "on_signed", { proposal_id: id }, "is private"))
      ) {
        throw new Error("A stranger was able to call on_signed");
      }
      detail("forged callback", "rejected on NEAR (#[private])");

      const started = Date.now();
      nearTxs.approve2 = await approveCase(second, controller.accountId, id);
      const proposal = await getProposal(controller.accountId, id);
      if (proposal.status !== "Signed" || !proposal.signature) {
        throw new Error(`Signing failed, status ${proposal.status}. Retry with retry_signature.`);
      }
      detail("guardian 2 of 2", `${second.accountId} approved`);
      detail("chain signatures", `signed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return {
        signature: proposal.signature,
        record: {
          simulated: false,
          controllerAccount: controller.accountId,
          derivationPath: DERIVATION_PATH,
          guardians: guardians.map((guardian) => guardian.accountId),
          threshold: THRESHOLD,
          proposalId: id,
          txs: nearTxs,
        },
      };
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
async function deployChain(network: ChainRun["network"], label: string, evm: Evm, actors: Actors, controllerAddress: Address): Promise<ChainRun> {
  const usd = await evm.deploy(actors.deployer, "MockUSD", "MockUSD.sol", []);
  const vault = await evm.deploy(actors.deployer, "VulnerableVault", "VulnerableVault.sol", [usd]);
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

  step(1, TOTAL_STEPS, "Deploy contracts");
  const controller = mode === "local" ? simulatedController() : await nearController();
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
    chains.push(await deployChain("sepolia", "Sepolia", sepoliaEvm, actors, controller.address));
    chains.push(await deployChain("base-sepolia", "Base Sepolia", baseEvm, actors, controller.address));
    chains.push(await deployChain("robinhood-testnet", "Robinhood testnet", robinhoodEvm, actors, controller.address));
  }
  await controller.deploy(chains.map((chain) => ({ chainId: BigInt(chain.evm.chain.id), pactum: chain.contracts.Pactum })));
  detail("controller address", `${controller.address} (the same on every chain)`);
  detail("controlled by", controller.label);

  // The main chain runs last: with --stage it stops so the viewer continues in the interface.
  for (const chain of [...chains].reverse()) {
    console.log(`\n=== ${chain.label} ===`);
    await runStory(mode, stage && chain === chains[0], chain, controller, actors, chains);
  }
}

// The whole story on one chain: deposit, hack, guardians approve, funds returned, refunds claimed.
async function runStory(mode: Mode, stage: boolean, chain: ChainRun, controller: ControllerSide, actors: Actors, chains: ChainRun[]) {
  const { evm } = chain;
  const { MockUSD: usd, VulnerableVault: vault, Pactum: desk, PublicNotes: publicNotes } = chain.contracts;
  const usdAbi = artifact("MockUSD", "MockUSD.sol").abi;
  const vaultAbi = artifact("VulnerableVault", "VulnerableVault.sol").abi;
  const deskAbi = artifact("Pactum", "Pactum.sol").abi;
  const chainId = BigInt(evm.chain.id);
  detail("MockUSD", usd);
  detail("VulnerableVault", vault);
  detail("Pactum", desk);
  detail("PublicNotes", publicNotes);

  step(2, TOTAL_STEPS, "Users deposit into the demo protocol");
  const users = [actors.alice, actors.bob, actors.carol];
  for (const [index, user] of users.entries()) {
    const allocation = ALLOCATIONS[index]!;
    await evm.send(actors.deployer, usd, usdAbi, "mint", [user.address, allocation]);
    await evm.send(user, usd, usdAbi, "approve", [vault, allocation]);
    await evm.send(user, vault, vaultAbi, "deposit", [allocation], `deposit${index}`);
  }
  detail("vault balance", `${formatTokens(await evm.read<bigint>(usd, usdAbi, "balanceOf", [vault]))} mUSD`);

  step(3, TOTAL_STEPS, "Attacker exploits the bug");
  await evm.send(actors.attacker, vault, vaultAbi, "emergencyWithdraw", [actors.attacker.address], "drain");
  const stolen = await evm.read<bigint>(usd, usdAbi, "balanceOf", [actors.attacker.address]);
  detail("stolen", `${formatTokens(stolen)} mUSD`);
  detail("vault balance", `${formatTokens(await evm.read<bigint>(usd, usdAbi, "balanceOf", [vault]))} mUSD`);

  step(4, TOTAL_STEPS, "Guardians read the offer on NEAR and approve, the controller signs");
  const tree = buildRefundTree(users.map((user, index) => ({ account: user.address, allocation: ALLOCATIONS[index]! })));
  const evidence = {
    incident: "Demo protocol",
    protocol: vault,
    token: usd,
    drainTx: evm.txs.drain,
    totalLoss: TOTAL_LOSS.toString(),
    offer: { conditions: OFFER_TEXT },
    allocations: tree.allocations.map(({ account, allocation }) => ({ account, allocation: allocation.toString() })),
  };
  // This exact string is hashed and stored on NEAR, so guardians can read what they approve.
  const evidenceText = JSON.stringify(evidence);
  const block = await evm.publicClient.getBlock();
  const terms: CaseTerms = {
    caseId: keccak256(stringToHex(`pactum-demo:${desk}`)),
    token: usd,
    totalLoss: TOTAL_LOSS,
    maxReturn: TOTAL_LOSS,
    rewardCap: 150_000n * ONE_TOKEN,
    refundRoot: tree.root,
    evidenceHash: keccak256(stringToHex(evidenceText)),
    tiers: [
      { until: block.timestamp + 72n * HOUR, rewardBps: 1000 },
      { until: block.timestamp + 168n * HOUR, rewardBps: 500 },
    ],
    nonce: 1n,
    chainId,
  };
  const digest = await evm.read<Hex>(desk, deskAbi, "hashCaseTerms", [terms]);
  const { signature, record } = await controller.sign(terms, digest, evidenceText);

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
    near: record,
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
    // The open case: the interface reads this file and the viewer clicks through the remaining steps.
    mkdirSync(new URL("web/public/", ROOT), { recursive: true });
    writeFileSync(new URL("web/public/deployment.json", ROOT), toJson(deployment));
    if (mode === "testnet") {
      // Test keys for the video recorder, read only by the dev server. The file is blocked by .gitignore.
      const demoKeys = { attacker: process.env.DEMO_ATTACKER_KEY, alice: process.env.DEMO_ALICE_KEY, bob: process.env.DEMO_BOB_KEY, carol: process.env.DEMO_CAROL_KEY };
      writeFileSync(new URL("web/.env.local", ROOT), `VITE_DEMO_KEYS=${JSON.stringify(demoKeys)}\n`, { mode: 0o600 });
    }
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
    [terms.caseId, stolen, actors.rewardWallet],
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
