// Generates EIP-712 hash vectors with viem, a library independent of Solidity and Rust.
// Foundry and the Rust tests read this file, so all three must produce the same result.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashTypedData, keccak256, toHex, type Address, type Hex } from "viem";

const OUTPUT = new URL("../contracts/test/vectors/case_terms.json", import.meta.url);

const TYPES = {
  RewardTier: [
    { name: "until", type: "uint64" },
    { name: "rewardBps", type: "uint16" },
  ],
  CaseTerms: [
    { name: "caseId", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "totalLoss", type: "uint256" },
    { name: "maxReturn", type: "uint256" },
    { name: "rewardCap", type: "uint256" },
    { name: "refundRoot", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "tiers", type: "RewardTier[]" },
    { name: "nonce", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

interface VectorInput {
  name: string;
  verifyingContract: Address;
  caseId: Hex;
  token: Address;
  totalLoss: bigint;
  maxReturn: bigint;
  rewardCap: bigint;
  refundRoot: Hex;
  evidenceHash: Hex;
  tiers: { until: bigint; rewardBps: number }[];
  nonce: bigint;
  chainId: bigint;
}

const label = (text: string) => keccak256(toHex(text));
const UINT256_MAX = 2n ** 256n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

const inputs: VectorInput[] = [
  {
    name: "demo terms on Sepolia",
    verifyingContract: "0x1111111111111111111111111111111111111111",
    caseId: label("case-1"),
    token: "0x2222222222222222222222222222222222222222",
    totalLoss: 1_000_000n * 10n ** 18n,
    maxReturn: 1_000_000n * 10n ** 18n,
    rewardCap: 150_000n * 10n ** 18n,
    refundRoot: label("root"),
    evidenceHash: label("evidence"),
    tiers: [
      { until: 1_800_259_200n, rewardBps: 1000 },
      { until: 1_800_604_800n, rewardBps: 500 },
    ],
    nonce: 1n,
    chainId: 11_155_111n,
  },
  {
    name: "single tier",
    verifyingContract: "0xc6ef73c058ACBc8b73aeB57FB26EC8223796c563",
    caseId: label("case-2"),
    token: "0x733F6b40cAE78c52b6a390a6bfb54af7562b4cAC",
    totalLoss: 1n,
    maxReturn: 1n,
    rewardCap: 0n,
    refundRoot: label("root-2"),
    evidenceHash: `0x${"00".repeat(32)}`,
    tiers: [{ until: 1n, rewardBps: 0 }],
    nonce: 0n,
    chainId: 1n,
  },
  {
    name: "eight tiers on another chain",
    verifyingContract: "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
    caseId: label("case-3"),
    token: "0x0000000000000000000000000000000000000001",
    totalLoss: 123_456_789_012_345_678_901_234_567_890n,
    maxReturn: 98_765_432_109_876_543_210n,
    rewardCap: 7n,
    refundRoot: label("root-3"),
    evidenceHash: label("evidence-3"),
    tiers: [1500, 1250, 1000, 750, 500, 250, 100, 1].map((rewardBps, index) => ({
      until: 2_000_000_000n + BigInt(index) * 86_400n,
      rewardBps,
    })),
    nonce: 42n,
    chainId: 42_161n,
  },
  {
    name: "largest values",
    verifyingContract: "0x00000000000000000000000000000000000000aa",
    caseId: `0x${"ff".repeat(32)}`,
    token: "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
    totalLoss: UINT256_MAX,
    maxReturn: UINT256_MAX,
    rewardCap: UINT256_MAX,
    refundRoot: `0x${"ff".repeat(32)}`,
    evidenceHash: `0x${"ff".repeat(32)}`,
    tiers: [
      { until: UINT64_MAX - 1n, rewardBps: 10_000 },
      { until: UINT64_MAX, rewardBps: 9_999 },
    ],
    nonce: UINT64_MAX,
    chainId: UINT64_MAX,
  },
];

const vectors = inputs.map((input) => ({
  name: input.name,
  verifyingContract: input.verifyingContract,
  digest: hashTypedData({
    domain: {
      name: "Pactum",
      version: "1",
      chainId: input.chainId,
      verifyingContract: input.verifyingContract,
    },
    types: TYPES,
    primaryType: "CaseTerms",
    message: {
      caseId: input.caseId,
      token: input.token,
      totalLoss: input.totalLoss,
      maxReturn: input.maxReturn,
      rewardCap: input.rewardCap,
      refundRoot: input.refundRoot,
      evidenceHash: input.evidenceHash,
      tiers: input.tiers,
      nonce: input.nonce,
      chainId: input.chainId,
    },
  }),
  terms: {
    caseId: input.caseId,
    token: input.token,
    totalLoss: input.totalLoss.toString(),
    maxReturn: input.maxReturn.toString(),
    rewardCap: input.rewardCap.toString(),
    refundRoot: input.refundRoot,
    evidenceHash: input.evidenceHash,
    tierCount: input.tiers.length,
    tiers: input.tiers.map((tier) => ({ until: tier.until.toString(), rewardBps: tier.rewardBps })),
    nonce: input.nonce.toString(),
    chainId: input.chainId.toString(),
  },
}));

mkdirSync(dirname(OUTPUT.pathname), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({ count: vectors.length, vectors }, null, 2)}\n`);
console.log(`wrote ${vectors.length} vectors to ${OUTPUT.pathname}`);
