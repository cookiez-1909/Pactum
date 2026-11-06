// Works with NEAR testnet: faucet, contract reads, EVM address derivation and calls to ReturnDeskController.
import {
  Account,
  JsonRpcProvider,
  KeyPairEd25519,
  PublicKey,
  actions,
  baseDecode,
  type KeyPairString,
} from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, getAddress, keccak256, type Address, type Hex } from "viem";
import type { CaseTerms } from "./common.ts";

export const MPC_CONTRACT = "v1.signer-prod.testnet";
export const NEAR_RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const FAUCET_URL = "https://helper.nearprotocol.com/account";
const SECP256K1_DOMAIN_ID = 0;
const TGAS = 1_000_000_000_000n;

export const provider = new JsonRpcProvider({ url: NEAR_RPC });

export interface NearCredentials {
  accountId: string;
  secretKey: string;
}

export interface NearProposal {
  id: string;
  digest: Hex;
  status: "Pending" | "Approved" | "Signing" | "Signed";
  approvals: string[];
  signature: Hex | null;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

// Creates a new testnet account through the public faucet, with no login.
export async function createFaucetAccount(prefix: string): Promise<NearCredentials> {
  const keyPair = KeyPairEd25519.fromRandom();
  const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(5))).slice(2);
  const accountId = `${prefix}-${suffix}.testnet`;
  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  });
  if (!response.ok) throw new Error(`Faucet failed for ${accountId}: ${response.status} ${await response.text()}`);
  await waitForAccount(accountId);
  return { accountId, secretKey: keyPair.toString() };
}

