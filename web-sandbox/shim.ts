// Some Tevm libraries use Buffer and process as in Node. Browsers have neither, so define them before those libraries load.
import { Buffer } from "buffer";
const scope = globalThis as unknown as { Buffer: typeof Buffer; process?: unknown };
scope.Buffer ??= Buffer;
scope.process ??= { env: {}, browser: true, version: "", versions: {}, nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)) };
