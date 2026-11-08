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
import { earn } from "../fun";
import { useWallet } from "../wallet";

const PAGE_SIZE = 50;
const SHOWN_AT_ONCE = 5;

type Filter = "all" | "action" | "approved" | "cancelled";
type ChainState = Record<string, { opened: boolean | null; used: boolean | null }>;

// The protocol name comes from the offer's record. It is text written by a guardian; the contract cannot verify it.
function protocolOf(proposal: NearProposal): string {
  try {
    const parsed = JSON.parse(proposal.evidence) as { incident?: unknown };
    if (typeof parsed.incident === "string" && parsed.incident) return parsed.incident;
  } catch {
    // Plain text: handled below.
  }
  if (proposal.evidence.startsWith("Drill")) return "Pactum drill, not a real hack";
  if (proposal.evidence.startsWith("Follow-up offer")) return "Demo protocol";
  return "Unnamed protocol";
}

function bucketOf(proposal: NearProposal, chain: ChainState): Exclude<Filter, "all"> {
  if (proposal.status === "Cancelled") {
    const unsent = proposal.cases.some((item) => item.status === "Revoked" && chain[item.digest]?.used === false && chain[item.digest]?.opened === false);
    return isWaiting(proposal) || unsent ? "action" : "cancelled";
  }
  if (proposal.status === "Signed") return proposal.cases.some((item) => chain[item.digest]?.opened === false) ? "action" : "approved";
  return "action";
}

