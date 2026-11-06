// Verifies the testnet demo from public data only. No wallet and no keys.
// Reads the results in deployments/ and checks every claim against the EVM chains and NEAR testnet.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { baseEncode } from "near-api-js";
import {
  createPublicClient,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseEventLogs,
  recoverAddress,
  stringToHex,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { baseSepolia, robinhoodTestnet, sepolia } from "viem/chains";
import { ROOT, artifact, formatTokens, ONE_TOKEN, type CaseTerms } from "./lib/common.ts";
import { accessKeyCount, deriveEvmAddress, MPC_CONTRACT, provider, toNearTerms, view, type NearProposal } from "./lib/near.ts";

const ERC20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

let failures = 0;
function check(name: string, ok: boolean, note = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
  if (!ok) failures += 1;
}

interface Target {
  label: string;
  chain: Chain;
  client: PublicClient;
  // This chain's results file.
  d: any;
  terms: CaseTerms;
}

function loadTarget(file: string, label: string, chain: Chain, rpc: string): Target {
  const path = new URL(`deployments/${file}.json`, ROOT);
  if (!existsSync(path)) throw new Error(`deployments/${file}.json not found. It is created by: make demo-testnet`);
  const d = JSON.parse(readFileSync(path, "utf8"));
  const terms: CaseTerms = {
    ...d.terms,
    totalLoss: BigInt(d.terms.totalLoss),
    maxReturn: BigInt(d.terms.maxReturn),
    rewardCap: BigInt(d.terms.rewardCap),
    nonce: BigInt(d.terms.nonce),
    chainId: BigInt(d.terms.chainId),
    tiers: d.terms.tiers.map((tier: { until: string; rewardBps: number }) => ({ until: BigInt(tier.until), rewardBps: tier.rewardBps })),
  };
  return { label, chain, d, terms, client: createPublicClient({ chain, transport: http(rpc) }) as PublicClient };
}

const { abi: deskAbi } = artifact("Pactum", "Pactum.sol");

async function checkController(targets: Target[]): Promise<void> {
  const controllerAccount = targets[0]!.d.near.controllerAccount as string;
  console.log(`Controller ${controllerAccount} on NEAR testnet\n`);
  check("Every chain uses the same NEAR contract", targets.every((target) => target.d.near.controllerAccount === controllerAccount));
  check("NEAR controller account has no access keys", (await accessKeyCount(controllerAccount)) === 0);

  // The code on NEAR must be exactly the wasm file in the repo. `make verify-wasm` rebuilds that file from source.
  const wasm = readFileSync(new URL("deployments/pactum_controller.wasm", ROOT));
  const account = await provider.viewAccount({ accountId: controllerAccount });
  const wasmHash = baseEncode(createHash("sha256").update(wasm).digest());
  check("Deployed NEAR code matches deployments/pactum_controller.wasm", account.code_hash === wasmHash, wasmHash);

  const config = await view<{ deployments: { chain_id: string; pactum: string }[]; threshold: number; guardians: string[]; signer_contract: string }>(controllerAccount, "get_config");
  check("NEAR contract uses the MPC signer", config.signer_contract === MPC_CONTRACT, MPC_CONTRACT);
  check("Approval needs more than one guardian", config.threshold >= 2, `${config.threshold} of ${config.guardians.length}`);
  check(
    "NEAR contract serves exactly these Pactum deployments",
    config.deployments.length === targets.length &&
      targets.every((target) => config.deployments.some((item) => item.chain_id === String(target.chain.id) && item.pactum.toLowerCase() === target.d.contracts.Pactum.toLowerCase())),
    targets.map((target) => target.label).join(", "),
  );
  const listed = await view<NearProposal[]>(controllerAccount, "list_proposals", { from: "0", limit: 50 });
  check("Anyone can list the proposals from NEAR", targets.every((target) => listed.some((item) => item.id === target.d.near.proposalId)), `${listed.length} proposals`);
}

async function checkChain({ label, client, d, terms }: Target): Promise<void> {
  const desk = d.contracts.Pactum as Address;
  const usd = d.contracts.MockUSD as Address;
  const vault = d.contracts.VulnerableVault as Address;
  const controllerAccount = d.near.controllerAccount as string;
  console.log(`\n${label}: Pactum ${desk}\n`);

  // Control: the controller address really is derived from the NEAR contract.
  const onChainController = (await client.readContract({ address: desk, abi: deskAbi, functionName: "controller" })) as Address;
  const derived = await deriveEvmAddress(controllerAccount, d.near.derivationPath);
  check("Pactum.controller is derived from the NEAR contract", isAddressEqual(onChainController, derived), derived);

  // Terms: NEAR and the EVM produce the same hash, and the signature recovers the controller.
  const proposal = await view<NearProposal>(controllerAccount, "get_proposal", { proposal_id: d.near.proposalId });
  const config = await view<{ threshold: number }>(controllerAccount, "get_config");
  const evmDigest = (await client.readContract({ address: desk, abi: deskAbi, functionName: "hashCaseTerms", args: [terms] })) as Hex;
  const nearDigest = await view<Hex>(controllerAccount, "case_digest", { terms: toNearTerms(terms) });
  check("EIP-712 digest matches on NEAR and EVM", evmDigest === proposal.digest && evmDigest === nearDigest, evmDigest);
  check("Proposal was signed after enough approvals", proposal.status === "Signed" && proposal.approvals.length >= config.threshold, `${proposal.approvals.length} approvals`);
  check("Offer text stored on NEAR hashes to evidenceHash", keccak256(stringToHex(proposal.evidence)) === terms.evidenceHash && proposal.evidence === JSON.stringify(d.evidence), `${proposal.evidence.length} bytes`);
  check("Signature was stored on NEAR", typeof proposal.signature === "string");
  const recovered = await recoverAddress({ hash: evmDigest, signature: proposal.signature as Hex });
  check("Signature recovers to the controller", isAddressEqual(recovered, onChainController), recovered);

  // The final NEAR approval transaction must have succeeded on chain.
  const approve = await provider.viewTransactionStatus({ txHash: d.near.txs.approve2, accountId: proposal.approvals[1] as string, waitUntil: "FINAL" });
  check("Final approval transaction succeeded on NEAR", typeof (approve.status as { SuccessValue?: string }).SuccessValue === "string", d.near.txs.approve2);

  // The case was opened with that exact signature.
  const openReceipt = await client.getTransactionReceipt({ hash: d.txs.openCase as Hash });
  const opened = parseEventLogs({ abi: deskAbi, logs: openReceipt.logs, eventName: "CaseOpened" });
  check("openCase succeeded", openReceipt.status === "success" && opened.length === 1, d.txs.openCase);

  // The hack and atomicity: one transaction carries all 3 events with the right amounts.
  const drainReceipt = await client.getTransactionReceipt({ hash: d.txs.drain as Hash });
  const drain = parseEventLogs({ abi: ERC20, logs: drainReceipt.logs, eventName: "Transfer" })[0]!;
  check("The vault was drained", isAddressEqual(drain.args.from, vault) && drain.args.value === 1_000_000n * ONE_TOKEN, `${formatTokens(drain.args.value)} mUSD`);

  const returnReceipt = await client.getTransactionReceipt({ hash: d.txs.returnFunds as Hash });
  const transfers = parseEventLogs({ abi: ERC20, logs: returnReceipt.logs, eventName: "Transfer" });
  const toDesk = transfers.find((log) => isAddressEqual(log.args.to, desk));
  const toReward = transfers.find((log) => isAddressEqual(log.args.to, d.actors.rewardWallet));
  check("Attacker returned 1,000,000 mUSD", toDesk?.args.value === 1_000_000n * ONE_TOKEN);
  check("Same transaction paid the 100,000 mUSD reward", toReward?.args.value === 100_000n * ONE_TOKEN, d.txs.returnFunds);

  // Actual refunds.
  const state = (await client.readContract({ address: desk, abi: deskAbi, functionName: "getCase", args: [terms.caseId] })) as {
    totalReturned: bigint;
    totalReward: bigint;
    totalRefund: bigint;
    totalClaimed: bigint;
  };
  check("reward + refund == received", state.totalReward + state.totalRefund === state.totalReturned);
  check("Refund pool is 900,000 mUSD", state.totalRefund === 900_000n * ONE_TOKEN);
  check("Users claimed 900,000 mUSD", state.totalClaimed === 900_000n * ONE_TOKEN);

  // On-chain bytecode must match the build from the repo's source, except the immutable slots
  // that hold this deployment's own values (controller, chain id, domain separator). This proves the running
  // contract has no function beyond the source, a withdraw function included.
  // The CBOR metadata at the end is excluded too: it is never executed and changes with the build settings.
  const compiled = JSON.parse(readFileSync(new URL("contracts/out/Pactum.sol/Pactum.json", ROOT), "utf8"));
  const onChain = ((await client.getCode({ address: desk })) ?? "0x").slice(2).toLowerCase();
  const local = (compiled.deployedBytecode.object as string).slice(2).toLowerCase();
  const references = Object.values(compiled.deployedBytecode.immutableReferences).flat() as { start: number; length: number }[];
  const mask = (hex: string) => {
    let masked = hex;
    for (const { start, length } of references) {
      masked = masked.slice(0, start * 2) + "0".repeat(length * 2) + masked.slice((start + length) * 2);
    }
    // The last two bytes give the metadata length.
    const metadataBytes = Number.parseInt(masked.slice(-4), 16) + 2;
    return masked.slice(0, -metadataBytes * 2);
  };
  check("Deployed Pactum bytecode matches this source", onChain.length === local.length && mask(onChain) === mask(local), `${onChain.length / 2} bytes`);
  const external = Object.keys(compiled.methodIdentifiers as Record<string, string>).length;
  const changing = (compiled.abi as { type: string; name: string; stateMutability: string }[])
    .filter((item) => item.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure")
    .map((item) => item.name)
    .sort();
  check("Only openCase, returnFunds and claimRefund change state", changing.join() === "claimRefund,openCase,returnFunds", `${external} external functions`);

  // No withdrawal path: try it with eth_call from the controller address itself.
  const { abi: mockAbi } = artifact("MockUSD", "MockUSD.sol");
  const deskBalance = (await client.readContract({ address: usd, abi: mockAbi, functionName: "balanceOf", args: [desk] })) as bigint;
  check("Pactum holds no leftover after all claims", deskBalance === 0n);
  const withdrawReverted = await client
    .simulateContract({
      account: onChainController,
      address: desk,
      abi: parseAbi(["function withdraw(address token, uint256 amount)"]),
      functionName: "withdraw",
      // Zero amount: if the function existed the call would succeed even with no tokens left in the contract.
      args: [usd, 0n],
    })
    .then(() => false)
    .catch(() => true);
  check("Controller cannot call withdraw", withdrawReverted);
}

// One council signing for several chains is only safe if a signature for one chain is useless on another.
async function checkCrossChain(first: Target, second: Target): Promise<void> {
  console.log(`\n${first.label} and ${second.label}\n`);
  check(
    "The same controller address opens cases on both chains",
    isAddressEqual(first.d.controllerAddress, second.d.controllerAddress),
    first.d.controllerAddress,
  );
  const secondDesk = second.d.contracts.Pactum as Address;
  const relayError = await second.client
    .simulateContract({ address: secondDesk, abi: deskAbi as Abi, functionName: "openCase", args: [first.terms, first.d.signature] })
    .then(() => "")
    .catch((error: Error) => error.message);
  check(`A ${first.label} signature is rejected on ${second.label}`, relayError.includes("WrongChain"));

  // Editing the chain id in the terms does not help: the hash changes, so the signature no longer matches the controller.
  const retargeted = { ...first.terms, chainId: second.terms.chainId };
  const retargetedDigest = (await second.client.readContract({ address: secondDesk, abi: deskAbi, functionName: "hashCaseTerms", args: [retargeted] })) as Hex;
  const recovered = await recoverAddress({ hash: retargetedDigest, signature: first.d.signature as Hex });
  check("Editing the chain id breaks that signature", !isAddressEqual(recovered, first.d.controllerAddress), recovered);
}

async function main() {
  const targets: Target[] = [
    loadTarget("sepolia", "Sepolia", sepolia, process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com"),
    loadTarget("base-sepolia", "Base Sepolia", baseSepolia, process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com"),
    loadTarget("robinhood-testnet", "Robinhood testnet", robinhoodTestnet, process.env.ROBINHOOD_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com"),
  ];
  await checkController(targets);
  for (const target of targets) await checkChain(target);
  for (const other of targets.slice(1)) await checkCrossChain(targets[0]!, other);

  console.log(failures === 0 ? "\nPASS: every check matched public on-chain data" : `\nFAIL: ${failures} checks failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
