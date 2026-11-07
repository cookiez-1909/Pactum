// An address book: turns a long hex string into a name and role the viewer reads at once.
import type { Address } from "viem";
import type { Deployment } from "./chain";

export type Role = "hacker" | "user" | "protocol" | "contract" | "guardian" | "relayer" | "unknown";

export const ROLE_LABEL: Record<Role, string> = {
  hacker: "Hacker",
  user: "User",
  protocol: "Protocol",
  contract: "Contract",
  guardian: "Guardian",
  relayer: "Relayer",
  unknown: "Unknown",
};

export interface Identity {
  name: string;
  role: Role;
  detail: string;
}

export type Directory = Map<string, Identity>;

export function buildDirectory(deployment: Deployment): Directory {
  const directory: Directory = new Map();
  const add = (address: string | undefined, identity: Identity) => {
    if (address) directory.set(address.toLowerCase(), identity);
  };
  const { actors, contracts, near } = deployment;

  add(contracts.Pactum, { name: "Pactum", role: "contract", detail: "Holds refunds. It has no owner and no withdraw function." });
  add(deployment.controllerAddress, {
    name: near.simulated ? "Controller (simulated)" : "NEAR controller",
    role: "protocol",
    detail: near.simulated ? "A local test key stands in for NEAR in this run." : "Derived from the NEAR contract through Chain Signatures. Nobody holds this key.",
  });
  add(actors.attacker, { name: "Hacker", role: "hacker", detail: "The wallet that drained the protocol and holds the funds." });
  add(actors.rewardWallet, { name: "Hacker's reward wallet", role: "hacker", detail: "Where the holder chose to receive the reward." });
  actors.hackers?.forEach(({ address, rewardWallet }, index) => {
    const name = index === 0 ? "Hacker" : `Hacker ${index + 1}`;
    add(address, { name, role: "hacker", detail: "The wallet that drained a protocol and holds the funds." });
    add(rewardWallet, { name: `${name}'s reward wallet`, role: "hacker", detail: "Where the holder chose to receive the reward." });
  });
  // No hacker label: on chain, this wallet has no link to the hack.
  add(actors.newWallet, { name: "New wallet", role: "unknown", detail: "Holds funds that passed through other wallets. Nothing visible links it to a hack." });
  add(actors.owner, { name: "Protocol owner", role: "protocol", detail: "A test account playing the team behind the hacked protocols. Nothing on chain makes it the owner, and it cannot withdraw anything." });
  add(actors.relayer, { name: "Relayer", role: "relayer", detail: "Sends transactions for others. The contract gives it no special rights." });
  add(actors.stranger, { name: "Stranger", role: "unknown", detail: "A wallet with no part in any case." });
  actors.users.forEach((address, index) => add(address, { name: `User ${index + 1}`, role: "user", detail: "A depositor who lost funds." }));

  for (const info of [...deployment.cases, ...deployment.pending]) {
    add(info.token.address, { name: `${info.token.symbol} token`, role: "contract", detail: `${info.token.name}. A mock token with no value.` });
    add(info.vault, { name: `${info.incident} vault`, role: "protocol", detail: "The hacked protocol. Intentionally buggy, for this demo only." });
  }
  return directory;
}

// A short line telling the viewer which role they are in and what they can do.
export function roleHint(identity: Identity): string {
  if (identity.name === "Protocol owner") return "A test account playing the team behind the hacked protocols. Nothing on chain makes it the owner, so guardians still have to verify it, and it cannot withdraw anything.";
  if (identity.name === "New wallet") return "You hold funds that moved through other wallets. Nothing links you to the hack, and you can still return them for the reward.";
  if (identity.name === "Stranger") return "You have no part in any case. You can read everything, but there is nothing for you to return or claim.";
  if (identity.role === "hacker") return "You hold stolen funds. You can return them and collect the reward. Nobody will ask who you are.";
  if (identity.role === "user") return "You lost funds. You can claim your refund whenever funds come back.";
  return "Pactum does not know this wallet and does not need to. If it holds the tokens it can return them. If it is on a refund list it can claim.";
}

export function identify(directory: Directory, address: Address | string): Identity {
  return directory.get(address.toLowerCase()) ?? { name: "Unknown wallet", role: "unknown", detail: "This address is not in the case records." };
}

// NEAR accounts read better with a short name too.
export function nearName(account: string): string {
  const match = account.match(/^rd-guardian-([a-z])-/);
  return match ? `Guardian ${match[1]!.toUpperCase()}` : account;
}