async function waitForAccount(accountId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await provider.viewAccount({ accountId });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Account ${accountId} did not appear`);
}

// Creates a sub-account from an existing account, to avoid the faucet's rate limit.
export async function createSubAccount(parent: NearCredentials, prefix: string, deposit: bigint): Promise<NearCredentials> {
  const keyPair = KeyPairEd25519.fromRandom();
  const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(4))).slice(2);
  const accountId = `${prefix}-${suffix}.${parent.accountId}`;
  await accountOf(parent).signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.createAccount(), actions.transfer(deposit), actions.addFullAccessKey(keyPair.getPublicKey())],
    waitUntil: "FINAL",
  });
  return { accountId, secretKey: keyPair.toString() };
}

export async function richestAccount(accounts: NearCredentials[]): Promise<NearCredentials> {
  const balances = await Promise.all(
    accounts.map(async (item) => BigInt((await provider.viewAccount({ accountId: item.accountId })).amount)),
  );
  const index = balances.reduce((best, balance, position) => (balance > balances[best]! ? position : best), 0);
  return accounts[index]!;
}

export function accountOf(credentials: NearCredentials): Account {
  return new Account(credentials.accountId, provider, credentials.secretKey as KeyPairString);
}

// Turns a "secp256k1:<base58 64 bytes>" key into a 65-byte uncompressed point.
function parseSecp256k1Key(key: string): Uint8Array {
  const raw = baseDecode(key.replace("secp256k1:", ""));
  if (raw.length !== 64) throw new Error(`Unexpected key length ${raw.length}`);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(raw, 1);
  return out;
}

function addressFromKey(uncompressed: Uint8Array): Address {
  return getAddress(`0x${keccak256(uncompressed.slice(1)).slice(-40)}`);
}

// Computed locally following near/mpc kdf.rs, then checked against the MPC contract's view. Stops on a mismatch.
export async function deriveEvmAddress(accountId: string, path: string): Promise<Address> {
  const [rootKey, contractKey] = await Promise.all([
    view<string>(MPC_CONTRACT, "public_key"),
    view<string>(MPC_CONTRACT, "derived_public_key", {
      path,
      predecessor: accountId,
      domain_id: SECP256K1_DOMAIN_ID,
    }),
  ]);
  const fromContract = addressFromKey(parseSecp256k1Key(contractKey));
  const preimage = `near-mpc-recovery v0.1.0 epsilon derivation:${accountId},${path}`;
  const tweak = BigInt(bytesToHex(sha3_256(new TextEncoder().encode(preimage))));
  const root = secp256k1.Point.fromBytes(parseSecp256k1Key(rootKey));
  const local = addressFromKey(root.add(secp256k1.Point.BASE.multiply(tweak)).toBytes(false));
  if (local !== fromContract) throw new Error(`Derivation mismatch: ${local} != ${fromContract}`);
  return fromContract;
}

// Terms in the snake_case form the NEAR contract accepts.
export function toNearTerms(terms: CaseTerms): Record<string, unknown> {
  return {
    case_id: terms.caseId,
    token: terms.token,
    total_loss: terms.totalLoss.toString(),
    max_return: terms.maxReturn.toString(),
    reward_cap: terms.rewardCap.toString(),
    refund_root: terms.refundRoot,
    evidence_hash: terms.evidenceHash,
    tiers: terms.tiers.map((tier) => ({ until: tier.until.toString(), reward_bps: tier.rewardBps })),
    nonce: terms.nonce.toString(),
    chain_id: terms.chainId.toString(),
  };
}

export interface ControllerInit {
  guardians: string[];
  threshold: number;
  returnDesk: Address;
  chainId: bigint;
  derivationPath: string;
  maxRewardBps: number;
}

// Deploys and initializes in one transaction, so nobody can call `new` first.
export async function deployController(
  credentials: NearCredentials,
  wasm: Uint8Array,
  init: ControllerInit,
): Promise<string> {
  const args = {
    guardians: init.guardians,
    threshold: init.threshold,
    return_desk: init.returnDesk,
    chain_id: init.chainId.toString(),
    derivation_path: init.derivationPath,
    signer_contract: MPC_CONTRACT,
    max_reward_bps: init.maxRewardBps,
  };
  const outcome = await accountOf(credentials).signAndSendTransaction({
    receiverId: credentials.accountId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall("new", args, 100n * TGAS, 0n),
    ],
    waitUntil: "FINAL",
  });
  return outcome.transaction.hash;
}

// Removes the full-access key. After this, nobody can change the code or sign in the contract's place.
export async function removeAllAccessKeys(credentials: NearCredentials): Promise<string> {
  const { keys } = await provider.viewAccessKeyList({ accountId: credentials.accountId });
  const outcome = await accountOf(credentials).signAndSendTransaction({
    receiverId: credentials.accountId,
    actions: keys.map((key) => actions.deleteKey(PublicKey.fromString(key.public_key))),
    waitUntil: "FINAL",
  });
  return outcome.transaction.hash;
}

export async function accessKeyCount(accountId: string): Promise<number> {
  const { keys } = await provider.viewAccessKeyList({ accountId });
  return keys.length;
}

export async function proposeCase(guardian: NearCredentials, controller: string, terms: CaseTerms): Promise<{ id: string; txHash: string }> {
  const outcome = await accountOf(guardian).callFunctionRaw({
    contractId: controller,
    methodName: "propose_case",
    args: { terms: toNearTerms(terms) },
    gas: 100n * TGAS,
    waitUntil: "FINAL",
  });
  const status = outcome.status as { SuccessValue?: string };
  if (typeof status.SuccessValue !== "string") throw new Error(`propose_case failed: ${JSON.stringify(outcome.status)}`);
  return { id: JSON.parse(Buffer.from(status.SuccessValue, "base64").toString()) as string, txHash: outcome.transaction.hash };
}

// At the threshold this transaction waits for the MPC network to sign, so it needs a lot of gas.
export async function approveCase(guardian: NearCredentials, controller: string, proposalId: string): Promise<string> {
  const outcome = await accountOf(guardian).callFunctionRaw({
    contractId: controller,
    methodName: "approve_case",
    args: { proposal_id: proposalId },
    gas: 150n * TGAS,
    waitUntil: "FINAL",
  });
  return outcome.transaction.hash;
}

export async function getProposal(controller: string, proposalId: string): Promise<NearProposal> {
  return await view<NearProposal>(controller, "get_proposal", { proposal_id: proposalId });
}

// Calls a function we expect to fail. Returns true only if the chain rejects it for the expected reason,
// so a network error or running out of gas is not mistaken for "rejected".
export async function expectNearFailure(
  caller: NearCredentials,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  expectedReason: string,
): Promise<boolean> {
  let reason: string;
  try {
    const outcome = await accountOf(caller).callFunctionRaw({
      contractId,
      methodName,
      args,
      gas: 50n * TGAS,
      waitUntil: "FINAL",
    });
    const failure = (outcome.status as { Failure?: unknown }).Failure;
    if (failure === undefined) return false;
    reason = JSON.stringify(failure);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (!reason.includes(expectedReason)) throw new Error(`Unexpected failure of ${methodName}: ${reason}`);
  return true;
}
