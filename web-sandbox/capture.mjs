// Records the local chain after scripts/seed.ts builds the data, so the worker can replay it in the browser.
// Run while the seed's Anvil is still open on port 8546. Writes web/public/sandbox-chain.json and web/public/sandbox-deployment.json.
import { readFileSync, writeFileSync } from "node:fs";
import { mnemonicToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8546";
const PUBLIC = new URL("../web/public/", import.meta.url);
const call = async (method, params = []) => {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};

const latest = Number(await call("eth_blockNumber"));
const blocks = [];
for (let number = 1; number <= latest; number++) {
  const block = await call("eth_getBlockByNumber", [`0x${number.toString(16)}`, false]);
  const txs = [];
  for (const hash of block.transactions) txs.push(await call("eth_getRawTransactionByHash", [hash]));
  blocks.push({ timestamp: Number(block.timestamp), txs });
}
// The same 20 test accounts that seed.ts opens on Anvil, with Anvil's public keys.
const funded = Array.from({ length: 20 }, (_, index) => mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: index }).address);
const deployment = JSON.parse(readFileSync(new URL("deployment.json", PUBLIC), "utf8"));
if (deployment.network !== "local") throw new Error("Expected the local deployment written by scripts/seed.ts");
writeFileSync(new URL("sandbox-chain.json", PUBLIC), JSON.stringify({ funded, blocks }));
writeFileSync(new URL("sandbox-deployment.json", PUBLIC), JSON.stringify({ ...deployment, sandbox: true, rpc: undefined }, null, 2));
console.log(`captured ${blocks.length} blocks, ${blocks.reduce((sum, block) => sum + block.txs.length, 0)} transactions`);
