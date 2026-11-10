// The hosted demo's sandbox mode: a test chain running in a Web Worker inside the browser.
// The worker is built separately from the web-sandbox folder and only loads when the hosted demo is in this mode.
import { useSyncExternalStore } from "react";

export interface SandboxStatus {
  started: boolean;
  ready: boolean;
  done: number;
  total: number;
  error: string | null;
}

let status: SandboxStatus = { started: false, ready: false, done: 0, total: 0, error: null };
const listeners = new Set<() => void>();
const setStatus = (next: Partial<SandboxStatus>) => {
  status = { ...status, ...next };
  listeners.forEach((listener) => listener());
};

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

// Starts building the chain as soon as this is known to be the sandbox build, even while the viewer is on the landing page.
export function startSandbox(): void {
  if (worker) return;
  setStatus({ started: true });
  worker = new Worker("./sandbox-worker.js", { type: "module" });
  worker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type: string; done?: number; total?: number; message?: string; id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    if (message.type === "progress") setStatus({ done: message.done!, total: message.total! });
    else if (message.type === "ready") {
      setStatus({ ready: true });
      markReady();
    } else if (message.type === "failed") setStatus({ error: message.message ?? "The sandbox could not start." });
    else if (message.type === "rpc") {
      const entry = waiting.get(message.id!);
      if (!entry) return;
      waiting.delete(message.id!);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message), message.error));
      else entry.resolve(message.result);
    }
  });
  worker.addEventListener("error", (event) => setStatus({ error: event.message || "The sandbox could not start." }));
  worker.postMessage({ type: "start", url: "./sandbox-chain.json" });
}

// An EIP-1193 provider for viem. Requests that arrive early wait until the chain is built.
export const sandboxProvider = {
  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker!.postMessage({ type: "rpc", id, method, params: params ?? [] });
    });
  },
};

export function useSandboxStatus(): SandboxStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
