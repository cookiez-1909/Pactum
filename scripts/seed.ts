// Builds data for the interface on Anvil: several fictional hacks, several kinds of assets, several states.
// The controller is a test key, i.e. SIMULATED. Every protocol name here is made up, and every token is a mock.
// The transactions are real on Anvil: deposits, drains, opening cases, returns and claims.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  parseUnits,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { mnemonicToAccount, type LocalAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { ROOT, artifact, buildRefundTree, toJson, type CaseTerms } from "./lib/common.ts";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const MNEMONIC = "test test test test test test test test test test test junk";
const HOUR = 3600n;

// Account indexes must match demoPersonas in web/src/chain.ts.
const account = (addressIndex: number) => mnemonicToAccount(MNEMONIC, { addressIndex });
const deployer = account(0);
const user1 = account(1);
const user2 = account(2);
const user3 = account(3);
const hacker1 = account(4);
const hacker2 = account(10);
const hacker3 = account(11);
const rewardWallets = new Map([
  [hacker1.address, account(5).address],
  [hacker2.address, account(15).address],
  [hacker3.address, account(16).address],
]);
// A new wallet with no visible link to the hack, and two hop wallets the money passed through.
const newWallet = account(12);
const hopA = account(13);
const hopB = account(14);
const user4 = account(6);
const stranger = account(7);
const owner = account(8);
const controller = account(9);

const transport = http(RPC);
const client = createPublicClient({ chain: foundry, transport });
const test = createTestClient({ mode: "anvil", chain: foundry, transport });
const { abi: deskAbi, bytecode: deskCode } = artifact("Pactum");
const { abi: tokenAbi, bytecode: tokenCode } = artifact("MockToken");
const { abi: vaultAbi, bytecode: vaultCode } = artifact("VulnerableVault");

async function deploy(abi: Abi, bytecode: Hex, args: unknown[] = []): Promise<Address> {
  const hash = await createWalletClient({ account: deployer, chain: foundry, transport }).deployContract({
    abi,
    bytecode,
    args,
    account: deployer,
    chain: foundry,
  });
  return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
}

