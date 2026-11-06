// Shared helpers: reading Foundry artifacts, the terms type and the Merkle tree.
import { existsSync, readFileSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Abi, Address, Hex } from "viem";

export const ROOT = new URL("../../", import.meta.url);
export const ONE_TOKEN = 10n ** 18n;

export interface RewardTier {
  until: bigint;
  rewardBps: number;
}

export interface CaseTerms {
  caseId: Hex;
  token: Address;
  totalLoss: bigint;
  maxReturn: bigint;
  rewardCap: bigint;
  refundRoot: Hex;
  evidenceHash: Hex;
  tiers: RewardTier[];
  nonce: bigint;
  chainId: bigint;
}

export interface Allocation {
  account: Address;
  allocation: bigint;
  proof: Hex[];
}

// Loads .env from the repo root if present. Keys are never printed to the log.
export function loadRootEnv(): void {
  const path = new URL(".env", ROOT);
  if (existsSync(path)) process.loadEnvFile(path);
}

export function artifact(contract: string, file = `${contract}.sol`): { abi: Abi; bytecode: Hex } {
  const path = new URL(`contracts/out/${file}/${contract}.json`, ROOT);
  if (!existsSync(path)) throw new Error(`Missing ${path.pathname}. Run: forge build`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex };
}

// An OpenZeppelin-standard Merkle tree, matching the leaf in ReturnDesk.claimRefund.
export function buildRefundTree(entries: { account: Address; allocation: bigint }[]): {
  root: Hex;
  allocations: Allocation[];
} {
  const tree = StandardMerkleTree.of(
    entries.map(({ account, allocation }) => [account, allocation.toString()]),
    ["address", "uint256"],
  );
  return {
    root: tree.root as Hex,
    allocations: entries.map(({ account, allocation }) => ({
      account,
      allocation,
      proof: tree.getProof([account, allocation.toString()]) as Hex[],
    })),
  };
}

// Prints token amounts as 1,000,000 for readability.
export function formatTokens(amount: bigint): string {
  const whole = (amount / ONE_TOKEN).toLocaleString("en-US");
  const fraction = amount % ONE_TOKEN;
  if (fraction === 0n) return whole;
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

// Writes bigints as strings when saving JSON.
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`;
}

export function step(index: number, total: number, message: string): void {
  console.log(`\n[${index}/${total}] ${message}`);
}

export function detail(label: string, value: string): void {
  console.log(`      ${label.padEnd(20)} ${value}`);
}
