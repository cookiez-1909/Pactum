// Deploys PactumRegistry to NEAR testnet, stakes for the running controller, then rehearses two challenges:
// one dismissed, one slashed 10%. Run after `make demo-testnet`, because the registry points to the controller in deployments/.
// The council and the challenger are all test accounts of this demo.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ROOT, detail, toJson } from "./lib/common.ts";
import {
  accessKeyCount,
  callOk,
  createSubAccount,
  deployWithInit,
  expectNearFailure,
  removeAllAccessKeys,
  richestAccount,
  topUpAccounts,
  view,
  type NearCredentials,
} from "./lib/near.ts";

const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
// Small numbers for testnet. With real money the stake must exceed what one act of fraud could take.
const MIN_STAKE = 500n * MILLI;
const STAKE = 600n * MILLI;
const OPERATOR_STORAGE = 10n * MILLI;
const CHALLENGE_DEPOSIT = 50n * MILLI;
const UNSTAKE_DELAY_SECONDS = 7n * 86_400n;
const MIN_HOLD_SECONDS = 183n * 86_400n;
const CHALLENGE_TTL_SECONDS = 30n * 86_400n;
const REGISTRY_DEPOSIT = 2_500n * MILLI;
const COUNCIL_DEPOSIT = 150n * MILLI;

const ENV = new URL(".env.testnet", ROOT);

function demoAccounts(): { guardians: NearCredentials[]; stranger: NearCredentials; council?: NearCredentials[] } {
  if (!existsSync(ENV)) throw new Error(".env.testnet not found. Run first: make demo-testnet");
  const lines = readFileSync(ENV, "utf8").split("\n");
  const value = (name: string) => lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  const accounts = JSON.parse(value("NEAR_DEMO_ACCOUNTS") ?? "null");
  if (!accounts) throw new Error("NEAR_DEMO_ACCOUNTS is missing from .env.testnet");
  const council = value("NEAR_DEMO_COUNCIL");
  return { ...accounts, council: council ? JSON.parse(council) : undefined };
}

const decode = (value: string) => JSON.parse(Buffer.from(value, "base64").toString());

async function main() {
  const sepolia = JSON.parse(readFileSync(new URL("deployments/sepolia.json", ROOT), "utf8"));
  const controller = sepolia.near.controllerAccount as string;
  console.log(`PactumRegistry on NEAR testnet, for controller ${controller}`);

  const { guardians, stranger, council: savedCouncil } = demoAccounts();
  await topUpAccounts([...guardians, stranger], 900n * MILLI, NEAR);
  const funder = await richestAccount([...guardians, stranger]);
  // The council members are new sub-accounts, separate from the guardians, because a judge should not be the accused.
  let council = savedCouncil;
  if (!council) {
    council = [];
    for (const name of ["council-a", "council-b", "council-c"]) council.push(await createSubAccount(funder, name, COUNCIL_DEPOSIT));
    writeFileSync(ENV, `${readFileSync(ENV, "utf8")}NEAR_DEMO_COUNCIL=${JSON.stringify(council)}\n`, { mode: 0o600 });
  }
  detail("council", council.map((member) => member.accountId).join(", "));

  const wasmPath = new URL("registry/target/near/pactum_registry.wasm", ROOT);
  const wasm = readFileSync(wasmPath);
  copyFileSync(wasmPath, new URL("deployments/pactum_registry.wasm", ROOT));
  const registry = await createSubAccount(funder, "registry", REGISTRY_DEPOSIT);
  const txs: Record<string, string> = {};
  txs.deploy = await deployWithInit(registry, wasm, {
    council: council.map((member) => member.accountId),
    council_threshold: 2,
    min_stake: MIN_STAKE.toString(),
    unstake_delay_seconds: UNSTAKE_DELAY_SECONDS.toString(),
    min_hold_seconds: MIN_HOLD_SECONDS.toString(),
    challenge_deposit: CHALLENGE_DEPOSIT.toString(),
    challenge_ttl_seconds: CHALLENGE_TTL_SECONDS.toString(),
  });
  txs.removeKeys = await removeAllAccessKeys(registry);
  if ((await accessKeyCount(registry.accountId)) !== 0) throw new Error("Registry still has access keys");
  detail("registry", `${registry.accountId} (0 access keys left)`);

  const listed = () => view<boolean>(registry.accountId, "is_listed", { controller });
  const register = (who: NearCredentials) => callOk(who, registry.accountId, "register", { controller, website: "https://github.com/" }, 150n, STAKE + OPERATOR_STORAGE);

  // A stranger claims the controller: the contract asks the controller, sees it is not a guardian, and refunds.
  const strangerTry = await register(stranger);
  txs.strangerRegister = strangerTry.txHash;
  if (decode(strangerTry.value) !== false || (await listed())) throw new Error("A stranger was able to register the controller");
  detail("stranger", "tried to register this controller, refused and refunded");

  const owner = await richestAccount(guardians);
  const registered = await register(owner);
  txs.register = registered.txHash;
  if (decode(registered.value) !== true || !(await listed())) throw new Error("The guardian could not register");
  detail("operator", `${owner.accountId} staked ${Number(STAKE) / 1e24} NEAR for the controller`);

  // Drill: one challenge dismissed, one slashed 10%. Not real accusations.
  const open = async (evidence: string) => {
    const result = await callOk(stranger, registry.accountId, "open_challenge", { controller, evidence }, 50n, CHALLENGE_DEPOSIT);
    return { id: decode(result.value) as string, txHash: result.txHash };
  };
  const vote = (member: NearCredentials, id: string, verdict: unknown) => callOk(member, registry.accountId, "vote_challenge", { challenge_id: id, verdict }, 50n);

  const dismissed = await open("Drill, not a real accusation. The council dismisses this one, and the challenger loses the deposit.");
  txs.challengeDismissed = dismissed.txHash;
  if (!(await expectNearFailure(stranger, registry.accountId, "vote_challenge", { challenge_id: dismissed.id, verdict: "Dismiss" }, "caller is not on the council"))) {
    throw new Error("A stranger was able to vote");
  }
  txs.dismiss1 = (await vote(council[0]!, dismissed.id, "Dismiss")).txHash;
  txs.dismiss2 = (await vote(council[1]!, dismissed.id, "Dismiss")).txHash;
  detail("challenge 1", "dismissed by 2 of 3 council members, a stranger's vote was refused");

  const upheld = await open("Drill, not a real accusation. The council slashes 10% of the stake, and the challenger gets the deposit back.");
  txs.challengeUpheld = upheld.txHash;
  txs.slash1 = (await vote(council[0]!, upheld.id, { Slash: { bps: 1000 } })).txHash;
  txs.slash2 = (await vote(council[2]!, upheld.id, { Slash: { bps: 1000 } })).txHash;
  const operator = await view<{ stake: string; total_slashed: string }>(registry.accountId, "get_operator", { controller });
  detail("challenge 2", `slashed ${Number(BigInt(operator.total_slashed)) / 1e24} NEAR, stake now ${Number(BigInt(operator.stake)) / 1e24} NEAR, still listed: ${await listed()}`);

  writeFileSync(
    new URL("deployments/registry.json", ROOT),
    toJson({
      registry: registry.accountId,
      controller,
      owner: owner.accountId,
      stranger: stranger.accountId,
      council: council.map((member) => member.accountId),
      threshold: 2,
      stakeAttached: STAKE + OPERATOR_STORAGE,
      challenges: { dismissed: dismissed.id, upheld: upheld.id },
      txs,
    }),
  );
  console.log("  saved deployments/registry.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
