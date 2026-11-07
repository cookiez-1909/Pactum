// Simulated situations on Anvil: real transactions over RPC and real chain time travel.
// The controller here is a test key, i.e. SIMULATED, unrelated to NEAR.
// Each situation states its expected result. The script exits non-zero if any situation is wrong.
import { spawn } from "node:child_process";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { mnemonicToAccount, type LocalAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { ONE_TOKEN, artifact, buildRefundTree, type Allocation, type CaseTerms } from "./lib/common.ts";

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const MNEMONIC = "test test test test test test test test test test test junk";
const DAY = 86_400n;
const M = 1_000_000n * ONE_TOKEN;

const account = (addressIndex: number) => mnemonicToAccount(MNEMONIC, { addressIndex });
const deployer = account(0);
const alice = account(1);
const bob = account(2);
const carol = account(3);
const attacker = account(4);
const stranger = account(5);
const team = account(6);
const rewardWallet = account(7).address;
const controller = account(9);
const wrongSigner = account(8);

const transport = http(RPC);
const client = createPublicClient({ chain: foundry, transport });
const test = createTestClient({ mode: "anvil", chain: foundry, transport });
const wallet = (from: LocalAccount) => createWalletClient({ account: from, chain: foundry, transport });

const { abi: deskAbi, bytecode: deskCode } = artifact("Pactum");
const { abi: usdAbi, bytecode: usdCode } = artifact("MockUSD");
const { abi: vaultAbi, bytecode: vaultCode } = artifact("VulnerableVault");
const { abi: feeAbi, bytecode: feeCode } = artifact("FeeOnTransferToken", "TestTokens.sol");
const { abi: evilAbi, bytecode: evilCode } = artifact("ReentrantToken", "TestTokens.sol");
const { abi: mockAbi, bytecode: mockCode } = artifact("MockToken");

let desk: Address;
let usd: Address;
let nextNonce = 1n;
let passed = 0;
const failures: string[] = [];

async function deploy(abi: Abi, bytecode: Hex, args: unknown[] = []): Promise<Address> {
  const hash = await wallet(deployer).deployContract({ abi, bytecode, args, account: deployer, chain: foundry });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function send(from: LocalAccount, to: Address, abi: Abi, functionName: string, args: unknown[]): Promise<Hash> {
  const hash = await wallet(from).writeContract({ account: from, chain: foundry, address: to, abi, functionName, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return hash;
}

const read = <T>(to: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
  client.readContract({ address: to, abi, functionName, args }) as Promise<T>;
const balance = (token: Address, who: Address) => read<bigint>(token, usdAbi, "balanceOf", [who]);
const mint = (token: Address, to: Address, amount: bigint, abi: Abi = usdAbi) => send(deployer, token, abi, "mint", [to, amount]);
const approve = (from: LocalAccount, token: Address, amount: bigint = 2n ** 255n) => send(from, token, usdAbi, "approve", [desk, amount]);
const getCase = (caseId: Hex) =>
  read<{ totalReturned: bigint; totalReward: bigint; totalRefund: bigint; totalClaimed: bigint }>(desk, deskAbi, "getCase", [caseId]);

async function now(): Promise<bigint> {
  return (await client.getBlock()).timestamp;
}

// Moves chain time to just after the given deadline.
async function warpTo(timestamp: bigint): Promise<void> {
  await test.setNextBlockTimestamp({ timestamp });
  await test.mine({ blocks: 1 });
}

// Gets the Solidity error name from a failed call, to check the exact reason rather than just "it reverted".
async function revertReason(from: LocalAccount, to: Address, abi: Abi, functionName: string, args: unknown[]): Promise<string> {
  try {
    await client.simulateContract({ account: from, address: to, abi, functionName, args });
    return "NO_REVERT";
  } catch (error) {
    if (error instanceof BaseError) {
      const cause = error.walk((item) => item instanceof ContractFunctionRevertedError);
      if (cause instanceof ContractFunctionRevertedError) return cause.data?.errorName ?? cause.signature ?? "REVERT";
    }
    return "REVERT";
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

async function scenario(name: string, body: () => Promise<string>): Promise<void> {
  try {
    const note = await body();
    passed += 1;
    console.log(`PASS  ${name}\n      ${note}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

interface CaseOptions {
  token?: Address;
  totalLoss?: bigint;
  maxReturn?: bigint;
  rewardCap?: bigint;
  entries?: { account: Address; allocation: bigint }[];
  tiers?: { until: bigint; rewardBps: number }[];
}

const DEFAULT_ENTRIES = () => [
  { account: alice.address, allocation: 600_000n * ONE_TOKEN },
  { account: bob.address, allocation: 300_000n * ONE_TOKEN },
  { account: carol.address, allocation: 100_000n * ONE_TOKEN },
];

async function buildTerms(options: CaseOptions = {}): Promise<{ terms: CaseTerms; allocations: Allocation[] }> {
  const start = await now();
  const { root, allocations } = buildRefundTree(options.entries ?? DEFAULT_ENTRIES());
  const nonce = nextNonce++;
  const totalLoss = options.totalLoss ?? M;
  return {
    allocations,
    terms: {
      caseId: keccak256(stringToHex(`scenario-${nonce}`)),
      token: options.token ?? usd,
      totalLoss,
      maxReturn: options.maxReturn ?? totalLoss,
      rewardCap: options.rewardCap ?? 200_000n * ONE_TOKEN,
      refundRoot: root,
      evidenceHash: keccak256(stringToHex(`evidence-${nonce}`)),
      tiers: options.tiers ?? [
        { until: start + DAY, rewardBps: 1500 },
        { until: start + 3n * DAY, rewardBps: 1000 },
        { until: start + 7n * DAY, rewardBps: 500 },
      ],
      nonce,
      chainId: BigInt(foundry.id),
    },
  };
}

async function sign(terms: CaseTerms, signer: LocalAccount = controller, target: Address = desk): Promise<Hex> {
  const digest = await read<Hex>(target, deskAbi, "hashCaseTerms", [terms]);
  return await signer.sign!({ hash: digest });
}

async function openCase(options: CaseOptions = {}) {
  const built = await buildTerms(options);
  await send(deployer, desk, deskAbi, "openCase", [built.terms, await sign(built.terms)]);
  return built;
}

const claim = (terms: CaseTerms, entry: Allocation, from: LocalAccount = stranger) =>
  send(from, desk, deskAbi, "claimRefund", [terms.caseId, entry.account, entry.allocation, entry.proof]);

async function fundAttacker(amount: bigint, token: Address = usd): Promise<void> {
  await mint(token, attacker.address, amount);
  await approve(attacker, token);
}

async function clearBalance(who: LocalAccount): Promise<void> {
  const amount = await balance(usd, who.address);
  if (amount > 0n) await send(who, usd, usdAbi, "transfer", ["0x000000000000000000000000000000000000dEaD", amount]);
}

async function main(): Promise<void> {
  console.log("Pactum scenarios on a local Anvil node. The controller is SIMULATED with a test key.\n");
  desk = await deploy(deskAbi, deskCode, [controller.address]);
  usd = await deploy(usdAbi, usdCode);

  await scenario("Full flow: hack, return all at 15%, everyone claims", async () => {
    const vault = await deploy(vaultAbi, vaultCode, [usd]);
    for (const entry of DEFAULT_ENTRIES()) {
      const user = [alice, bob, carol].find((item) => item.address === entry.account)!;
      await mint(usd, user.address, entry.allocation);
      await send(user, usd, usdAbi, "approve", [vault, entry.allocation]);
      await send(user, vault, vaultAbi, "deposit", [entry.allocation]);
    }
    await send(attacker, vault, vaultAbi, "emergencyWithdraw", [attacker.address]);
    eq(await balance(usd, attacker.address), M, "attacker balance");
    const { terms, allocations } = await openCase();
    await approve(attacker, usd);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, M, rewardWallet, 0n]);
    eq(await balance(usd, rewardWallet), 150_000n * ONE_TOKEN, "reward");
    for (const entry of allocations) await claim(terms, entry);
    eq(await balance(usd, alice.address), 510_000n * ONE_TOKEN, "alice refund");
    eq(await balance(usd, bob.address), 255_000n * ONE_TOKEN, "bob refund");
    eq(await balance(usd, carol.address), 85_000n * ONE_TOKEN, "carol refund");
    await Promise.all([clearBalance(alice), clearBalance(bob), clearBalance(carol)]);
    return "reward 150,000; refunds 510,000 + 255,000 + 85,000 = 850,000";
  });

  await scenario("Reward falls over time, partial returns use the tier at that moment", async () => {
    const { terms } = await openCase({ rewardCap: M });
    await fundAttacker(300_000n * ONE_TOKEN);
    const start = terms.tiers[0]!.until;
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardWallet, 0n]);
    let state = await getCase(terms.caseId);
    eq(state.totalReward, 15_000n * ONE_TOKEN, "reward at 15%");
    await warpTo(start + 1n);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardWallet, 0n]);
    state = await getCase(terms.caseId);
    eq(state.totalReward, 25_000n * ONE_TOKEN, "reward after 10% tier");
    await warpTo(terms.tiers[1]!.until + 1n);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardWallet, 0n]);
    state = await getCase(terms.caseId);
    eq(state.totalReward, 30_000n * ONE_TOKEN, "reward after 5% tier");
    eq(state.totalRefund, 270_000n * ONE_TOKEN, "refund");
    return "3 returns of 100,000 at 15%, 10%, 5%: rewards 15,000 + 10,000 + 5,000";
  });

  await scenario("After the last tier: return reverts, funds stay with the caller, refunds stay claimable", async () => {
    const { terms, allocations } = await openCase();
    await fundAttacker(1000n * ONE_TOKEN);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 500n * ONE_TOKEN, rewardWallet, 0n]);
    await warpTo(terms.tiers[2]!.until + 1n);
    const held = await balance(usd, attacker.address);
    eq(await revertReason(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 500n * ONE_TOKEN, rewardWallet, 0n]), "CaseClosed", "late return");
    eq(await balance(usd, attacker.address), held, "attacker funds untouched");
    const open = await read<[boolean, number, bigint]>(desk, deskAbi, "currentTier", [terms.caseId]);
    eq(open[0], false, "tier open");
    await warpTo((await now()) + 365n * DAY);
    await claim(terms, allocations[0]!);
    eq(await balance(usd, alice.address), (425n * ONE_TOKEN * 600n) / 1000n, "late claim");
    await clearBalance(alice);
    return "late return rejected with CaseClosed; a claim one year later still paid 255";
  });

  await scenario("Reward cap reached across returns, the excess becomes refunds", async () => {
    const { terms } = await openCase({ rewardCap: 20_000n * ONE_TOKEN });
    await fundAttacker(300_000n * ONE_TOKEN);
    const paid: bigint[] = [];
    for (let index = 0; index < 3; index += 1) {
      const before = await balance(usd, rewardWallet);
      await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardWallet, 0n]);
      paid.push((await balance(usd, rewardWallet)) - before);
    }
    eq(paid.join(), [15_000n, 5_000n, 0n].map((value) => value * ONE_TOKEN).join(), "rewards per return");
    const state = await getCase(terms.caseId);
    eq(state.totalReward, 20_000n * ONE_TOKEN, "total reward");
    eq(state.totalRefund, 280_000n * ONE_TOKEN, "total refund");
    return "rewards 15,000 then 5,000 then 0; refund pool 280,000";
  });

  await scenario("Team hacks itself: the most it can take is the reward cap, and users keep the rest", async () => {
    const { terms, allocations } = await openCase({ rewardCap: 50_000n * ONE_TOKEN });
    await mint(usd, team.address, M);
    await approve(team, usd);
    await send(team, desk, deskAbi, "returnFunds", [terms.caseId, M, team.address, 0n]);
    eq(await balance(usd, team.address), 50_000n * ONE_TOKEN, "team take");
    for (const entry of allocations) await claim(terms, entry);
    eq(await balance(usd, alice.address), 570_000n * ONE_TOKEN, "alice");
    await Promise.all([clearBalance(alice), clearBalance(bob), clearBalance(carol), clearBalance(team)]);
    return "team took 50,000, not 150,000. The weakness stays: it still profits from its own hack";
  });

  await scenario("Two people return parts, each reward goes to its own address, users re-claim", async () => {
    const { terms, allocations } = await openCase();
    await fundAttacker(100_000n * ONE_TOKEN);
    await mint(usd, stranger.address, 100_000n * ONE_TOKEN);
    await approve(stranger, usd);
    const rewardA = account(10).address;
    const rewardB = account(11).address;
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardA, 0n]);
    await claim(terms, allocations[0]!);
    const first = await balance(usd, alice.address);
    eq(first, 51_000n * ONE_TOKEN, "first claim");
    await send(stranger, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardB, 0n]);
    await claim(terms, allocations[0]!);
    eq(await balance(usd, alice.address), 102_000n * ONE_TOKEN, "second claim");
    eq(await balance(usd, rewardA), 15_000n * ONE_TOKEN, "reward A");
    eq(await balance(usd, rewardB), 15_000n * ONE_TOKEN, "reward B");
    await clearBalance(alice);
    return "user 1 claimed 51,000 then 51,000 more; rewards 15,000 to each address";
  });

  await scenario("Returning more than the case accepts pulls only the allowed amount", async () => {
    const { terms } = await openCase({ maxReturn: 400_000n * ONE_TOKEN });
    await fundAttacker(M);
    const before = await balance(usd, attacker.address);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, M, rewardWallet, 0n]);
    eq(before - (await balance(usd, attacker.address)), 400_000n * ONE_TOKEN, "pulled");
    eq(await revertReason(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 1n, rewardWallet, 0n]), "NothingToReturn", "after full");
    return "asked 1,000,000, pulled 400,000; another return reverts with NothingToReturn";
  });

  await scenario("Signatures: forged, tampered, replayed and for another desk are all rejected", async () => {
    const built = await buildTerms();
    const good = await sign(built.terms);
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [built.terms, await sign(built.terms, wrongSigner)]), "InvalidSignature", "wrong signer");
    const tampered = { ...built.terms, rewardCap: built.terms.rewardCap + 1n };
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [tampered, good]), "InvalidSignature", "tampered");
    const higher = { ...built.terms, tiers: [{ ...built.terms.tiers[0]!, rewardBps: 9000 }, ...built.terms.tiers.slice(1)] };
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [higher, good]), "InvalidSignature", "raised reward");
    const otherDesk = await deploy(deskAbi, deskCode, [controller.address]);
    eq(await revertReason(deployer, otherDesk, deskAbi, "openCase", [built.terms, good]), "InvalidSignature", "other desk");
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [{ ...built.terms, chainId: 1n }, good]), "WrongChain", "wrong chain");
    await send(stranger, desk, deskAbi, "openCase", [built.terms, good]);
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [built.terms, good]), "NonceUsed", "replay");
    return "5 bad signatures rejected; an untrusted relayer opened the case with the good one; replay rejected";
  });

  await scenario("The controller cannot lower a reward after opening", async () => {
    const { terms } = await openCase();
    const changed = await buildTerms();
    const lower = { ...changed.terms, caseId: terms.caseId, tiers: [{ until: terms.tiers[0]!.until, rewardBps: 1 }] };
    eq(await revertReason(deployer, desk, deskAbi, "openCase", [lower, await sign(lower)]), "CaseExists", "overwrite");
    const tiers = await read<{ rewardBps: number }[]>(desk, deskAbi, "getTiers", [terms.caseId]);
    eq(tiers[0]!.rewardBps, 1500, "reward stays");
    return "a validly signed overwrite reverts with CaseExists; the reward stays 15%";
  });

  await scenario("Refund proofs: wrong, inflated, someone else's, and double claims are rejected", async () => {
    const { terms, allocations } = await openCase();
    await fundAttacker(M);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, M, rewardWallet, 0n]);
    const [first, second] = allocations as [Allocation, Allocation];
    const args = (entry: Allocation) => [terms.caseId, entry.account, entry.allocation, entry.proof];
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", [terms.caseId, first.account, first.allocation, second.proof]), "InvalidProof", "wrong proof");
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", [terms.caseId, first.account, first.allocation + 1n, first.proof]), "InvalidProof", "inflated");
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", [terms.caseId, attacker.address, first.allocation, first.proof]), "InvalidProof", "thief");
    await send(stranger, desk, deskAbi, "claimRefund", args(first));
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", args(first)), "NothingToClaim", "double claim");
    eq(await balance(usd, stranger.address), 0n, "gas payer keeps nothing");
    await clearBalance(alice);
    return "all rejected; a claim sent by a stranger paid only the entitled user";
  });

  await scenario("No team path: withdraw calls fail, and the pool does not move", async () => {
    const { terms } = await openCase();
    await fundAttacker(M);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, M, rewardWallet, 0n]);
    const before = await balance(usd, desk);
    // Looks for the selector in the bytecode: a call can revert for other reasons even when the function exists.
    const code = (await client.getCode({ address: desk }))!.toLowerCase();
    const candidates = ["withdraw(address,uint256)", "withdraw(uint256)", "emergencyWithdraw(address)", "sweep(address,address)", "sweep(address)", "transferOwnership(address)", "owner()", "upgradeToAndCall(address,bytes)", "rescueTokens(address,address,uint256)", "setRewardCap(bytes32,uint256)"];
    for (const signature of candidates) {
      const selector = keccak256(stringToHex(signature)).slice(2, 10);
      eq(code.includes(`63${selector}`), false, `${signature} is in the bytecode`);
    }
    const known = keccak256(stringToHex("returnFunds(bytes32,uint256,address,uint256)")).slice(2, 10);
    eq(code.includes(`63${known}`), true, "the check can find a real function");
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const,
      functionName: "withdraw",
      args: [usd, 0n],
    });
    const result = await client.call({ account: controller.address, to: desk, data }).then(() => "ok").catch(() => "reverted");
    eq(result, "reverted", "withdraw of 0");
    eq(await balance(usd, desk), before, "pool");
    return `none of ${candidates.length} privileged functions is in the bytecode; withdraw of 0 from the controller reverts`;
  });

  await scenario("Token with a 1% transfer fee: only what really arrived is accounted", async () => {
    const fee = await deploy(feeAbi, feeCode, [100n]);
    const { terms, allocations } = await openCase({ token: fee, rewardCap: M });
    await mint(fee, attacker.address, M, feeAbi);
    await approve(attacker, fee);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, M, rewardWallet, 0n]);
    const state = await getCase(terms.caseId);
    eq(state.totalReturned, 990_000n * ONE_TOKEN, "received");
    eq(state.totalReward + state.totalRefund, state.totalReturned, "split");
    for (const entry of allocations) await claim(terms, entry);
    eq(await balance(fee, desk), 0n, "fully paid out");
    return "sent 1,000,000, 990,000 arrived; reward + refund = 990,000; all claims funded";
  });

  await scenario("Different assets on one desk: mBTC with 8 decimals and mADA with 6 stay separate", async () => {
    const btc = await deploy(mockAbi, mockCode, ["Mock Wrapped Bitcoin", "mBTC", 8]);
    const ada = await deploy(mockAbi, mockCode, ["Mock Wrapped ADA", "mADA", 6]);
    const btcLoss = 125n * 10n ** 8n;
    const adaLoss = 14_000_000n * 10n ** 6n;
    const btcCase = await openCase({
      token: btc,
      totalLoss: btcLoss,
      rewardCap: 10n * 10n ** 8n,
      entries: [{ account: alice.address, allocation: btcLoss }],
    });
    const adaCase = await openCase({
      token: ada,
      totalLoss: adaLoss,
      rewardCap: adaLoss,
      entries: [{ account: bob.address, allocation: adaLoss }],
    });
    await fundAttacker(btcLoss, btc);
    await fundAttacker(adaLoss, ada);
    await send(attacker, desk, deskAbi, "returnFunds", [btcCase.terms.caseId, btcLoss, rewardWallet, 0n]);
    await send(attacker, desk, deskAbi, "returnFunds", [adaCase.terms.caseId, adaLoss / 2n, rewardWallet, 0n]);
    eq(await balance(btc, rewardWallet), 10n * 10n ** 8n, "BTC reward capped at 10");
    eq(await balance(ada, rewardWallet), 1_050_000n * 10n ** 6n, "ADA reward at 15% of half");
    await claim(btcCase.terms, btcCase.allocations[0]!);
    await claim(adaCase.terms, adaCase.allocations[0]!);
    eq(await balance(btc, alice.address), 115n * 10n ** 8n, "BTC refund");
    eq(await balance(ada, bob.address), 5_950_000n * 10n ** 6n, "ADA refund");
    eq(await balance(btc, bob.address), 0n, "no cross-asset payout");
    return "125 mBTC: reward 10 (capped), refund 115. Half of 14M mADA: reward 1,050,000, refund 5,950,000";
  });

  await scenario("No proof needed: funds moved through several wallets are returned from an unrelated one", async () => {
    const { terms, allocations } = await openCase();
    const [hopA, hopB, fresh] = [account(14), account(15), account(16)] as [LocalAccount, LocalAccount, LocalAccount];
    const payout = account(17).address;
    await mint(usd, attacker.address, 500_000n * ONE_TOKEN);
    await send(attacker, usd, usdAbi, "transfer", [hopA.address, 500_000n * ONE_TOKEN]);
    await send(hopA, usd, usdAbi, "transfer", [hopB.address, 500_000n * ONE_TOKEN]);
    await send(hopB, usd, usdAbi, "transfer", [fresh.address, 500_000n * ONE_TOKEN]);
    await approve(fresh, usd);
    await send(fresh, desk, deskAbi, "returnFunds", [terms.caseId, 500_000n * ONE_TOKEN, payout, 0n]);
    eq(await balance(usd, payout), 75_000n * ONE_TOKEN, "reward at 15%");
    await claim(terms, allocations[0]!);
    eq(await balance(usd, alice.address), 255_000n * ONE_TOKEN, "user refund");
    await clearBalance(alice);
    return "3 hops to a new wallet: it returned 500,000, a different wallet got the 75,000 reward, and users were paid";
  });

  await scenario("Malicious token tries to re-enter during the return", async () => {
    const evil = await deploy(evilAbi, evilCode);
    const { terms } = await openCase({ token: evil });
    await mint(evil, attacker.address, 1000n * ONE_TOKEN, evilAbi);
    await approve(attacker, evil);
    const payload = encodeFunctionData({ abi: deskAbi, functionName: "returnFunds", args: [terms.caseId, ONE_TOKEN, attacker.address, 0n] });
    await send(deployer, evil, evilAbi, "arm", [desk, payload, 0n]);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100n * ONE_TOKEN, rewardWallet, 0n]);
    eq(await read<boolean>(evil, evilAbi, "attacked"), true, "attack ran");
    eq(await read<boolean>(evil, evilAbi, "attackSucceeded"), false, "attack blocked");
    eq((await getCase(terms.caseId)).totalReturned, 100n * ONE_TOKEN, "accounting");
    return "the re-entrant call ran and was rejected; accounting stayed at 100";
  });

  await scenario("A bad refund root cannot take tokens from another case using the same token", async () => {
    const healthy = await openCase();
    const mallory = account(12);
    const trent = account(13);
    const bad = await openCase({ entries: [{ account: mallory.address, allocation: M }, { account: trent.address, allocation: M }] });
    await fundAttacker(M + 1000n * ONE_TOKEN);
    await send(attacker, desk, deskAbi, "returnFunds", [healthy.terms.caseId, M, rewardWallet, 0n]);
    await send(attacker, desk, deskAbi, "returnFunds", [bad.terms.caseId, 1000n * ONE_TOKEN, rewardWallet, 0n]);
    await claim(bad.terms, bad.allocations[0]!);
    eq(await balance(usd, mallory.address), 850n * ONE_TOKEN, "bad case pays its pool");
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", [bad.terms.caseId, trent.address, M, bad.allocations[1]!.proof]), "NothingToClaim", "pool empty");
    await claim(healthy.terms, healthy.allocations[0]!);
    eq(await balance(usd, alice.address), 510_000n * ONE_TOKEN, "healthy case intact");
    await clearBalance(alice);
    return "bad root over-allocated 2x and paid out only its 850 pool; the other case paid in full";
  });

  await scenario("Dust and rounding: tiny returns stay fully accounted and claims never exceed the pool", async () => {
    const entries = [
      { account: alice.address, allocation: 1n },
      { account: bob.address, allocation: 1n },
      { account: carol.address, allocation: 1n },
    ];
    const { terms, allocations } = await openCase({ totalLoss: 3n, entries, rewardCap: 1n });
    await fundAttacker(3n);
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 1n, rewardWallet, 0n]);
    let state = await getCase(terms.caseId);
    eq(state.totalReward, 0n, "reward rounds down");
    eq(state.totalRefund, 1n, "refund");
    eq(await revertReason(stranger, desk, deskAbi, "claimRefund", [terms.caseId, entries[0]!.account, 1n, allocations[0]!.proof]), "NothingToClaim", "1/3 wei rounds to 0");
    await send(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 2n, rewardWallet, 0n]);
    state = await getCase(terms.caseId);
    eq(state.totalReturned, 3n, "returned");
    for (const entry of allocations) await claim(terms, entry);
    state = await getCase(terms.caseId);
    eq(state.totalClaimed, state.totalRefund, "all claimed");
    await Promise.all([clearBalance(alice), clearBalance(bob), clearBalance(carol)]);
    return "1 wei gave no reward and no claimable share until more arrived; then all 3 wei were claimed";
  });

  await scenario("Known limit: tokens sent directly, or a reward sent to the desk itself, stay locked", async () => {
    const { terms } = await openCase();
    await fundAttacker(2000n * ONE_TOKEN);
    const before = await balance(usd, desk);
    await send(attacker, usd, usdAbi, "transfer", [desk, 1000n * ONE_TOKEN]);
    const untouched = await getCase(terms.caseId);
    eq(untouched.totalReturned, 0n, "direct transfer is not accounted");
    eq((await balance(usd, desk)) - before, 1000n * ONE_TOKEN, "locked");
    eq(await revertReason(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 1000n * ONE_TOKEN, desk, 0n]), "RewardToPactum", "reward to the contract");
    return "1,000 sent directly cannot be recovered, as the README says. A reward sent to the contract itself is refused";
  });

  await scenario("Anyone's approval is safe: a front-runner cannot return with the attacker's tokens", async () => {
    const { terms } = await openCase();
    await fundAttacker(1000n * ONE_TOKEN);
    const reason = await revertReason(stranger, desk, deskAbi, "returnFunds", [terms.caseId, 1000n * ONE_TOKEN, stranger.address, 0n]);
    eq(reason === "NO_REVERT", false, "front-run must revert");
    return `reverted with ${reason}, because returnFunds only pulls from msg.sender`;
  });

  await scenario("The holder's reward floor: a lower reward reverts and no token leaves the wallet", async () => {
    const { terms } = await openCase({ rewardCap: 15_000n * ONE_TOKEN });
    await fundAttacker(100_000n * ONE_TOKEN);
    await send(attacker, usd, usdAbi, "approve", [desk, 100_000n * ONE_TOKEN]);
    const [quoted] = await read<[bigint, bigint]>(desk, deskAbi, "quote", [terms.caseId, 100_000n * ONE_TOKEN]);
    // Someone else returns first and uses up the reward cap.
    await send(deployer, usd, usdAbi, "mint", [stranger.address, 100_000n * ONE_TOKEN]);
    await send(stranger, usd, usdAbi, "approve", [desk, 100_000n * ONE_TOKEN]);
    await send(stranger, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, stranger.address, 0n]);
    const before = await balance(usd, attacker.address);
    eq(await revertReason(attacker, desk, deskAbi, "returnFunds", [terms.caseId, 100_000n * ONE_TOKEN, rewardWallet, quoted]), "RewardTooLow", "front-run");
    eq(await balance(usd, attacker.address), before, "tokens stay");
    return `quoted ${quoted / ONE_TOKEN}, a front-runner used up the cap, and the holder's return reverted with RewardTooLow`;
  });

  await scenario("A signed offer is revoked before it opens: the old signature stops working", async () => {
    const { terms } = await buildTerms();
    const signature = await sign(terms);
    const digest = await client.readContract({ address: desk, abi: deskAbi, functionName: "hashRevokeNonce", args: [terms.nonce] }) as Hex;
    await send(stranger, desk, deskAbi, "revokeNonce", [terms.nonce, await controller.sign!({ hash: digest })]);
    const reason = await revertReason(stranger, desk, deskAbi, "openCase", [terms, signature]);
    if (reason !== "NonceUsed") throw new Error(`expected NonceUsed, got ${reason}`);
    return "openCase reverted with NonceUsed, and a stranger relayed the revocation";
  });

  await scenario("A case that is already open cannot be revoked", async () => {
    const { terms } = await openCase();
    const digest = await client.readContract({ address: desk, abi: deskAbi, functionName: "hashRevokeNonce", args: [terms.nonce] }) as Hex;
    const reason = await revertReason(stranger, desk, deskAbi, "revokeNonce", [terms.nonce, await controller.sign!({ hash: digest })]);
    if (reason !== "NonceUsed") throw new Error(`expected NonceUsed, got ${reason}`);
    return "revokeNonce reverted with NonceUsed, so a published offer stays published";
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const name of failures) console.log(`  failed: ${name}`);
    process.exitCode = 1;
  }
}

const anvil = spawn("anvil", ["--silent", "--port", String(PORT), "--accounts", "20"], { stdio: "ignore" });
const ready = async (): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await client.getChainId();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Anvil did not start");
};

ready()
  .then(main)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => anvil.kill());
