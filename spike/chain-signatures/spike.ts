// Tests the biggest technical risk (section 11):
// calls the MPC contract on NEAR testnet to sign a hash, then recovers the right address with the EVM's ecrecover.
// Uses only throwaway testnet accounts. The key lives in .env (excluded by .gitignore).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairEd25519, baseDecode, type KeyPairString } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import {
  bytesToHex,
  createPublicClient,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  type Hex,
} from "viem";

const MPC_CONTRACT = "v1.signer-prod.testnet";
const NEAR_RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const FAUCET_URL = "https://helper.nearprotocol.com/account";
const DERIVATION_PATH = "return-desk-spike-1";
const DOMAIN_ID = 0; // domain 0 is secp256k1 (read from the `state` view)
const SIGN_GAS = 300_000_000_000_000n; // The contract requires at least 15 Tgas (read from the `config` view)
const SIGN_DEPOSIT = 1n; // The contract requires at least 1 yoctoNEAR
const ENV_FILE = new URL("./.env", import.meta.url);
const SECP256K1_N = secp256k1.Point.Fn.ORDER;

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

// Creates a new testnet account through the faucet if there is none, with no login.
async function ensureAccount(): Promise<{ accountId: string; secretKey: string }> {
  const env = loadEnv();
  if (env.NEAR_ACCOUNT_ID && env.NEAR_SECRET_KEY) {
    return { accountId: env.NEAR_ACCOUNT_ID, secretKey: env.NEAR_SECRET_KEY };
  }
  const keyPair = KeyPairEd25519.fromRandom();
  const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(5))).slice(2);
  const accountId = `rd-spike-${suffix}.testnet`;
  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Faucet failed ${response.status}: ${await response.text()}`);
  }
  writeFileSync(
    ENV_FILE,
    `NEAR_ACCOUNT_ID=${accountId}\nNEAR_SECRET_KEY=${keyPair.toString()}\n`,
    { mode: 0o600 },
  );
  return { accountId, secretKey: keyPair.toString() };
}

async function viewContract(provider: JsonRpcProvider, method: string, args: Record<string, unknown>) {
  const result = await provider.callFunction<string>({ contractId: MPC_CONTRACT, method, args });
  if (typeof result !== "string") throw new Error(`${method} did not return a string`);
  return result;
}

// A NEAR key "secp256k1:<base58 64 bytes>" becomes a 65-byte uncompressed point (0x04 prefix added).
function parseNearSecp256k1(key: string): Uint8Array {
  const raw = baseDecode(key.replace("secp256k1:", ""));
  if (raw.length !== 64) throw new Error(`Key has the wrong length: ${raw.length}`);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(raw, 1);
  return out;
}

// The EVM address is the last 20 bytes of keccak256(x || y).
function evmAddressFromUncompressed(uncompressed: Uint8Array): Hex {
  const hash = keccak256(uncompressed.slice(1));
  return getAddress(`0x${hash.slice(-40)}`);
}

// Derives the key locally exactly as in crates/near-mpc-crypto-types/src/kdf.rs:
// tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<account>,<path>")
// derived key = tweak·G + root key
function deriveLocally(rootKey: string, accountId: string, path: string): Uint8Array {
  const preimage = `near-mpc-recovery v0.1.0 epsilon derivation:${accountId},${path}`;
  const tweak = BigInt(bytesToHex(sha3_256(new TextEncoder().encode(preimage))));
  const root = secp256k1.Point.fromBytes(parseNearSecp256k1(rootKey));
  return root.add(secp256k1.Point.BASE.multiply(tweak)).toBytes(false);
}

async function main() {
  const provider = new JsonRpcProvider({ url: NEAR_RPC });
  const { accountId, secretKey } = await ensureAccount();
  console.log(`account            ${accountId}`);

  const rootKey = await viewContract(provider, "public_key", {});
  const contractKey = await viewContract(provider, "derived_public_key", {
    path: DERIVATION_PATH,
    predecessor: accountId,
    domain_id: DOMAIN_ID,
  });
  const contractAddress = evmAddressFromUncompressed(parseNearSecp256k1(contractKey));
  const localAddress = evmAddressFromUncompressed(deriveLocally(rootKey, accountId, DERIVATION_PATH));
  console.log(`derived (contract) ${contractAddress}`);
  console.log(`derived (local)    ${localAddress}`);
  if (contractAddress !== localAddress) throw new Error("Local derivation does not match the contract");

  // Uses a real EIP-712 hash, the way ReturnDesk will verify later.
  const digest = hashTypedData({
    domain: {
      name: "ReturnDeskSpike",
      version: "1",
      chainId: 11155111,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    },
    types: { Ping: [{ name: "note", type: "string" }, { name: "nonce", type: "uint256" }] },
    primaryType: "Ping",
    message: { note: "chain signatures spike", nonce: BigInt(Date.now()) },
  });
  console.log(`digest             ${digest}`);

  const account = new Account(accountId, provider, secretKey as KeyPairString);
  const started = Date.now();
  const outcome = await account.callFunctionRaw({
    contractId: MPC_CONTRACT,
    methodName: "sign",
    args: {
      request: {
        payload_v2: { Ecdsa: digest.slice(2) },
        path: DERIVATION_PATH,
        domain_id: DOMAIN_ID,
      },
    },
    gas: SIGN_GAS,
    deposit: SIGN_DEPOSIT,
    waitUntil: "FINAL",
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const txHash = outcome.transaction.hash;
  console.log(`near tx            ${txHash} (${elapsed}s)`);

  const status = outcome.status as { SuccessValue?: string };
  if (typeof status.SuccessValue !== "string") {
    throw new Error(`sign failed: ${JSON.stringify(outcome.status)}`);
  }
  const response = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString()) as {
    scheme?: string;
    big_r: { affine_point: string };
    s: { scalar: string };
    recovery_id: number;
  };
  console.log(`mpc response       ${JSON.stringify(response)}`);

  // Turns the MPC response into an EVM signature: r is the x coordinate of big_r, v = 27 + recovery_id.
  const r = `0x${response.big_r.affine_point.slice(2)}` as Hex;
  const s = `0x${response.s.scalar}` as Hex;
  const v = 27 + response.recovery_id;
  if (BigInt(s) > SECP256K1_N / 2n) throw new Error("s is not in low-s form");
  console.log(`low-s              yes (OpenZeppelin ECDSA will accept it)`);

  // Calls the EVM's real ecrecover precompile (address 0x01) with eth_call, costing no real gas.
  const calldata = `0x${digest.slice(2)}${v.toString(16).padStart(64, "0")}${r.slice(2)}${s.slice(2)}` as Hex;
  for (const [name, url] of [
    ["anvil", process.env.ANVIL_RPC ?? "http://127.0.0.1:8545"],
    ["sepolia", process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com"],
  ] as const) {
    const client = createPublicClient({ transport: http(url) });
    const { data } = await client.call({
      to: "0x0000000000000000000000000000000000000001",
      data: calldata,
    });
    if (!data) throw new Error(`${name}: ecrecover returned nothing`);
    const recovered = getAddress(`0x${data.slice(-40)}`);
    const pass = recovered === contractAddress;
    console.log(`ecrecover ${name.padEnd(8)} ${recovered} ${pass ? "PASS" : "FAIL"}`);
    if (!pass) process.exitCode = 1;
  }

  // Saves public evidence, with no secret key.
  writeFileSync(
    new URL("./result.json", import.meta.url),
    JSON.stringify(
      { mpcContract: MPC_CONTRACT, accountId, path: DERIVATION_PATH, derivedAddress: contractAddress, digest, txHash, response, r, s, v, seconds: Number(elapsed) },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
