// Tests for the refund list tool. Run with: make test-refund-list
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { netDeposits, parseCsv, scaleTo, sumAllocations } from "./lib/refund.ts";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const C = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

test("reads a list and skips comments and blank lines", () => {
  const entries = parseCsv(`# wallet,amount\n${A},600\n\n${B.toLowerCase()},400\n`);
  assert.deepEqual(entries, [{ account: A, allocation: 600n }, { account: B, allocation: 400n }]);
});

test("rejects bad rows and names the line", () => {
  assert.throws(() => parseCsv("not-an-address,5"), /line 1: invalid address/);
  assert.throws(() => parseCsv(`${A},1.5`), /whole number/);
  assert.throws(() => parseCsv(`${A},0`), /must not be zero/);
  assert.throws(() => parseCsv(`${A},5,9`), /expected address,amount/);
  assert.throws(() => parseCsv(`${A},5\n${A.toLowerCase()},6`), /line 2: .* appears twice/);
  assert.throws(() => parseCsv("# only a comment"), /empty/);
});

test("counts what each wallet still had in the protocol", () => {
  const entries = netDeposits(
    [
      { from: A, to: VAULT, value: 600n },
      { from: B, to: VAULT, value: 500n },
      { from: VAULT, to: B, value: 100n },
      { from: C, to: VAULT, value: 50n },
      { from: VAULT, to: C, value: 50n },
    ],
    VAULT,
  );
  assert.deepEqual(entries, [{ account: A, allocation: 600n }, { account: B, allocation: 400n }]);
});

test("a wallet that withdrew more than it deposited is left out", () => {
  assert.deepEqual(netDeposits([{ from: A, to: VAULT, value: 5n }, { from: VAULT, to: A, value: 9n }], VAULT), []);
});

test("rescaling keeps the shares and hits the total exactly", () => {
  const scaled = scaleTo([{ account: A, allocation: 1n }, { account: B, allocation: 1n }, { account: C, allocation: 1n }], 100n);
  assert.equal(sumAllocations(scaled), 100n);
  assert.deepEqual(scaled.map((item) => item.allocation), [34n, 33n, 33n]);
});

test("the extra units go to the largest remainders", () => {
  const scaled = scaleTo([{ account: A, allocation: 10n }, { account: B, allocation: 25n }, { account: C, allocation: 65n }], 7n);
  assert.equal(sumAllocations(scaled), 7n);
  assert.deepEqual(scaled.map((item) => item.allocation), [1n, 2n, 4n]);
});

test("rescaling refuses to drop a wallet", () => {
  assert.throws(() => scaleTo([{ account: A, allocation: 1n }, { account: B, allocation: 1_000_000n }], 5n), /would receive nothing/);
  assert.throws(() => scaleTo([{ account: A, allocation: 1n }], 0n), /above zero/);
});
