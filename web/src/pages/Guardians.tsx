// Guardians page: reads the NEAR contract directly, with no server. This is where an offer is read and approved
// once before any signature exists, for every chain it covers. Anyone with a wallet can relay a signature to its chain.
import { useCallback, useEffect, useState } from "react";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import proof from "../../../deployments/sepolia.json";
import registryInfo from "../../../deployments/registry.json";
import { useApp, useToast } from "../appdata";
import { caseIsOpen, demoGuardians, nearAmount, type RegistryChallenge, type RegistryConfig, type RegistryOperator, guardianCall, nearAccessKeyCount, nearAccountUrl, nearView, nonceIsUsed, relayToChain, TESTNET_CHAINS, type DemoGuardian, type NearChainVote, type NearConfig, type NearGuardianVote, type NearProposal, type NearProposalCase } from "../chain";
import { ExternalLink } from "../components/icons";
import { shortAddress } from "../format";
import { nearName } from "../labels";
import { useWallet } from "../wallet";

const PAGE_SIZE = 50;

interface Snapshot {
  config: NearConfig;
  proposals: NearProposal[];
  votes: NearChainVote[];
  guardianVotes: NearGuardianVote[];
  keys: number | null;
  stake: { config: RegistryConfig; operator: RegistryOperator | null; listed: boolean; challenges: RegistryChallenge[] } | null;
}

const STATUS_NOTE: Record<string, string> = {
  Pending: "Waiting for guardians",
  Approved: "Approved, waiting for signatures",
  Signed: "Signed for every chain",
  Cancelled: "Cancelled by a guardian vote",
};

const CASE_STATUS_NOTE: Record<string, string> = {
  Unsigned: "Not signed yet",
  Signing: "Signing",
  Signed: "Signed",
  Cancelled: "Cancelled before signing",
  RevokePending: "Revocation not signed yet",
  RevokeSigning: "Signing the revocation",
  Revoked: "Revocation signed",
};

const IN_FLIGHT = ["Signing", "RevokeSigning"];

// This chain still has MPC work: a signature is on its way, or a case is not signed yet.
const isWaiting = (proposal: NearProposal) =>
  proposal.cases.some((item) => IN_FLIGHT.includes(item.status)) ||
  (proposal.status === "Approved" && proposal.cases.some((item) => item.status === "Unsigned")) ||
  (proposal.status === "Cancelled" && proposal.cases.some((item) => item.status === "RevokePending"));

// The record is any string a guardian submitted. If it is JSON with an offer, show the text; otherwise show it as is.
function offerText(evidence: string): string {
  try {
    const parsed = JSON.parse(evidence) as { offer?: { conditions?: string } };
    if (parsed.offer?.conditions) return parsed.offer.conditions;
  } catch {
    // Not JSON: shown as is below.
  }
  return evidence;
}

function prettyRecord(evidence: string): string {
  try {
    return JSON.stringify(JSON.parse(evidence), null, 2);
  } catch {
    return evidence;
  }
}

