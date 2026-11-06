// Reads and writes on chain. The interface has no server of its own; all data comes from public RPC.
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

export const deskAbi = parseAbi([
  "struct Case { address token; uint256 totalLoss; uint256 maxReturn; uint256 rewardCap; bytes32 refundRoot; bytes32 evidenceHash; uint256 totalReturned; uint256 totalReward; uint256 totalRefund; uint256 totalClaimed; }",
  "function getCase(bytes32 caseId) view returns (Case)",
  "function currentTier(bytes32 caseId) view returns (bool open, uint16 rewardBps, uint64 until)",
  "function claimed(bytes32 caseId, address account) view returns (uint256)",
  "function claimable(bytes32 caseId, address account, uint256 allocation) view returns (uint256)",
  "function returnFunds(bytes32 caseId, uint256 amount, address rewardTo)",
  "function claimRefund(bytes32 caseId, address account, uint256 allocation, bytes32[] proof)",
  "event CaseOpened(bytes32 indexed caseId, address indexed token, uint256 totalLoss, bytes32 refundRoot, bytes32 evidenceHash)",
  "event FundsReturned(bytes32 indexed caseId, address indexed from, address indexed rewardTo, uint256 received, uint256 reward, uint256 refund, uint16 rewardBps)",
  "event RefundClaimed(bytes32 indexed caseId, address indexed account, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface Deployment {
  network: "local" | "sepolia";
  chainId: number;
  rpc?: string;
  stage: "open" | "complete";
  openBlock: string;
  contracts: { MockUSD: Address; VulnerableVault: Address; ReturnDesk: Address };
  controllerAddress: Address;
  near: {
    simulated: boolean;
    controllerAccount?: string;
    derivationPath?: string;
    guardians?: string[];
    threshold?: number;
    proposalId?: string;
    txs?: Record<string, string>;
  };
  actors: { users: Address[]; attacker: Address; rewardWallet: Address };
  terms: {
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
  };
  digest: Hex;
  signature: Hex;
  evidence: Record<string, unknown>;
  allocations: { account: Address; allocation: string; proof: Hex[] }[];
  txs: Record<string, Hash>;
}

export interface NearProposal {
  status: string;
  approvals: string[];
  digest: string;
}

export function chainOf(deployment: Deployment): Chain {
  return deployment.network === "local" ? foundry : sepolia;
}

export function publicClientOf(deployment: Deployment): PublicClient {
  const rpc = deployment.rpc ?? "https://ethereum-sepolia-rpc.publicnode.com";
  return createPublicClient({ chain: chainOf(deployment), transport: http(rpc) });
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

// Reads proposals straight from the NEAR contract over public RPC.
export async function fetchNearProposal(deployment: Deployment): Promise<NearProposal | null> {
  const { controllerAccount, proposalId } = deployment.near;
  if (!controllerAccount || proposalId === undefined) return null;
  const response = await fetch("https://test.rpc.fastnear.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "return-desk",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: controllerAccount,
        method_name: "get_proposal",
        args_base64: btoa(JSON.stringify({ proposal_id: proposalId })),
      },
    }),
  });
  const json = await response.json();
  const bytes = json?.result?.result as number[] | undefined;
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as NearProposal;
}

export type Persona = { name: string; address: Address; account: LocalAccount };

// Test accounts for clicking around without a wallet. A production build never holds these keys.
export function demoPersonas(deployment: Deployment): Persona[] {
  const accounts: { name: string; account: LocalAccount }[] = [];
  if (deployment.network === "local") {
    const mnemonic = "test test test test test test test test test test test junk";
    const at = (addressIndex: number) => mnemonicToAccount(mnemonic, { addressIndex });
    accounts.push(
      { name: "Attacker", account: at(4) },
      { name: "User 1", account: at(1) },
      { name: "User 2", account: at(2) },
      { name: "User 3", account: at(3) },
    );
  } else if (import.meta.env.DEV && import.meta.env.VITE_DEMO_KEYS) {
    const keys = JSON.parse(import.meta.env.VITE_DEMO_KEYS) as Record<string, Hex>;
    const names: [string, string][] = [["Attacker", "attacker"], ["User 1", "alice"], ["User 2", "bob"], ["User 3", "carol"]];
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

// Uses a test account if there is one, otherwise the browser wallet.
export async function walletFor(deployment: Deployment, persona: Persona | null) {
  const chain = chainOf(deployment);
  if (persona) {
    const rpc = deployment.rpc ?? "https://ethereum-sepolia-rpc.publicnode.com";
    return { client: createWalletClient({ account: persona.account, chain, transport: http(rpc) }), account: persona.account };
  }
  const provider = injected();
  if (!provider) throw new Error("No wallet found. Install a browser wallet, or run the local demo: make web-local");
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  if (!address) throw new Error("The wallet returned no account");
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
  return { client: createWalletClient({ account: address, chain, transport: custom(provider) }), account: address };
}
