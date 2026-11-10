// A test chain that runs inside the visitor's browser, for the hosted demo on GitHub Pages.
// It replays exactly the transactions scripts/seed.ts sent to Anvil, so it ends up with the same state, events and times.
// Each visitor gets a private chain, and reloading the page starts over.
import "./shim";
import { createCommon } from "@tevm/common";
import { createMemoryClient } from "@tevm/memory-client";
import { foundry } from "viem/chains";

interface Recorded {
  funded: string[];
  blocks: { timestamp: number; txs: string[] }[];
}

// Tevm takes block times from Date.now. During the replay, the clock is set to each block's recorded time.
// After that the clock runs on from the last block, so case deadlines always match the recorded data, whatever day it is.
const realNow = performance.now.bind(performance);
let replayClock = 0;
let liveBase = 0;
let liveStart = 0;
let live = false;
Date.now = () => (live ? liveBase + (realNow() - liveStart) : replayClock);

const memory = createMemoryClient({ common: createCommon({ ...foundry, hardfork: "prague", loggingLevel: "warn" }), miningConfig: { type: "manual" }, loggingLevel: "warn" });
// Calls Tevm directly, skipping viem's retry layer, which made every reverting call take seconds.
const transport = memory.transport as unknown as { request(args: { method: string; params: unknown[] }): Promise<unknown> };
const raw = (method: string, params: unknown[] = []) => transport.request({ method, params });

// A reverting read, such as reading a case with no offer yet, only changes when a new transaction lands. The app re-reads these every few seconds,
// so the revert is kept until the next transaction to stop work piling up in the worker.
const reverts = new Map<string, unknown>();

// Every request goes through one queue, because Tevm cannot mine while it is mining.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>) => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

// "pending" is treated as the latest block, and an empty block is mined regularly so chain time follows the clock.
const pendingToLatest = (params: unknown[]) => params.map((value) => (value === "pending" ? "latest" : value));

async function handle(method: string, params: unknown[] = []) {
  if (method === "eth_call") {
    const key = JSON.stringify(params[0]);
    if (reverts.has(key)) throw reverts.get(key);
    try {
      return await raw(method, pendingToLatest(params));
    } catch (error) {
      if (rpcError(error).code === 3) reverts.set(key, error);
      throw error;
    }
  }
  if (method === "eth_getLogs") {
    // Tevm does not understand null ("any value here") in a topic filter. Send only the part before the first null and filter the rest here.
    const filter = { ...(params[0] as { topics?: (string | string[] | null)[] }) };
    const topics = filter.topics ?? [];
    const cut = topics.indexOf(null);
    if (cut === -1) return raw(method, [filter]);
    const logs = (await raw(method, [{ ...filter, topics: topics.slice(0, cut) }])) as { topics: string[] }[];
    return logs.filter((log) =>
      topics.every((wanted, index) => wanted === null || (Array.isArray(wanted) ? wanted.map((item) => item.toLowerCase()).includes(log.topics[index]?.toLowerCase() ?? "") : wanted.toLowerCase() === log.topics[index]?.toLowerCase())),
    );
  }
  if (method === "eth_estimateGas") {
    // Tevm returns exactly the gas used. Calls into other contracts need extra gas under the 63/64 rule, so leave headroom as other nodes do.
    const used = BigInt((await raw(method, pendingToLatest(params))) as string);
    return `0x${(used + used / 3n + 25_000n).toString(16)}`;
  }
  if (method === "eth_sendRawTransaction") {
    reverts.clear();
    const hash = await raw(method, params);
    await raw("tevm_mine", ["0x1", "0x0"]);
    return hash;
  }
  return raw(method, pendingToLatest(params));
}

async function start(url: string) {
  const recorded = (await (await fetch(url)).json()) as Recorded;
  await memory.tevmReady();
  for (const address of recorded.funded) await raw("anvil_setBalance", [address, "0x21e19e0c9bab2400000"]);
  const total = recorded.blocks.length;
  for (const [index, block] of recorded.blocks.entries()) {
    replayClock = block.timestamp * 1000;
    for (const tx of block.txs) await raw("eth_sendRawTransaction", [tx]);
    await raw("tevm_mine", ["0x1", "0x0"]);
    if (index % 8 === 0 || index === total - 1) postMessage({ type: "progress", done: index + 1, total });
  }
  liveBase = recorded.blocks[total - 1]!.timestamp * 1000 + 1000;
  liveStart = realNow();
  live = true;
  setInterval(() => void serial(() => raw("tevm_mine", ["0x1", "0x0"])).catch(() => undefined), 4000);
  postMessage({ type: "ready" });
}

// Only plain data crosses postMessage. Tevm's error objects hold things that cannot be cloned, and that once lost replies.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null, (_, item) => (typeof item === "bigint" ? `0x${item.toString(16)}` : item))) as unknown;

// A revert is returned the standard JSON-RPC way, code 3 with hex data, so viem can decode the contract's error name.
function rpcError(error: unknown) {
  const source = (error ?? {}) as { code?: number; message?: string; details?: string; data?: unknown; cause?: { data?: unknown } };
  const nested = (source.data ?? source.cause?.data) as { data?: unknown } | string | undefined;
  const data = typeof nested === "string" ? nested : typeof nested?.data === "string" ? nested.data : undefined;
  const message = String(source.details ?? source.message ?? "Sandbox error").split("\n")[0]!;
  const reverted = data !== undefined || /revert/i.test(message);
  return { code: reverted ? 3 : typeof source.code === "number" ? source.code : -32603, message, data };
}

function reply(id: number, body: { result?: unknown; error?: unknown }) {
  try {
    postMessage({ type: "rpc", id, ...body });
  } catch (failure) {
    postMessage({ type: "rpc", id, error: { code: -32603, message: `Sandbox could not send the result: ${String(failure)}` } });
  }
}

addEventListener("message", (event: MessageEvent) => {
  const message = event.data as { type: string; url?: string; id?: number; method?: string; params?: unknown[] };
  if (message.type === "start") {
    start(message.url!).catch((error: unknown) => postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (message.type === "rpc") {
    serial(() => handle(message.method!, message.params)).then(
      (result) => reply(message.id!, { result: plain(result) }),
      (error) => reply(message.id!, { error: rpcError(error) }),
    );
  }
});
