// Reads and writes on chain. The interface has no server of its own; all data comes from public RPC.
import {
  createPublicClient,
  concat,
  createWalletClient,
  custom,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { baseSepolia, foundry, robinhoodTestnet, sepolia } from "viem/chains";

export const deskAbi = parseAbi([
  "struct Case { address token; uint256 totalLoss; uint256 maxReturn; uint256 rewardCap; bytes32 refundRoot; bytes32 evidenceHash; uint256 totalReturned; uint256 totalReward; uint256 totalRefund; uint256 totalClaimed; }",
  "function getCase(bytes32 caseId) view returns (Case)",
  "function currentTier(bytes32 caseId) view returns (bool open, uint16 rewardBps, uint64 until)",
  "function claimed(bytes32 caseId, address account) view returns (uint256)",
  "function claimable(bytes32 caseId, address account, uint256 allocation) view returns (uint256)",
  "function returnFunds(bytes32 caseId, uint256 amount, address rewardTo, uint256 minReward)",
  "function getTiers(bytes32 caseId) view returns ((uint64 until, uint16 rewardBps)[])",
  "function hashCaseTerms((bytes32 caseId, address token, uint256 totalLoss, uint256 maxReturn, uint256 rewardCap, bytes32 refundRoot, bytes32 evidenceHash, (uint64 until, uint16 rewardBps)[] tiers, uint256 nonce, uint256 chainId) terms) view returns (bytes32)",
  "function openCase((bytes32 caseId, address token, uint256 totalLoss, uint256 maxReturn, uint256 rewardCap, bytes32 refundRoot, bytes32 evidenceHash, (uint64 until, uint16 rewardBps)[] tiers, uint256 nonce, uint256 chainId) terms, bytes controllerSig)",
  "function claimRefund(bytes32 caseId, address account, uint256 allocation, bytes32[] proof)",
  "function revokeNonce(uint256 nonce, bytes controllerSig)",
  "function nonceUsed(uint256 nonce) view returns (bool)",
  "error CaseNotFound()",
  "event CaseOpened(bytes32 indexed caseId, address indexed token, uint256 totalLoss, bytes32 refundRoot, bytes32 evidenceHash)",
  "event FundsReturned(bytes32 indexed caseId, address indexed from, address indexed rewardTo, uint256 received, uint256 reward, uint256 refund, uint16 rewardBps)",
  "event RefundClaimed(bytes32 indexed caseId, address indexed account, uint256 amount)",
]);

export const notesAbi = parseAbi([
  "function post(bytes32 topic, string text)",
  "event Note(bytes32 indexed topic, address indexed author, string text)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface CaseTerms {
  caseId: Hex;
  token: Address;
  totalLoss: string;
  maxReturn: string;
  rewardCap: string;
  refundRoot: Hex;
  evidenceHash: Hex;
  tiers: { until: string; rewardBps: number }[];
  nonce: string;
  chainId: string;
}

export interface Allocation {
  account: Address;
  allocation: string;
  proof: Hex[];
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
}

// The public record hashed into evidenceHash. Special conditions live here, so they cannot change later,
// but the contract does not enforce them.
export interface Evidence {
  incident?: string;
  offer?: { conditions: string; officialPost?: string };
  [key: string]: unknown;
}

// The contract counts one case per token. The interface groups the cases of one incident together.
export interface CaseInfo {
  id: string;
  incidentId: string;
  incident: string;
  attacker?: Address;
  token: TokenInfo;
  vault?: Address;
  terms: CaseTerms;
  evidence?: Evidence;
  allocations: Allocation[];
  txs: Record<string, Hash>;
  openBlock: string;
}

// An asset that was taken but has no offer from the protocol yet, so there is no case on the contract.
export interface PendingAsset {
  id: string;
  incidentId: string;
  incident: string;
  attacker?: Address;
  token: TokenInfo;
  vault?: Address;
  totalLoss: string;
  refundRoot: Hex;
  allocations: Allocation[];
  txs: Record<string, Hash>;
}

export interface IncidentInfo {
  id: string;
  name: string;
  summary: string;
  fictional: boolean;
}

export interface NearRecord {
  simulated: boolean;
  controllerAccount?: string;
  derivationPath?: string;
  guardians?: string[];
  threshold?: number;
  proposalId?: string;
  txs?: Record<string, string>;
}

export interface Deployment {
  network: "local" | "sepolia";
  chainId: number;
  rpc?: string;
  contracts: { Pactum: Address; PublicNotes?: Address; MockUSD?: Address; VulnerableVault?: Address };
  // Block to start reading public notes from.
  notesBlock?: string;
  controllerAddress: Address;
  near: NearRecord;
  actors: {
    attacker: Address;
    rewardWallet: Address;
    hackers?: { address: Address; rewardWallet: Address }[];
    newWallet?: Address;
    stranger?: Address;
    relayer?: Address;
    owner?: Address;
    users: Address[];
  };
  incidents: IncidentInfo[];
  cases: CaseInfo[];
  pending: PendingAsset[];
}

// demo.ts output holds one case and no `incidents`, so convert it to the same shape.
export function normalizeDeployment(raw: Record<string, unknown>): Deployment {
  const data = raw as unknown as Deployment & { terms?: CaseTerms; allocations?: Allocation[]; txs?: Record<string, Hash>; openBlock?: string; evidence?: Evidence };
  if (Array.isArray(data.incidents)) return data;
  const token = data.contracts.MockUSD as Address;
  return {
    ...data,
    pending: [],
    incidents: [
      {
        id: "demo",
        name: "Demo protocol",
        summary: "An intentionally buggy test vault was drained. This case runs the whole flow through NEAR Chain Signatures.",
        fictional: true,
      },
    ],
    cases: [
      {
        id: "demo-musd",
        incidentId: "demo",
        incident: "Demo protocol",
        token: { address: token, symbol: "mUSD", name: "Mock USD", decimals: 18, priceUsd: 1 },
        vault: data.contracts.VulnerableVault,
        terms: data.terms as CaseTerms,
        evidence: data.evidence,
        allocations: data.allocations as Allocation[],
        txs: data.txs as Record<string, Hash>,
        openBlock: data.openBlock as string,
      },
    ],
  };
}

export interface NearTerms {
  case_id: Hex;
  token: Address;
  total_loss: string;
  max_return: string;
  reward_cap: string;
  refund_root: Hex;
  evidence_hash: Hex;
  tiers: { until: string; reward_bps: number }[];
  nonce: string;
  chain_id: string;
}

export interface NearProposalCase {
  terms: NearTerms;
  digest: string;
  status: string;
  signature: Hex | null;
  revocation: Hex | null;
}

export interface NearProposal {
  id: string;
  status: string;
  approvals: string[];
  cancel_votes: string[];
  evidence: string;
  cases: NearProposalCase[];
}

export interface NearGuardianVote {
  id: string;
  guardians: string[];
  threshold: number;
  approvals: string[];
  status: string;
}

export interface NearChainVote {
  id: string;
  chain_id: string;
  pactum: Address;
  approvals: string[];
  status: string;
}

export interface NearConfig {
  guardians: string[];
  threshold: number;
  deployments: { chain_id: string; pactum: Address }[];
  derivation_path: string;
  signer_contract: string;
  max_reward_bps: number;
}

// The chains the testnet build serves. The Guardians page reads from here, even in the local build.
export const TESTNET_CHAINS: Record<string, { label: string; chain: Chain; rpc: string; explorer: string }> = {
  [sepolia.id]: { label: "Sepolia", chain: sepolia, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
  [baseSepolia.id]: { label: "Base Sepolia", chain: baseSepolia, rpc: "https://base-sepolia-rpc.publicnode.com", explorer: "https://sepolia.basescan.org" },
  [robinhoodTestnet.id]: { label: "Robinhood testnet", chain: robinhoodTestnet, rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com" },
};

const rpcOf = (deployment: Deployment) => deployment.rpc ?? "https://ethereum-sepolia-rpc.publicnode.com";

export function chainOf(deployment: Deployment): Chain {
  return deployment.network === "local" ? foundry : sepolia;
}

export function publicClientOf(deployment: Deployment): PublicClient {
  return createPublicClient({ chain: chainOf(deployment), transport: http(rpcOf(deployment)) });
}

export function txUrl(deployment: Deployment, hash: string): string | null {
  return deployment.network === "sepolia" ? `https://sepolia.etherscan.io/tx/${hash}` : null;
}

export function addressUrl(deployment: Deployment, address: string): string | null {
  return deployment.network === "sepolia" ? `https://sepolia.etherscan.io/address/${address}` : null;
}

export function nearTxUrl(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

export function nearAccountUrl(account: string): string {
  return `https://testnet.nearblocks.io/address/${account}`;
}

async function nearQuery(params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const response = await fetch("https://test.rpc.fastnear.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "pactum", method: "query", params: { finality: "final", ...params } }),
  });
  const json = await response.json();
  return (json?.result as Record<string, unknown> | undefined) ?? null;
}

// Calls a NEAR contract's view function over public RPC, with no wallet and no server.
export async function nearView<T>(account: string, method: string, args: Record<string, unknown>): Promise<T | null> {
  const result = await nearQuery({ request_type: "call_function", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  const bytes = result?.result as number[] | undefined;
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
}

export async function nearAccessKeyCount(account: string): Promise<number | null> {
  const result = await nearQuery({ request_type: "view_access_key_list", account_id: account });
  const keys = result?.keys as unknown[] | undefined;
  return keys ? keys.length : null;
}

export async function fetchNearProposal(deployment: Deployment): Promise<NearProposal | null> {
  const { controllerAccount, proposalId } = deployment.near;
  if (!controllerAccount || proposalId === undefined) return null;
  return await nearView<NearProposal>(controllerAccount, "get_proposal", { proposal_id: proposalId });
}

// Whether the case is open on its target chain. Returns null when that chain cannot be read.
export async function caseIsOpen(chainId: string, pactum: Address, caseId: Hex): Promise<boolean | null> {
  const target = TESTNET_CHAINS[chainId];
  if (!target) return null;
  try {
    const client = createPublicClient({ chain: target.chain, transport: http(target.rpc) }) as PublicClient;
    const info = await client.readContract({ address: pactum, abi: deskAbi, functionName: "getCase", args: [caseId] });
    return info.token !== "0x0000000000000000000000000000000000000000";
  } catch (reason) {
    // getCase reverts for a case that is not open. That is an answer, not a read failure.
    return reason instanceof Error && reason.message.includes("CaseNotFound") ? false : null;
  }
}

// Checks the refund list in the browser: the total must equal the loss, and every proof must lead to the signed root.
export function checkRefundList(allocations: { account: string; allocation: string | bigint; proof: readonly string[] }[], root: string, totalLoss: bigint): { ok: boolean; wallets: number; reason: string } {
  const wallets = allocations.length;
  if (wallets === 0) return { ok: false, wallets, reason: "This offer has no refund list." };
  const total = allocations.reduce((sum, item) => sum + BigInt(item.allocation), 0n);
  if (total !== totalLoss) return { ok: false, wallets, reason: `The list adds up to a different amount than the total loss, so refunds would be locked or misallocated.` };
  const valid = allocations.every((item) => {
    const leaf = keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [item.account as Address, BigInt(item.allocation)])));
    const computed = item.proof.reduce<Hex>((hash, sibling) => {
      const [low, high] = BigInt(hash) < BigInt(sibling) ? [hash, sibling as Hex] : [sibling as Hex, hash];
      return keccak256(concat([low, high]));
    }, leaf);
    return computed.toLowerCase() === root.toLowerCase();
  });
  return valid ? { ok: true, wallets, reason: "" } : { ok: false, wallets, reason: "A proof in this list does not match the signed root." };
}

// Whether the nonce is spent: true once the case is open or revoked.
export async function nonceIsUsed(chainId: string, pactum: Address, nonce: string): Promise<boolean | null> {
  const target = TESTNET_CHAINS[chainId];
  if (!target) return null;
  try {
    const client = createPublicClient({ chain: target.chain, transport: http(target.rpc) }) as PublicClient;
    return await client.readContract({ address: pactum, abi: deskAbi, functionName: "nonceUsed", args: [BigInt(nonce)] });
  } catch {
    return null;
  }
}

// Relays a signature from NEAR to its chain. Anyone can send it, because the contract only trusts the controller's signature.
export async function relayToChain(chainId: string, pactum: Address, persona: Persona | null, action: { open: NearTerms; signature: Hex } | { revokeNonce: string; signature: Hex }): Promise<Hash> {
  const target = TESTNET_CHAINS[chainId];
  if (!target) throw new Error(`Chain ${chainId} is not supported here.`);
  let client;
  let account: LocalAccount | Address;
  if (persona) {
    account = persona.account;
    client = createWalletClient({ account, chain: target.chain, transport: http(target.rpc) });
  } else {
    const provider = injected();
    if (!provider) throw new Error("No browser wallet found.");
    account = await connectInjected();
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${target.chain.id.toString(16)}` }] });
    client = createWalletClient({ account, chain: target.chain, transport: custom(provider) });
  }
  const hash = "open" in action
    ? await client.writeContract({
        account,
        chain: target.chain,
        address: pactum,
        abi: deskAbi,
        functionName: "openCase",
        args: [
          {
            caseId: action.open.case_id,
            token: action.open.token,
            totalLoss: BigInt(action.open.total_loss),
            maxReturn: BigInt(action.open.max_return),
            rewardCap: BigInt(action.open.reward_cap),
            refundRoot: action.open.refund_root,
            evidenceHash: action.open.evidence_hash,
            tiers: action.open.tiers.map((tier) => ({ until: BigInt(tier.until), rewardBps: tier.reward_bps })),
            nonce: BigInt(action.open.nonce),
            chainId: BigInt(action.open.chain_id),
          },
          action.signature,
        ],
      })
    : await client.writeContract({ account, chain: target.chain, address: pactum, abi: deskAbi, functionName: "revokeNonce", args: [BigInt(action.revokeNonce), action.signature] });
  const receipt = await (createPublicClient({ chain: target.chain, transport: http(target.rpc) }) as PublicClient).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction reverted.");
  return hash;
}

export interface DemoGuardian {
  accountId: string;
  secretKey: string;
}

// NEAR keys of the test guardians, only present on the dev server while recording. A production build holds no keys.
export function demoGuardians(): DemoGuardian[] {
  if (!import.meta.env.DEV || !import.meta.env.VITE_DEMO_GUARDIANS) return [];
  return JSON.parse(import.meta.env.VITE_DEMO_GUARDIANS) as DemoGuardian[];
}

// Calls a NEAR contract with a test key. The NEAR library is only loaded when needed.
export async function guardianCall(guardian: DemoGuardian, controller: string, method: string, proposalId: string): Promise<void> {
  if (!import.meta.env.DEV) throw new Error("Guardians sign with their own NEAR key.");
  const { Account, JsonRpcProvider } = await import("near-api-js");
  const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
  const account = new Account(guardian.accountId, provider, guardian.secretKey as `ed25519:${string}`);
  const outcome = await account.callFunctionRaw({
    contractId: controller,
    methodName: method,
    args: { proposal_id: proposalId },
    gas: 300_000_000_000_000n,
    deposit: 0n,
    waitUntil: "FINAL",
  });
  const failure = (outcome.status as { Failure?: unknown }).Failure;
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
}

// The case id is derived from the incident and the token, so a reload still finds an offer that was just created.
export function offerCaseId(incidentId: string, symbol: string): Hex {
  return keccak256(stringToHex(`offer:${incidentId}:${symbol}`));
}

export function counterTopic(incidentId: string): Hex {
  return keccak256(stringToHex(`counter:${incidentId}`));
}

export function discussionTopic(incidentId: string): Hex {
  return keccak256(stringToHex(`discussion:${incidentId}`));
}

export function hashEvidence(evidence: Evidence): Hex {
  return keccak256(stringToHex(JSON.stringify(evidence)));
}

// Local mode only: a test key plays the controller in place of the guardians on NEAR.
export async function signAsSimulatedController(digest: Hex): Promise<Hex> {
  const account = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 });
  return await account.sign!({ hash: digest });
}

export type Persona = { name: string; address: Address; account: LocalAccount };

// Test accounts for clicking around without a wallet. A production build never holds real keys:
// Anvil's mnemonic is public, and VITE_DEMO_KEYS is only read by the dev server.
export function demoPersonas(deployment: Deployment): Persona[] {
  const accounts: { name: string; account: LocalAccount }[] = [];
  if (deployment.network === "local") {
    const mnemonic = "test test test test test test test test test test test junk";
    const at = (addressIndex: number) => mnemonicToAccount(mnemonic, { addressIndex });
    accounts.push(
      { name: "Hacker", account: at(4) },
    );
    if (deployment.actors.hackers) accounts.push({ name: "Hacker 2", account: at(10) }, { name: "Hacker 3", account: at(11) });
    if (deployment.actors.newWallet) accounts.push({ name: "New wallet", account: at(12) });
    accounts.push(
      { name: "User 1", account: at(1) },
      { name: "User 2", account: at(2) },
      { name: "User 3", account: at(3) },
    );
    if (deployment.actors.users.length > 3) accounts.push({ name: "User 4", account: at(6) });
    if (deployment.actors.owner) accounts.push({ name: "Protocol owner", account: at(8) });
    if (deployment.actors.stranger) accounts.push({ name: "Stranger", account: at(7) });
  } else if (import.meta.env.DEV && import.meta.env.VITE_DEMO_KEYS) {
    const keys = JSON.parse(import.meta.env.VITE_DEMO_KEYS) as Record<string, Hex>;
    const names: [string, string][] = [["Hacker", "attacker"], ["User 1", "alice"], ["User 2", "bob"], ["User 3", "carol"]];
    for (const [name, key] of names) {
      const value = keys[key];
      if (value) accounts.push({ name, account: privateKeyToAccount(value) });
    }
  }
  return accounts.map(({ name, account }) => ({ name, address: account.address, account }));
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193 | undefined {
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function hasInjectedWallet(): boolean {
  return injected() !== undefined;
}

export async function connectInjected(): Promise<Address> {
  const provider = injected();
  if (!provider) throw new Error("No browser wallet found.");
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  if (!address) throw new Error("The wallet returned no account.");
  return address;
}

// Uses a test account if there is one, otherwise the browser wallet.
export async function walletFor(deployment: Deployment, persona: Persona | null) {
  const chain = chainOf(deployment);
  if (persona) {
    return { client: createWalletClient({ account: persona.account, chain, transport: http(rpcOf(deployment)) }), account: persona.account };
  }
  const provider = injected();
  if (!provider) throw new Error("No browser wallet found.");
  const address = await connectInjected();
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
  return { client: createWalletClient({ account: address, chain, transport: custom(provider) }), account: address };
}
