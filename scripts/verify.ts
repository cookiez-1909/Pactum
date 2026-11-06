// Verifies the testnet demo from public data only. No wallet and no keys.
// Reads deployments/sepolia.json and checks every claim against Sepolia and NEAR testnet.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { baseEncode } from "near-api-js";
import {
  createPublicClient,
  http,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  recoverAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { ROOT, artifact, formatTokens, ONE_TOKEN, type CaseTerms } from "./lib/common.ts";
import { accessKeyCount, deriveEvmAddress, MPC_CONTRACT, provider, toNearTerms, view } from "./lib/near.ts";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
const ERC20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

let failures = 0;
function check(name: string, ok: boolean, note = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const path = new URL("deployments/sepolia.json", ROOT);
  if (!existsSync(path)) throw new Error("deployments/sepolia.json not found. It is created by: make demo-testnet");
  const d = JSON.parse(readFileSync(path, "utf8"));
  const desk = d.contracts.Pactum as Address;
  const usd = d.contracts.MockUSD as Address;
  const vault = d.contracts.VulnerableVault as Address;
  const { abi: deskAbi } = artifact("Pactum", "Pactum.sol");
  const terms: CaseTerms = {
    ...d.terms,
    totalLoss: BigInt(d.terms.totalLoss),
    maxReturn: BigInt(d.terms.maxReturn),
    rewardCap: BigInt(d.terms.rewardCap),
    nonce: BigInt(d.terms.nonce),
    chainId: BigInt(d.terms.chainId),
    tiers: d.terms.tiers.map((tier: { until: string; rewardBps: number }) => ({ until: BigInt(tier.until), rewardBps: tier.rewardBps })),
  };
  const controllerAccount = d.near.controllerAccount as string;

  console.log(`Pactum ${desk} on Sepolia, controller ${controllerAccount} on NEAR testnet\n`);

  // Control: the controller address really derives from the NEAR contract, and that account holds no keys.
  const onChainController = (await client.readContract({ address: desk, abi: deskAbi, functionName: "controller" })) as Address;
  const derived = await deriveEvmAddress(controllerAccount, d.near.derivationPath);
  check("Pactum.controller is derived from the NEAR contract", isAddressEqual(onChainController, derived), derived);
  check("NEAR controller account has no access keys", (await accessKeyCount(controllerAccount)) === 0);

  // The code on NEAR must be exactly the wasm file in the repo. `make verify-wasm` rebuilds that file from source.
  const wasm = readFileSync(new URL("deployments/pactum_controller.wasm", ROOT));
  const account = await provider.viewAccount({ accountId: controllerAccount });
  const wasmHash = baseEncode(createHash("sha256").update(wasm).digest());
  check("Deployed NEAR code matches deployments/pactum_controller.wasm", account.code_hash === wasmHash, wasmHash);

  const config = await view<{ pactum: string; threshold: number; guardians: string[]; signer_contract: string }>(controllerAccount, "get_config");
  check("NEAR contract targets this Pactum", config.pactum.toLowerCase() === desk.toLowerCase());
  check("NEAR contract uses the MPC signer", config.signer_contract === MPC_CONTRACT, MPC_CONTRACT);
  check("Approval needs more than one guardian", config.threshold >= 2, `${config.threshold} of ${config.guardians.length}`);

  // Terms: NEAR and the EVM produce the same hash, and the signature recovers the controller.
  const proposal = await view<{ digest: Hex; status: string; signature: Hex | null; approvals: string[] }>(controllerAccount, "get_proposal", { proposal_id: d.near.proposalId });
  const evmDigest = (await client.readContract({ address: desk, abi: deskAbi, functionName: "hashCaseTerms", args: [terms] })) as Hex;
  const nearDigest = await view<Hex>(controllerAccount, "case_digest", { terms: toNearTerms(terms) });
  check("EIP-712 digest matches on NEAR and Sepolia", evmDigest === proposal.digest && evmDigest === nearDigest, evmDigest);
  check("Proposal was signed after enough approvals", proposal.status === "Signed" && proposal.approvals.length >= config.threshold, `${proposal.approvals.length} approvals`);
  check("Signature was stored on NEAR", typeof proposal.signature === "string");
  const recovered = await recoverAddress({ hash: evmDigest, signature: proposal.signature as Hex });
  check("Signature recovers to the controller", isAddressEqual(recovered, onChainController), recovered);

  // The final NEAR approval transaction must have succeeded on chain.
  const approve = await provider.viewTransactionStatus({ txHash: d.near.txs.approve2, accountId: proposal.approvals[1] as string, waitUntil: "FINAL" });
  check("Final approval transaction succeeded on NEAR", typeof (approve.status as { SuccessValue?: string }).SuccessValue === "string", d.near.txs.approve2);

  // The case was opened with that exact signature.
  const openReceipt = await client.getTransactionReceipt({ hash: d.txs.openCase as Hash });
  const opened = parseEventLogs({ abi: deskAbi, logs: openReceipt.logs, eventName: "CaseOpened" });
  check("openCase succeeded on Sepolia", openReceipt.status === "success" && opened.length === 1, d.txs.openCase);

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

  // The bytecode on Sepolia must equal the build from the source in this repo, except the immutable slots
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

  console.log(failures === 0 ? "\nPASS: every check matched public on-chain data" : `\nFAIL: ${failures} checks failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