function date(seconds: string): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function Guardians() {
  const { deployment } = useApp();
  // The local build simulates the controller, so this page always reads the real controller on testnet.
  const account = deployment.near.controllerAccount ?? proof.near.controllerAccount;
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const waiting = data?.proposals.some(isWaiting) ?? false;

  const load = useCallback(async () => {
    try {
      const [config, proposals, votes, guardianVotes, keys, registryConfig, operator, listed, challenges] = await Promise.all([
        nearView<NearConfig>(account, "get_config", {}),
        nearView<NearProposal[]>(account, "list_proposals", { from: "0", limit: PAGE_SIZE }),
        nearView<NearChainVote[]>(account, "list_chain_proposals", { from: "0", limit: PAGE_SIZE }),
        nearView<NearGuardianVote[]>(account, "list_guardian_proposals", { from: "0", limit: PAGE_SIZE }),
        nearAccessKeyCount(account),
        nearView<RegistryConfig>(registryInfo.registry, "get_config", {}),
        nearView<RegistryOperator>(registryInfo.registry, "get_operator", { controller: account }),
        nearView<boolean>(registryInfo.registry, "is_listed", { controller: account }),
        nearView<RegistryChallenge[]>(registryInfo.registry, "list_challenges", { from: "0", limit: PAGE_SIZE }),
      ]);
      if (!config || !proposals || !votes) throw new Error("empty");
      const stake = registryConfig ? { config: registryConfig, operator, listed: listed ?? false, challenges: (challenges ?? []).filter((item) => item.controller === account) } : null;
      setData({ config, proposals, votes, guardianVotes: guardianVotes ?? [], keys, stake });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [account]);

  // Reads faster while waiting for the MPC network to sign, so a signature shows up as soon as it exists.
  useEffect(() => {
    void load();
    const poll = window.setInterval(load, waiting ? 3_000 : 15_000);
    return () => window.clearInterval(poll);
  }, [load, waiting]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Guardians</h1>
          <p>Guardians read an offer here, on NEAR, and approve it once for every chain it covers. Nothing can be signed before that. This page reads the contract directly, with no server.</p>
        </div>
      </header>

      {deployment.near.simulated && (
        <p className="notice">The cases in this local demo use a test key in place of NEAR. This page shows the real controller on NEAR testnet, which ran the same flow on three public testnets.</p>
      )}
      {failed && !data && <p className="notice" role="alert">Could not read from the NEAR RPC node. It retries every 15 seconds.</p>}
      {!data && !failed && <div className="skeleton skeleton-block" />}

      {data && (
        <div className="two-col">
          <div className="col-main">
            <section className="card">
              <h2>{data.proposals.length} {data.proposals.length === 1 ? "offer" : "offers"} proposed</h2>
              <ol className="proposals">
                {[...data.proposals].reverse().map((item) => (
                  <ProposalCard key={item.id} proposal={item} config={data.config} account={account} onChange={load} />
                ))}
              </ol>
            </section>
          </div>
          <div className="col-side">
            <section className="card">
              <h2>The rules</h2>
              <dl className="facts">
                <div><dt>NEAR contract</dt><dd className="break"><a href={nearAccountUrl(account)} target="_blank" rel="noreferrer">{account}</a></dd></div>
                <div><dt>Approval</dt><dd>{data.config.threshold} of {data.config.guardians.length} guardians</dd></div>
                <div><dt>Guardians</dt><dd>{data.config.guardians.map(nearName).join(", ")}</dd></div>
                <div><dt>Reward limit</dt><dd>{data.config.max_reward_bps / 100}% on every chain</dd></div>
                <div><dt>Signer</dt><dd className="break">{data.config.signer_contract}</dd></div>
                <div><dt>Access keys</dt><dd>{data.keys === null ? "…" : `${data.keys}. Nobody can change this contract or act as it.`}</dd></div>
              </dl>
            </section>
            {data.stake && <StakeCard stake={data.stake} />}
            <section className="card">
              <h2>Chains served</h2>
              <ul className="chain-list">
                {data.config.deployments.map((item) => {
                  const target = TESTNET_CHAINS[item.chain_id];
                  const vote = data.votes.find((entry) => entry.chain_id === item.chain_id && entry.status === "Added");
                  return (
                    <li key={item.chain_id}>
                      <span className="party-name">{target?.label ?? `Chain ${item.chain_id}`}</span>
                      {target ? <a href={`${target.explorer}/address/${item.pactum}`} target="_blank" rel="noreferrer"><code>{shortAddress(item.pactum)}</code> <ExternalLink /></a> : <code>{shortAddress(item.pactum)}</code>}
                      {vote && <span className="chain-vote">Added by a guardian vote: {vote.approvals.map(nearName).join(", ")}</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="fine-print">The same address signs on all of them, and it is derived from the NEAR contract. A signature made for one chain is rejected on another. A vote can add a chain, but cannot replace one already served.</p>
            </section>
            <section className="card guardian-votes">
              <h2>Guardian changes</h2>
              {data.guardianVotes.length === 0 && <p className="muted small">The guardians have never changed.</p>}
              <ol className="chain-list">
                {data.guardianVotes.map((vote) => (
                  <li key={vote.id}>
                    <span>{vote.guardians.map(nearName).join(", ")}, {vote.threshold} of {vote.guardians.length}</span>
                    <span className="chain-vote">{vote.status === "Applied" ? "Applied" : "Pending"}. Approved by {vote.approvals.map(nearName).join(", ") || "nobody yet"}</span>
                  </li>
                ))}
              </ol>
              <p className="fine-print">Guardians can replace a member by the same threshold. A vote cannot change the signing address or the reward limit. If more keys are lost than the threshold allows, the contracts must be deployed again.</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

const DAY = 86_400;

function StakeCard({ stake }: { stake: NonNullable<Snapshot["stake"]> }) {
  const { config, operator, listed, challenges } = stake;
  return (
    <section className="card stake-card">
      <h2>Money at stake</h2>
      {operator ? (
        <dl className="facts">
          <div><dt>Status</dt><dd><span className={listed ? "badge badge-open" : "badge"}>{listed ? "Listed" : "Not listed"}</span></dd></div>
          <div><dt>Staked</dt><dd>{nearAmount(operator.stake)}, at least {nearAmount(config.min_stake)}</dd></div>
          <div><dt>Slashed so far</dt><dd>{nearAmount(operator.total_slashed)}</dd></div>
          <div><dt>Staked by</dt><dd>{nearName(operator.owner)}, a guardian of this controller</dd></div>
          <div><dt>Leaving</dt><dd>Stays slashable for {Number(config.unstake_delay_seconds) / DAY} days after asking to leave, and at least {Number(config.min_hold_seconds) / DAY} days after joining.</dd></div>
          <div><dt>Council</dt><dd>{config.council_threshold} of {config.council.length} decide a challenge</dd></div>
        </dl>
      ) : (
        <p className="muted">This controller has no stake in the registry.</p>
      )}
      {challenges.length > 0 && (
        <ol className="chain-list challenge-list">
          {challenges.map((item) => (
            <li key={item.id}>
              <span>{item.evidence}</span>
              <span className="chain-vote">{item.status === "Upheld" ? `Upheld: ${nearAmount(item.slashed)} slashed` : item.status}. Votes: {item.votes.map((vote) => (vote.verdict === "Dismiss" ? "dismiss" : `slash ${vote.verdict.Slash.bps / 100}%`)).join(", ") || "none yet"}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="fine-print">Anyone can deploy a copy of Pactum, but only a staked operator is listed in <a href={nearAccountUrl(registryInfo.registry)} target="_blank" rel="noreferrer">the registry</a>. Anyone can challenge it with evidence and a small deposit. The council decides, and slashed NEAR stays locked in the registry for good, so nobody profits from a slash. These challenges are drills, and the council is test accounts.</p>
    </section>
  );
}

// Commands for a guardian using their own NEAR key, with near-cli-rs. The interface never holds their keys.
function cliCommand(account: string, method: string, proposalId: string): string {
  return `near contract call-function as-transaction ${account} ${method} json-args '{"proposal_id":"${proposalId}"}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' sign-as <your-guardian>.testnet network-config testnet sign-with-keychain send`;
}

function GuardianControls({ proposal, config, account, onChange }: { proposal: NearProposal; config: NearConfig; account: string; onChange(): Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const demo = demoGuardians().filter((item) => config.guardians.includes(item.accountId));
  const canApprove = proposal.status === "Pending";
  const canCancel = proposal.status !== "Cancelled" && !proposal.cases.some((item) => IN_FLIGHT.includes(item.status));
  const needsRetry = isWaiting(proposal) && !proposal.cases.some((item) => IN_FLIGHT.includes(item.status));

  const act = async (guardian: DemoGuardian, method: string, label: string) => {
    const key = `${method}:${guardian.accountId}`;
    setBusy(key);
    try {
      await guardianCall(guardian, account, method, proposal.id);
      toast({ kind: "ok", title: `${nearName(guardian.accountId)}: ${label}` });
      await onChange();
    } catch (reason) {
      toast({ kind: "error", title: `${label} failed`, detail: reason instanceof Error ? reason.message.slice(0, 180) : "Unknown error" });
    } finally {
      setBusy(null);
    }
  };

  if (!canApprove && !canCancel && !needsRetry) return null;
  return (
    <div className="guardian-controls">
      {demo.length > 0 && (
        <div className="guardian-buttons">
          {canApprove && demo.filter((item) => !proposal.approvals.includes(item.accountId)).map((item) => (
            <button key={item.accountId} type="button" className="button button-primary" disabled={busy !== null} onClick={() => act(item, "approve_offer", "approved")}>
              {busy === `approve_offer:${item.accountId}` ? <><span className="spinner" /> Approving…</> : `Approve as ${nearName(item.accountId)}`}
            </button>
          ))}
          {needsRetry && demo[0] && (
            <button type="button" className="button button-ghost" disabled={busy !== null} onClick={() => act(demo[0]!, "retry_signature", "asked for the remaining signatures")}>Sign the rest</button>
          )}
          {canCancel && demo.filter((item) => !proposal.cancel_votes.includes(item.accountId)).map((item) => (
            <button key={item.accountId} type="button" className="button button-ghost" disabled={busy !== null} onClick={() => act(item, "vote_cancel", "voted to cancel")}>
              {busy === `vote_cancel:${item.accountId}` ? <><span className="spinner" /> Voting…</> : `Vote to cancel as ${nearName(item.accountId)}`}
            </button>
          ))}
        </div>
      )}
      {demo.length > 0 && <p className="fine-print">Test guardian keys, only on the local dev server. These are real transactions on NEAR testnet.</p>}
      <details className="proposal-record guardian-cli">
        <summary>Sign with your own guardian key</summary>
        {canApprove && <pre>{cliCommand(account, "approve_offer", proposal.id)}</pre>}
        {needsRetry && <pre>{cliCommand(account, "retry_signature", proposal.id)}</pre>}
        {canCancel && <pre>{cliCommand(account, "vote_cancel", proposal.id)}</pre>}
      </details>
    </div>
  );
}

function ProposalCard({ proposal, config, account, onChange }: { proposal: NearProposal; config: NearConfig; account: string; onChange(): Promise<void> }) {
  // Recomputed in the browser; no value reported by a page or server is trusted.
  const textHash = keccak256(stringToHex(proposal.evidence));
  const matches = proposal.cases.every((item) => item.terms.evidence_hash === textHash);

  return (
    <li className="proposal">
      <div className="proposal-head">
        <span className="proposal-chain">{proposal.cases.length === 1 ? "One case" : `${proposal.cases.length} cases, one offer`}</span>
        <span className={proposal.status === "Signed" ? "badge badge-open" : proposal.status === "Cancelled" ? "badge" : "badge badge-loading"}>{STATUS_NOTE[proposal.status] ?? proposal.status}</span>
        <span className="muted small">Proposal {proposal.id}</span>
      </div>
      <blockquote className="proposal-offer">{offerText(proposal.evidence)}</blockquote>
      <p className={matches ? "proposal-hash is-good" : "proposal-hash is-bad"}>
        {matches ? "Matches the hash in the signed terms of every case. Checked in your browser." : "Does not match the hash in the signed terms."}
      </p>
      <p className="proposal-approvals">{proposal.approvals.length ? `Approved once by ${proposal.approvals.map(nearName).join(", ")}` : "Nobody has approved this yet"}</p>
      {proposal.cancel_votes.length > 0 && <p className="proposal-approvals">Voted to cancel: {proposal.cancel_votes.map(nearName).join(", ")}</p>}
      {proposal.status === "Cancelled" && <p className="fine-print">A case that was already open before this vote stays open and keeps its terms. See the last column for each chain.</p>}
      <GuardianControls proposal={proposal} config={config} account={account} onChange={onChange} />
      <div className="table-wrap">
        <table className="data-table offer-table">
          <thead><tr><th scope="col">Chain</th><th scope="col">Reward</th><th scope="col">Signature</th><th scope="col">Signed hash</th><th scope="col">Case</th></tr></thead>
          <tbody>
            {proposal.cases.map((item) => <CaseRow key={item.digest} item={item} config={config} />)}
          </tbody>
        </table>
      </div>
      <details className="proposal-record">
        <summary>Full public record</summary>
        <pre>{prettyRecord(proposal.evidence)}</pre>
      </details>
    </li>
  );
}

function CaseRow({ item, config }: { item: NearProposalCase; config: NearConfig }) {
  const { terms } = item;
  const target = TESTNET_CHAINS[terms.chain_id];
  const pactum = config.deployments.find((entry) => entry.chain_id === terms.chain_id)?.pactum as Address | undefined;
  const { deployment } = useApp();
  const { persona, address, readOnly } = useWallet();
  const toast = useToast();
  const [opened, setOpened] = useState<boolean | null | undefined>(undefined);
  const [used, setUsed] = useState<boolean | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!pactum) return;
    let cancelled = false;
    Promise.all([caseIsOpen(terms.chain_id, pactum, terms.case_id), nonceIsUsed(terms.chain_id, pactum, terms.nonce)]).then(([isOpen, isUsed]) => {
      if (cancelled) return;
      setOpened(isOpen);
      setUsed(isUsed);
    });
    return () => {
      cancelled = true;
    };
  }, [pactum, terms.chain_id, terms.case_id, terms.nonce, version]);

  // The local build's test accounts have no ETH on testnet, so the button only shows when a usable wallet exists.
  const canSend = deployment.network !== "local" && !!address && !readOnly;
  const canOpen = item.status === "Signed" && item.signature && opened === false && used === false;
  const canRevoke = item.status === "Revoked" && item.revocation && opened === false && used === false;
  const place = opened === undefined ? "Reading…" : opened === null ? "Could not read" : opened ? "Open" : used ? "Revoked on chain" : "Not opened yet";

  const relay = async () => {
    if (!pactum) return;
    setBusy(true);
    try {
      const hash = canRevoke
        ? await relayToChain(terms.chain_id, pactum, persona, { revokeNonce: terms.nonce, signature: item.revocation as Hex })
        : await relayToChain(terms.chain_id, pactum, persona, { open: terms, signature: item.signature as Hex });
      toast({ kind: "ok", title: canRevoke ? "Revocation sent" : "Case opened", href: target ? `${target.explorer}/tx/${hash}` : null });
      setVersion((value) => value + 1);
    } catch (reason) {
      toast({ kind: "error", title: "Could not relay the signature", detail: reason instanceof Error ? reason.message.split("\n")[0] : "Unknown error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="offer-chain">
      <td className="offer-chain-name">{target?.label ?? `Chain ${terms.chain_id}`}</td>
      <td>{terms.tiers.map((tier) => `${tier.reward_bps / 100}% until ${date(tier.until)}`).join(", then ")}</td>
      <td>{CASE_STATUS_NOTE[item.status] ?? item.status}</td>
      <td><code>{shortAddress(item.digest)}</code></td>
      <td>
        {place}
        {canSend && (canOpen || canRevoke) && (
          <button type="button" className="button button-ghost relay-button" disabled={busy} onClick={relay}>
            {busy ? <><span className="spinner" /> Sending…</> : canRevoke ? "Send the revocation" : "Open this case"}
          </button>
        )}
      </td>
    </tr>
  );
}