// One sentence on what this offer is waiting for, so nobody has to read the whole table.
function nextAction(proposal: NearProposal, chain: ChainState, config: NearConfig): string | null {
  const unopened = proposal.cases.filter((item) => chain[item.digest]?.opened === false);
  if (proposal.status === "Pending") {
    const left = Math.max(1, config.threshold - proposal.approvals.length);
    return `Needs ${left} more guardian ${left === 1 ? "approval" : "approvals"}.`;
  }
  if (proposal.cases.some((item) => IN_FLIGHT.includes(item.status))) return "The NEAR network is signing. This usually takes about 10 seconds.";
  if (isWaiting(proposal)) return "Some signatures are still missing. Anyone can ask for them.";
  if (proposal.status === "Signed" && unopened.length > 0) return `Signed, but ${unopened.length} ${unopened.length === 1 ? "chain has" : "chains have"} not been opened yet. Anyone can send the signature.`;
  if (proposal.status === "Cancelled" && bucketOf(proposal, chain) === "action") return "Cancelled on NEAR. Someone still has to send the revocation to each chain.";
  return null;
}

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
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(SHOWN_AT_ONCE);
  const [chain, setChain] = useState<ChainState>({});
  const [chainVersion, setChainVersion] = useState(0);
  const toast = useToast();
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

  useEffect(() => {
    const badge = earn("detective");
    if (badge) toast({ kind: "ok", title: `Badge unlocked: ${badge.name}`, detail: badge.how });
    // Only needs to be reported once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reads each case's state on its own chain. Needed at page level so the filters know which offers still need action.
  const proposalKey = data?.proposals.map((item) => `${item.id}:${item.status}:${item.cases.map((entry) => entry.status).join()}`).join("|") ?? "";
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const rows = data.proposals.flatMap((proposal) => proposal.cases);
    Promise.all(
      rows.map(async (item) => {
        const pactum = data.config.deployments.find((entry) => entry.chain_id === item.terms.chain_id)?.pactum as Address | undefined;
        if (!pactum) return [item.digest, { opened: null, used: null }] as const;
        const [opened, used] = await Promise.all([caseIsOpen(item.terms.chain_id, pactum, item.terms.case_id), nonceIsUsed(item.terms.chain_id, pactum, item.terms.nonce)]);
        return [item.digest, { opened, used }] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setChain(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // Only re-read when there is a new offer or state, or right after a signature was relayed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalKey, chainVersion]);

  const newestFirst = data ? [...data.proposals].reverse() : [];
  const counts = { action: 0, approved: 0, cancelled: 0 };
  for (const item of newestFirst) counts[bucketOf(item, chain)] += 1;
  const matching = newestFirst.filter((item) => filter === "all" || bucketOf(item, chain) === filter);
  const FILTERS: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: newestFirst.length },
    { id: "action", label: "Action required", count: counts.action },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

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
              <div className="gd-summary" role="group" aria-label="Filter offers">
                {FILTERS.map((item) => (
                  <button key={item.id} type="button" className={`gd-filter${filter === item.id ? " is-active" : ""}${item.id === "action" && item.count > 0 ? " is-urgent" : ""}`} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setShown(SHOWN_AT_ONCE); }}>
                    {item.label} <span className="gd-count">{item.count}</span>
                  </button>
                ))}
              </div>
              {matching.length === 0 && <p className="empty">Nothing here right now.</p>}
              <ol className="proposals">
                {matching.slice(0, shown).map((item) => (
                  <ProposalCard key={item.id} proposal={item} config={data.config} account={account} chain={chain} onChange={load} onRelayed={() => setChainVersion((value) => value + 1)} />
                ))}
              </ol>
              {matching.length > shown && (
                <button type="button" className="button button-ghost show-more" onClick={() => setShown((value) => value + SHOWN_AT_ONCE)}>Show more ({matching.length - shown} left)</button>
              )}
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

function ProposalCard({ proposal, config, account, chain, onChange, onRelayed }: { proposal: NearProposal; config: NearConfig; account: string; chain: ChainState; onChange(): Promise<void>; onRelayed(): void }) {
  // Recomputed in the browser; no value reported by a page or server is trusted.
  const textHash = keccak256(stringToHex(proposal.evidence));
  const matches = proposal.cases.every((item) => item.terms.evidence_hash === textHash);
  const total = proposal.cases.length;
  const signed = proposal.cases.filter((item) => item.signature).length;
  const live = proposal.cases.filter((item) => chain[item.digest]?.opened === true).length;
  const keep = (proposal.cases[0]?.terms.tiers[0]?.reward_bps ?? 0) / 100;
  const chainCount = new Set(proposal.cases.map((item) => item.terms.chain_id)).size;
  const bucket = bucketOf(proposal, chain);
  const next = nextAction(proposal, chain, config);
  const approved = proposal.status !== "Pending" || proposal.approvals.length >= config.threshold;
  const steps = [
    { label: "Proposed", value: "Done", state: "is-done" },
    { label: "Guardians", value: `${Math.min(proposal.approvals.length, config.threshold)} of ${config.threshold}`, state: approved ? "is-done" : "is-now" },
    { label: "Signatures", value: `${signed} of ${total}`, state: signed === total ? "is-done" : approved ? "is-now" : "" },
    proposal.status === "Cancelled"
      ? { label: "Outcome", value: "Cancelled", state: "" }
      : { label: "Live on chain", value: `${live} of ${total}`, state: live === total ? "is-done" : signed === total ? "is-now" : "" },
  ];

  return (
    <li className={`proposal is-${bucket}`}>
      <div className="proposal-top">
        <div>
          <p className="proposal-protocol">{protocolOf(proposal)}</p>
          <p className="proposal-sub">Holder keeps up to {keep}% · {chainCount} {chainCount === 1 ? "chain" : "chains"} · {total} {total === 1 ? "case" : "cases"} · Proposal {proposal.id}</p>
        </div>
        <span className={proposal.status === "Signed" ? "badge badge-open" : proposal.status === "Cancelled" ? "badge" : "badge badge-loading"}>{STATUS_NOTE[proposal.status] ?? proposal.status}</span>
      </div>
      <ol className="proposal-steps">
        {steps.map((step) => <li key={step.label} className={step.state}><strong>{step.value}</strong>{step.label}</li>)}
      </ol>
      {next && <p className="proposal-next"><strong>Next:</strong> {next}</p>}
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
          <thead><tr><th scope="col">Chain</th><th scope="col">Reward</th><th scope="col">Signature</th><th scope="col">Case</th></tr></thead>
          <tbody>
            {proposal.cases.map((item) => <CaseRow key={item.digest} item={item} config={config} state={chain[item.digest]} onRelayed={onRelayed} />)}
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

function CaseRow({ item, config, state, onRelayed }: { item: NearProposalCase; config: NearConfig; state: ChainState[string] | undefined; onRelayed(): void }) {
  const { terms } = item;
  const target = TESTNET_CHAINS[terms.chain_id];
  const pactum = config.deployments.find((entry) => entry.chain_id === terms.chain_id)?.pactum as Address | undefined;
  const { deployment } = useApp();
  const { persona, address, readOnly } = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const opened = state?.opened;
  const used = state?.used;

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
      onRelayed();
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
