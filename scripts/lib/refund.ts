// Builds a refund list: reads a CSV or the history of token transfers into a protocol, checks it, then builds the Merkle tree.
// The list cannot change once a case opens, so the tool stops on bad data instead of guessing.
import { getAddress, isAddress, parseAbiItem, type Address, type PublicClient } from "viem";

export interface LossEntry {
  account: Address;
  allocation: bigint;
}

// Each line is "address,amount" in the token's smallest unit. Blank lines and lines starting with # are skipped.
export function parseCsv(text: string): LossEntry[] {
  const entries: LossEntry[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(",").map((item) => item.trim());
    const where = `line ${index + 1}`;
    if (parts.length !== 2) throw new Error(`${where}: expected address,amount`);
    const [address, amount] = parts as [string, string];
    if (!isAddress(address, { strict: false })) throw new Error(`${where}: invalid address ${address}`);
    if (!/^\d+$/.test(amount)) throw new Error(`${where}: amount must be a whole number in the token's smallest unit, got ${amount}`);
    const account = getAddress(address);
    if (seen.has(account)) throw new Error(`${where}: ${account} appears twice`);
    seen.add(account);
    const allocation = BigInt(amount);
    if (allocation === 0n) throw new Error(`${where}: amount must not be zero`);
    entries.push({ account, allocation });
  });
  if (entries.length === 0) throw new Error("the list is empty");
  return entries;
}

// Each wallet's net balance in the protocol: total transferred in minus total withdrawn, up to `toBlock`.
// Only right for protocols that hold the token directly and credit the sender. Routers, nested vaults or
// fee-on-transfer tokens need checking against the protocol's own books.
export function netDeposits(transfers: { from: Address; to: Address; value: bigint }[], vault: Address): LossEntry[] {
  const target = getAddress(vault);
  const balances = new Map<Address, bigint>();
  const add = (account: Address, delta: bigint) => balances.set(account, (balances.get(account) ?? 0n) + delta);
  for (const { from, to, value } of transfers) {
    const sender = getAddress(from);
    const receiver = getAddress(to);
    if (receiver === target && sender !== target) add(sender, value);
    else if (sender === target && receiver !== target) add(receiver, -value);
  }
  return [...balances.entries()].filter(([, balance]) => balance > 0n).map(([account, allocation]) => ({ account, allocation }));
}

export async function readTransfers(client: PublicClient, token: Address, vault: Address, fromBlock: bigint, toBlock: bigint, chunk = 2000n) {
  const event = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
  const transfers: { from: Address; to: Address; value: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock;
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({ address: token, event, args: { to: vault }, fromBlock: start, toBlock: end }),
      client.getLogs({ address: token, event, args: { from: vault }, fromBlock: start, toBlock: end }),
    ]);
    for (const log of [...incoming, ...outgoing]) {
      const { from, to, value } = log.args;
      if (from && to && value !== undefined) transfers.push({ from, to, value });
    }
  }
  return transfers;
}

export const sumAllocations = (entries: LossEntry[]) => entries.reduce((total, entry) => total + entry.allocation, 0n);

// Rescales a list to a different total while keeping the proportions, for example when the hacker swapped into another
// token and a case needs amounts in that token. Remainders go by largest fraction, so the total always matches exactly.
export function scaleTo(entries: LossEntry[], total: bigint): LossEntry[] {
  if (total <= 0n) throw new Error("the new total must be above zero");
  const current = sumAllocations(entries);
  const shares = entries.map((entry, index) => ({
    index,
    account: entry.account,
    allocation: (entry.allocation * total) / current,
    remainder: (entry.allocation * total) % current,
  }));
  let left = total - sumAllocations(shares);
  const byRemainder = [...shares].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const share of byRemainder) {
    if (left === 0n) break;
    share.allocation += 1n;
    left -= 1n;
  }
  const kept = shares.filter((share) => share.allocation > 0n);
  if (kept.length !== shares.length) throw new Error(`${shares.length - kept.length} wallets would receive nothing at this total. Use a larger total or a token with more decimals`);
  return kept.map(({ account, allocation }) => ({ account, allocation }));
}