async function send(from: LocalAccount, to: Address, abi: Abi, functionName: string, args: unknown[]): Promise<Hash> {
  const wallet = createWalletClient({ account: from, chain: foundry, transport });
  const hash = await wallet.writeContract({ account: from, chain: foundry, address: to, abi, functionName, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return hash;
}

interface AssetSpec {
  symbol: string;
  name: string;
  decimals: number;
  // Made-up prices, only for adding totals in the interface.
  priceUsd: number;
}

const ASSETS = {
  btc: { symbol: "mBTC", name: "Mock Wrapped Bitcoin", decimals: 8, priceUsd: 80_000 },
  eth: { symbol: "mETH", name: "Mock Wrapped Ether", decimals: 18, priceUsd: 3_000 },
  hype: { symbol: "mHYPE", name: "Mock Wrapped HYPE", decimals: 18, priceUsd: 30 },
  ada: { symbol: "mADA", name: "Mock Wrapped ADA", decimals: 6, priceUsd: 0.6 },
  usdc: { symbol: "mUSDC", name: "Mock USD Coin", decimals: 6, priceUsd: 1 },
  usdt: { symbol: "mUSDT", name: "Mock Tether", decimals: 6, priceUsd: 1 },
  sol: { symbol: "mSOL", name: "Mock Wrapped Solana", decimals: 9, priceUsd: 150 },
  link: { symbol: "mLINK", name: "Mock Chainlink", decimals: 18, priceUsd: 15 },
} satisfies Record<string, AssetSpec>;

type AssetKey = keyof typeof ASSETS;
type Tiers = (now: bigint) => { until: bigint; rewardBps: number }[];

interface IncidentSpec {
  id: string;
  name: string;
  summary: string;
  attacker: LocalAccount;
  // How much each user lost of each asset, in whole tokens.
  losses: Partial<Record<AssetKey, [LocalAccount, string][]>>;
  // Without an offer the asset is only taken; there is no case on the contract yet.
  offer?: { tiers: Tiers; rewardShare: number; conditions: string };
  after?: (context: IncidentContext) => Promise<void>;
}

interface IncidentContext {
  returnFunds(asset: AssetKey, amount: string): Promise<void>;
  claim(asset: AssetKey, user: LocalAccount): Promise<void>;
}

let desk: Address;
let nextNonce = 1n;
const tokenAddresses = new Map<AssetKey, Address>();

async function tokenFor(key: AssetKey): Promise<Address> {
  const known = tokenAddresses.get(key);
  if (known) return known;
  const asset = ASSETS[key];
  const address = await deploy(tokenAbi, tokenCode, [asset.name, asset.symbol, asset.decimals]);
  tokenAddresses.set(key, address);
  return address;
}

const incidents: { id: string; name: string; summary: string; fictional: boolean }[] = [];
const cases: unknown[] = [];
const pending: unknown[] = [];

async function setUpIncident(spec: IncidentSpec): Promise<void> {
  incidents.push({ id: spec.id, name: spec.name, summary: spec.summary, fictional: true });
  const opened = new Map<AssetKey, { caseId: Hex; tree: ReturnType<typeof buildRefundTree>; txs: Record<string, Hash>; returns: number; claims: number }>();
  const stolen: string[] = [];

  for (const [key, losses] of Object.entries(spec.losses) as [AssetKey, [LocalAccount, string][]][]) {
    const asset = ASSETS[key];
    const units = (value: string) => parseUnits(value, asset.decimals);
    const token = await tokenFor(key);
    const vault = await deploy(vaultAbi, vaultCode, [token]);

    // Users deposit into the protocol, then the attacker exploits the bug and takes everything.
    const txs: Record<string, Hash> = {};
    for (const [index, [user, amount]] of losses.entries()) {
      await send(deployer, token, tokenAbi, "mint", [user.address, units(amount)]);
      await send(user, token, tokenAbi, "approve", [vault, units(amount)]);
      txs[`deposit${index}`] = await send(user, vault, vaultAbi, "deposit", [units(amount)]);
    }
    txs.drain = await send(spec.attacker, vault, vaultAbi, "emergencyWithdraw", [spec.attacker.address]);
    await send(spec.attacker, token, tokenAbi, "approve", [desk, 2n ** 255n]);

    const totalLoss = losses.reduce((sum, [, amount]) => sum + units(amount), 0n);
    const tree = buildRefundTree(losses.map(([user, amount]) => ({ account: user.address, allocation: units(amount) })));
    const shared = { incidentId: spec.id, incident: spec.name, attacker: spec.attacker.address, token: { address: token, ...asset }, vault, allocations: tree.allocations, txs };
    stolen.push(`${totalLoss / 10n ** BigInt(asset.decimals)} ${asset.symbol}`);

    if (!spec.offer) {
      pending.push({ id: `${spec.id}-${asset.symbol.toLowerCase()}`, ...shared, totalLoss, refundRoot: tree.root });
      continue;
    }

    const evidence = { incident: spec.name, protocol: vault, token, drainTx: txs.drain, totalLoss: totalLoss.toString(), offer: { conditions: spec.offer.conditions } };
    const now = (await client.getBlock()).timestamp;
    const terms: CaseTerms = {
      caseId: keccak256(stringToHex(`seed:${spec.id}:${asset.symbol}`)),
      token,
      totalLoss,
      maxReturn: totalLoss,
      rewardCap: (totalLoss * BigInt(Math.round(spec.offer.rewardShare * 10_000))) / 10_000n,
      refundRoot: tree.root,
      evidenceHash: keccak256(stringToHex(JSON.stringify(evidence))),
      tiers: spec.offer.tiers(now),
      nonce: nextNonce++,
      chainId: BigInt(foundry.id),
    };
    const digest = (await client.readContract({ address: desk, abi: deskAbi, functionName: "hashCaseTerms", args: [terms] })) as Hex;
    txs.openCase = await send(deployer, desk, deskAbi, "openCase", [terms, await controller.sign!({ hash: digest })]);
    const openBlock = (await client.getTransactionReceipt({ hash: txs.openCase })).blockNumber;
    opened.set(key, { caseId: terms.caseId, tree, txs, returns: 0, claims: 0 });
    cases.push({ id: `${spec.id}-${asset.symbol.toLowerCase()}`, ...shared, terms, evidence, openBlock });
  }

  await spec.after?.({
    async returnFunds(asset, amount) {
      const entry = opened.get(asset)!;
      entry.txs[`returnFunds${entry.returns++}`] = await send(spec.attacker, desk, deskAbi, "returnFunds", [entry.caseId, parseUnits(amount, ASSETS[asset].decimals), rewardWallets.get(spec.attacker.address)!]);
    },
    async claim(asset, user) {
      const entry = opened.get(asset)!;
      const allocation = entry.tree.allocations.find((item) => item.account === user.address)!;
      entry.txs[`claim${entry.claims++}`] = await send(deployer, desk, deskAbi, "claimRefund", [entry.caseId, allocation.account, allocation.allocation, allocation.proof]);
    },
  });
  console.log(`  ${spec.name.padEnd(20)} ${stolen.join(", ")}`);
}

const standardTiers: Tiers = (now) => [
  { until: now + 72n * HOUR, rewardBps: 1000 },
  { until: now + 168n * HOUR, rewardBps: 500 },
];

async function main() {
  console.log("Seeding fictional incidents on a local Anvil node. The controller is SIMULATED with a test key.");
  desk = await deploy(deskAbi, deskCode, [controller.address]);

  // This incident is built first because it needs time to pass its final deadline.
  await setUpIncident({
    id: "quillon",
    name: "Quillon DEX",
    attacker: hacker1,
    summary: "A pool math error let an attacker withdraw more than their share. The offer expired with only part of the funds back.",
    losses: {
      ada: [[user1, "8000000"], [user2, "4000000"], [user4, "2000000"]],
      usdc: [[user2, "300000"], [user3, "100000"]],
    },
    offer: {
      rewardShare: 0.1,
      conditions: "",
      tiers: (now) => [
        { until: now + HOUR, rewardBps: 1000 },
        { until: now + 2n * HOUR, rewardBps: 500 },
      ],
    },
    after: async ({ returnFunds, claim }) => {
      await returnFunds("ada", "4200000");
      await claim("ada", user1);
    },
  });
  const lastBlock = await client.getBlock();
  await test.setNextBlockTimestamp({ timestamp: lastBlock.timestamp + 3n * HOUR });
  await test.mine({ blocks: 1 });

  await setUpIncident({
    id: "kestrel",
    name: "Kestrel Bridge",
    attacker: hacker2,
    summary: "A forged withdrawal proof drained the bridge. The team made a special offer: keep 20% if everything comes back within two days.",
    losses: {
      btc: [[user1, "12"], [user2, "6"], [user3, "2"]],
      eth: [[user1, "10"], [user3, "5"]],
      hype: [[user2, "25000"], [user3, "15000"]],
    },
    offer: {
      rewardShare: 0.2,
      conditions: "Keep 20% and return 80% within 48 hours. The team will not contact you and will publish a full post-mortem. After 48 hours the reward falls to 10%.",
      tiers: (now) => [
        { until: now + 48n * HOUR, rewardBps: 2000 },
        { until: now + 168n * HOUR, rewardBps: 1000 },
      ],
    },
  });

  await setUpIncident({
    id: "tidewater",
    name: "Tidewater Perps",
    attacker: hacker1,
    summary: "A stale price feed let an attacker open and close positions at a profit across every market. The highest reward ends soon.",
    losses: {
      hype: [[user2, "500000"], [user3, "250000"], [user4, "100000"]],
      usdc: [[user1, "800000"], [user2, "400000"]],
      eth: [[user1, "200"], [user4, "100"]],
      btc: [[user3, "12"]],
      ada: [[user2, "2000000"], [user4, "1000000"]],
      sol: [[user1, "9000"], [user3, "3000"]],
      link: [[user2, "60000"]],
    },
    offer: {
      rewardShare: 0.15,
      conditions: "",
      tiers: (now) => [
        { until: now + HOUR / 3n, rewardBps: 1500 },
        { until: now + 72n * HOUR, rewardBps: 1000 },
        { until: now + 168n * HOUR, rewardBps: 500 },
      ],
    },
    after: async ({ returnFunds, claim }) => {
      await returnFunds("usdc", "600000");
      await returnFunds("eth", "120");
      await claim("usdc", user1);
    },
  });

  await setUpIncident({
    id: "northgate",
    name: "Northgate Lending",
    attacker: hacker3,
    summary: "A rounding bug in the vault share price. Everything came back, and the reward cap sent the excess to users.",
    losses: {
      usdc: [[user1, "1200000"], [user2, "500000"], [user3, "300000"]],
      eth: [[user1, "300"], [user2, "100"]],
    },
    offer: { rewardShare: 0.025, conditions: "", tiers: standardTiers },
    after: async ({ returnFunds, claim }) => {
      await returnFunds("usdc", "2000000");
      await returnFunds("eth", "400");
      await claim("usdc", user1);
      await claim("usdc", user2);
    },
  });

  // Hacker 2 moves Kestrel's mHYPE through two hop wallets to a new wallet, as in laundering.
  // The new wallet has no link to the hack, yet it can still return and collect the reward.
  const movedToken = tokenAddresses.get("hype")!;
  const moved = parseUnits("40000", ASSETS.hype.decimals);
  await send(hacker2, movedToken, tokenAbi, "transfer", [hopA.address, moved]);
  await send(hopA, movedToken, tokenAbi, "transfer", [hopB.address, moved]);
  await send(hopB, movedToken, tokenAbi, "transfer", [newWallet.address, moved]);

  // No offer yet: sign in as the Protocol owner to create one in the interface.
  await setUpIncident({
    id: "marlin",
    name: "Marlin Vaults",
    attacker: hacker3,
    summary: "An unprotected upgrade function let an attacker empty three vaults. The team has not published an offer yet.",
    losses: {
      btc: [[user1, "5"], [user4, "3"]],
      usdt: [[user2, "750000"], [user3, "250000"]],
      eth: [[user3, "90"], [user4, "30"]],
    },
  });

  const output = {
    network: "local",
    chainId: foundry.id,
    rpc: RPC,
    stage: "seeded",
    contracts: { Pactum: desk },
    controllerAddress: controller.address,
    near: { simulated: true },
    actors: {
      attacker: hacker1.address,
      rewardWallet: rewardWallets.get(hacker1.address),
      hackers: [hacker1, hacker2, hacker3].map((item) => ({ address: item.address, rewardWallet: rewardWallets.get(item.address) })),
      newWallet: newWallet.address,
      stranger: stranger.address,
      relayer: deployer.address,
      owner: owner.address,
      users: [user1.address, user2.address, user3.address, user4.address],
    },
    incidents,
    cases,
    pending,
  };
  mkdirSync(new URL("web/public/", ROOT), { recursive: true });
  writeFileSync(new URL("web/public/deployment.json", ROOT), toJson(output));
  console.log(`Saved web/public/deployment.json with ${incidents.length} incidents. Pactum ${desk}`);
  console.log("Anvil keeps running on port 8546 for the web app. Press Ctrl-C to stop.");
}

const anvil = spawn("anvil", ["--silent", "--port", String(PORT), "--accounts", "20"], { stdio: "ignore" });
const stop = () => {
  anvil.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

(async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await main();
  // Anvil has to keep running for the interface.
  await new Promise(() => {});
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  anvil.kill();
  process.exit(1);
});
