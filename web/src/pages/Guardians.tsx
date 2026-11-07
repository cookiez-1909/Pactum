// Guardians page: reads the NEAR contract directly, with no server. This is where an offer is read and approved
// once before any signature exists, for every chain it covers.
import { useEffect, useState } from "react";
import { keccak256, stringToHex, type Address } from "viem";
import proof from "../../../deployments/sepolia.json";
import { useApp } from "../appdata";
import { caseIsOpen, nearAccessKeyCount, nearAccountUrl, nearView, TESTNET_CHAINS, type NearChainVote, type NearConfig, type NearProposal, type NearProposalCase } from "../chain";
import { ExternalLink } from "../components/icons";
import { shortAddress } from "../format";
import { nearName } from "../labels";

const PAGE_SIZE = 50;

interface Snapshot {
  config: NearConfig;
  proposals: NearProposal[];
  votes: NearChainVote[];
  keys: number | null;
}

const STATUS_NOTE: Record<string, string> = {
  Pending: "Waiting for guardians",
  Approved: "Approved, waiting for signatures",
  Signed: "Signed for every chain",
};

const CASE_STATUS_NOTE: Record<string, string> = {
  Unsigned: "Not signed yet",
  Signing: "Signing",
  Signed: "Signed",
};

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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [config, proposals, votes, keys] = await Promise.all([
          nearView<NearConfig>(account, "get_config", {}),
          nearView<NearProposal[]>(account, "list_proposals", { from: "0", limit: PAGE_SIZE }),
          nearView<NearChainVote[]>(account, "list_chain_proposals", { from: "0", limit: PAGE_SIZE }),
          nearAccessKeyCount(account),
        ]);
        if (cancelled) return;
        if (!config || !proposals || !votes) throw new Error("empty");
        setData({ config, proposals, votes, keys });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const poll = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [account]);

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
                  <ProposalCard key={item.id} proposal={item} config={data.config} />
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
          </div>
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, config }: { proposal: NearProposal; config: NearConfig }) {
  // Recomputed in the browser; no value reported by a page or server is trusted.
  const textHash = keccak256(stringToHex(proposal.evidence));
  const matches = proposal.cases.every((item) => item.terms.evidence_hash === textHash);

  return (
    <li className="proposal">
      <div className="proposal-head">
        <span className="proposal-chain">{proposal.cases.length === 1 ? "One case" : `${proposal.cases.length} cases, one offer`}</span>
        <span className={proposal.status === "Signed" ? "badge badge-open" : "badge badge-loading"}>{STATUS_NOTE[proposal.status] ?? proposal.status}</span>
        <span className="muted small">Proposal {proposal.id}</span>
      </div>
      <blockquote className="proposal-offer">{offerText(proposal.evidence)}</blockquote>
      <p className={matches ? "proposal-hash is-good" : "proposal-hash is-bad"}>
        {matches ? "Matches the hash in the signed terms of every case. Checked in your browser." : "Does not match the hash in the signed terms."}
      </p>
      <p className="proposal-approvals">{proposal.approvals.length ? `Approved once by ${proposal.approvals.map(nearName).join(", ")}` : "Nobody has approved this yet"}</p>
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
  const [opened, setOpened] = useState<boolean | null | undefined>(undefined);

  useEffect(() => {
    if (!pactum) return;
    let cancelled = false;
    caseIsOpen(terms.chain_id, pactum, terms.case_id).then((value) => {
      if (!cancelled) setOpened(value);
    });
    return () => {
      cancelled = true;
    };
  }, [pactum, terms.chain_id, terms.case_id]);

  return (
    <tr className="offer-chain">
      <td className="offer-chain-name">{target?.label ?? `Chain ${terms.chain_id}`}</td>
      <td>{terms.tiers.map((tier) => `${tier.reward_bps / 100}% until ${date(tier.until)}`).join(", then ")}</td>
      <td>{CASE_STATUS_NOTE[item.status] ?? item.status}</td>
      <td><code>{shortAddress(item.digest)}</code></td>
      <td>{opened === undefined ? "Reading…" : opened === null ? "Could not read" : opened ? "Open" : "Not opened yet"}</td>
    </tr>
  );
}
