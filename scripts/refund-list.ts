// Builds the refund list for a case.
//   tsx refund-list.ts --csv losses.csv --total-loss 1000000 --out refunds.json
//   tsx refund-list.ts --rpc <url> --token 0x.. --vault 0x.. --from-block 1 --to-block 2 --total-loss 1000000 --out refunds.json
// Add --scale-to <amount> to rescale the list to another total, keeping proportions, when the hacker swapped tokens.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import { buildRefundTree, toJson } from "./lib/common.ts";
import { netDeposits, parseCsv, readTransfers, scaleTo, sumAllocations } from "./lib/refund.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const csv = option("csv");
  const source = csv ? `CSV ${csv}` : `Transfer events into ${required("vault")}`;
  let entries;
  if (csv) {
    entries = parseCsv(readFileSync(csv, "utf8"));
  } else {
    const client = createPublicClient({ transport: http(required("rpc")) }) as PublicClient;
    const vault = getAddress(required("vault"));
    const transfers = await readTransfers(client, getAddress(required("token")), vault, BigInt(required("from-block")), BigInt(required("to-block")));
    entries = netDeposits(transfers, vault);
    if (entries.length === 0) throw new Error("no wallet has a positive balance in this block range");
  }
  const counted = sumAllocations(entries);
  const expected = option("total-loss");
  const scale = option("scale-to");
  // Compared with the known loss before rescaling: a mismatch means the list is missing or has extra people.
  if (expected && counted !== BigInt(expected)) {
    throw new Error(`The list adds up to ${counted}, but the total loss is ${expected}. A case opened with this list would lock or misallocate funds.`);
  }
  if (scale) entries = scaleTo(entries, BigInt(scale));
  const totalLoss = sumAllocations(entries);
  const tree = buildRefundTree(entries);
  const out = required("out");
  writeFileSync(out, toJson({ source, totalLoss, root: tree.root, wallets: tree.allocations.length, allocations: tree.allocations }));
  console.log(`Source       ${source}`);
  console.log(`Wallets      ${tree.allocations.length}`);
  console.log(`Total loss   ${totalLoss}`);
  console.log(`Refund root  ${tree.root}`);
  console.log(`Saved        ${out}. Publish this file: users need it for their proofs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
