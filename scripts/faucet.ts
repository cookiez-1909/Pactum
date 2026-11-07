// Requests testnet NEAR for an existing account, the same way as https://docs.near.org/getting-started/faucet:
// creates a temporary account through the faucet service, sends 5 NEAR to the target, then deletes it and returns the rest to the faucet.
// The service rate-limits itself. The script sends one request; if limited it reports and stops, with no retry and no workaround.
import { Account, JsonRpcProvider, KeyPairEd25519, actions, type KeyPairString } from "near-api-js";
import { bytesToHex } from "viem";
import { provider } from "./lib/near.ts";

const HELPER = "https://helper.testnet.near.org/account";
const AMOUNT = 5n * 10n ** 24n;
// The same beneficiary for the rest as the NEAR faucet page.
const FAUCET_POOL = "v2d.faucet.nonofficial.testnet";

async function main() {
  const beneficiary = process.argv[2];
  if (!beneficiary || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(beneficiary)) throw new Error("Usage: make faucet ACCOUNT=<id>.testnet");
  await provider.viewAccount({ accountId: beneficiary });

  const keyPair = KeyPairEd25519.fromRandom();
  const temporary = `pactum-${bytesToHex(crypto.getRandomValues(new Uint8Array(12))).slice(2)}.testnet`;
  const response = await fetch(HELPER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: temporary, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`Faucet refused: ${response.status} ${text.slice(0, 200)}`);
    process.exit(response.status === 429 ? 2 : 1);
  }

  // The temporary account may take a few seconds to appear on RPC.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await provider.viewAccount({ accountId: temporary });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const account = new Account(temporary, provider as JsonRpcProvider, keyPair.toString() as KeyPairString);
  await account.signAndSendTransaction({ receiverId: beneficiary, actions: [actions.transfer(AMOUNT)], waitUntil: "FINAL" });
  await account.signAndSendTransaction({ receiverId: temporary, actions: [actions.deleteAccount(FAUCET_POOL)], waitUntil: "FINAL" });
  const { amount } = await provider.viewAccount({ accountId: beneficiary });
  console.log(`Sent 5 NEAR to ${beneficiary}, balance is now ${(Number(BigInt(amount) / 10n ** 20n) / 1e4).toFixed(3)} NEAR`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
