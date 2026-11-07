// An incident page: a multi-asset overview, the protocol's offer, returns, refunds and the ledger.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import { useApp, useToast } from "../appdata";
import { deskAbi, discussionTopic, notesAbi, fetchNearProposal, hashEvidence, offerCaseId, publicClientOf, signAsSimulatedController, txUrl, walletFor, type CaseInfo, type CaseTerms, type Evidence, type NearProposal, type PendingAsset } from "../chain";
import { AssetIcon, RecoveryBar, RecoveryLegend, StatusBadge } from "../components/case-bits";
import { Check } from "../components/icons";
import { CopyButton, Party } from "../components/Party";
import { countdown, shortAddress, tokens, usd } from "../format";
import { nearName } from "../labels";
import { currentOffer, incidentStatus, incidentTotals, statusOf, usdOf, type Incident } from "../useDesk";
import { useNotes } from "../useNotes";
import { useWallet } from "../wallet";
import { Negotiation } from "./Negotiation";
import { Ledger, Refund, ReturnFunds, RewardSchedule, TxLink, type SessionTx } from "./CasePage";
import { Discussion } from "./Discussion";

export type Tab = "incident" | "offer" | "return" | "refund" | "discussion" | "ledger";
export const TAB_IDS: Tab[] = ["incident", "offer", "return", "refund", "discussion", "ledger"];
const TABS: { id: Tab; label: string }[] = [
  { id: "incident", label: "Overview" },
  { id: "offer", label: "Offer" },
  { id: "return", label: "Return funds" },
  { id: "refund", label: "Refund" },
  { id: "discussion", label: "Discussion" },
  { id: "ledger", label: "Ledger" },
];

function offerConditions(incident: Incident): string {
  return incident.cases.map((info) => info.evidence?.offer?.conditions ?? "").find((text) => text.length > 0) ?? "";
}

export function IncidentPage({ incident, tab, symbol }: { incident: Incident; tab: Tab; symbol: string | null }) {
  const { deployment, desk } = useApp();
  const [sessionTxs, setSessionTxs] = useState<SessionTx[]>([]);
  const { refresh, states, now } = desk;
  const onTx = useCallback(
    (label: string, hash: Hash) => {
      setSessionTxs((rows) => [...rows, { label, hash }]);
      void refresh();
    },
    [refresh],
  );
  const status = incidentStatus(incident, states);
  const offer = currentOffer(incident, states);
  const sum = incidentTotals(incident, states);
  const selected = incident.cases.find((info) => info.token.symbol === symbol) ?? incident.cases[0];
  const needsAsset = tab === "return" || tab === "refund" || tab === "ledger";
  const conditions = offerConditions(incident);
  const discussion = useNotes(deployment, discussionTopic(incident.id));

  return (
    <div className="page">
      <a className="crumb" href="#/cases">Cases</a>
      <header className="case-header">
        <div className="case-header-text">
          <div className="case-title">
            <h1>{incident.name}</h1>
            <StatusBadge status={status} />
            {incident.fictional && <span className="tag">Fictional</span>}
          </div>
          <p>{incident.summary}</p>
        </div>
      </header>

      <dl className="stat-grid stat-grid-compact">
        <div className="stat"><dt>Lost</dt><dd className="stat-small">{usd(sum.lost)}</dd></div>
        <div className="stat"><dt>Returned</dt><dd className="stat-small">{desk.loaded ? usd(sum.returned) : <span className="skeleton" />}</dd></div>
        <div className="stat"><dt>Hacker can keep</dt><dd className="stat-small">{desk.loaded ? (offer ? `${offer.rewardBps / 100}%` : status === "Awaiting offer" ? "No offer yet" : "Nothing") : <span className="skeleton" />}</dd></div>
        <div className="stat"><dt>{offer ? "Rate ends in" : "In refund pool"}</dt><dd className="stat-small">{desk.loaded ? (offer ? countdown(offer.until, now) : usd(sum.refund)) : <span className="skeleton" />}</dd></div>
      </dl>

      <nav className="tabs" aria-label="Case sections">
        {TABS.map(({ id, label }) => (
          <a key={id} href={`#/case/${incident.id}/${id}${selected && (id === "return" || id === "refund" || id === "ledger") ? `/${selected.token.symbol}` : ""}`} className={tab === id ? "tab is-active" : "tab"} aria-current={tab === id ? "page" : undefined}>{label}{id === "discussion" && <span className="tab-count">{discussion.notes.length}</span>}</a>
        ))}
      </nav>

      <div className="tab-panel" key={tab}>
        {needsAsset && incident.cases.length === 0 && (
          <p className="block-reason" role="status">The protocol has not published an offer yet, so there is nothing to return or claim. <a href={`#/case/${incident.id}/offer`}>See the Offer tab</a>.</p>
        )}
        {needsAsset && selected && (
          <>
            {tab === "return" && conditions && (
              <div className="conditions-banner">
                <p className="conditions-label">Special conditions from the protocol</p>
                <p>{conditions}</p>
                <p className="fine-print">Published with the offer and fixed by a hash. The contract does not enforce them. <a href={`#/case/${incident.id}/offer`}>See the offer</a></p>
              </div>
            )}
            <AssetPicker incident={incident} selected={selected} tab={tab} />
            <div key={selected.id}>
              {tab === "return" && <ReturnFunds info={selected} state={states[selected.id]} onTx={onTx} />}
              {tab === "refund" && <Refund info={selected} state={states[selected.id]} onTx={onTx} />}
              {tab === "ledger" && <Ledger info={selected} sessionTxs={sessionTxs} />}
            </div>
          </>
        )}
        {tab === "incident" && <Overview incident={incident} />}
        {tab === "offer" && <OfferTab incident={incident} onTx={onTx} />}
        {tab === "discussion" && <Discussion incident={incident} notes={discussion.notes} failed={discussion.failed} reload={discussion.reload} />}
      </div>
    </div>
  );
}

// Each token is a separate case on the contract, so returns and refunds are done per asset.
function AssetPicker({ incident, selected, tab }: { incident: Incident; selected: CaseInfo; tab: Tab }) {
  const { desk } = useApp();
  if (incident.cases.length < 2) return null;
  return (
    <div className="asset-picker" role="group" aria-label="Choose an asset">
      {incident.cases.map((info) => {
        const state = desk.states[info.id];
        const left = state ? BigInt(info.terms.maxReturn) - state.totalReturned : null;
        return (
          <a key={info.id} href={`#/case/${incident.id}/${tab}/${info.token.symbol}`} className={info.id === selected.id ? "asset-option is-active" : "asset-option"} aria-current={info.id === selected.id ? "true" : undefined}>
            <AssetIcon symbol={info.token.symbol} size="sm" />
            <span>
              <span className="asset-option-name">{info.token.symbol}</span>
              <span className="asset-option-left mono">{left === null ? "…" : left === 0n ? "Returned" : `${tokens(left, info.token.decimals, 2)} left`}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function Overview({ incident }: { incident: Incident }) {
  const { deployment, desk } = useApp();
  const [proposal, setProposal] = useState<NearProposal | null>(null);
  const [nearFailed, setNearFailed] = useState(false);
  const { near, contracts, controllerAddress, actors } = deployment;
  const { states } = desk;
  const sum = incidentTotals(incident, states);

  useEffect(() => {
    if (near.simulated) return;
    fetchNearProposal(deployment)
      .then((result) => {
        setProposal(result);
        setNearFailed(result === null);
      })
      .catch(() => setNearFailed(true));
  }, [deployment, near.simulated]);

  const anyOpen = incident.cases.length > 0;
  const drainTx = incident.cases[0]?.txs.drain ?? incident.pending[0]?.txs.drain;
  const vault = incident.cases[0]?.vault ?? incident.pending[0]?.vault;
  const attacker = incident.cases[0]?.attacker ?? incident.pending[0]?.attacker ?? actors.attacker;
  // The reward cap applied when the actual reward is below even the lowest rate in the schedule.
  const capped = incident.cases.filter((info) => {
    const state = states[info.id];
    if (!state || state.totalReturned === 0n) return false;
    const lowest = Math.min(...info.terms.tiers.map((tier) => tier.rewardBps));
    return state.totalReward * 10_000n < state.totalReturned * BigInt(lowest);
  });

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card">
          <h2>Where the money is now</h2>
          <RecoveryBar total={sum.lost} reward={sum.reward} refund={sum.refund} tall label={`${usd(sum.reward)} reward paid, ${usd(sum.refund)} refunds, ${usd(sum.lost - sum.returned)} not returned`} />
          <RecoveryLegend />
          <div className="table-wrap">
            <table className="data-table asset-table">
              <thead>
                <tr><th scope="col">Asset</th><th scope="col" className="num">Lost</th><th scope="col" className="num">Returned</th><th scope="col" className="num">Reward paid</th><th scope="col" className="num">Max reward</th><th scope="col" className="num">To refunds</th><th scope="col" className="num">Value</th></tr>
              </thead>
              <tbody>
                {incident.cases.map((info) => {
                  const state = states[info.id];
                  const fmt = (value: bigint | undefined) => (value === undefined ? "…" : tokens(value, info.token.decimals, 2));
                  return (
                    <tr key={info.id}>
                      <td><a className="asset-cell" href={`#/case/${incident.id}/return/${info.token.symbol}`}><AssetIcon symbol={info.token.symbol} size="sm" /> {info.token.symbol}</a></td>
                      <td className="num">{fmt(BigInt(info.terms.totalLoss))}</td>
                      <td className="num">{fmt(state?.totalReturned)}</td>
                      <td className="num">{fmt(state?.totalReward)}</td>
                      <td className="num muted">{fmt(BigInt(info.terms.rewardCap))}</td>
                      <td className="num">{fmt(state?.totalRefund)}</td>
                      <td className="num muted">{usd(usdOf(BigInt(info.terms.totalLoss), info.token))}</td>
                    </tr>
                  );
                })}
                {incident.pending.map((asset) => (
                  <tr key={asset.id}>
                    <td><span className="asset-cell"><AssetIcon symbol={asset.token.symbol} size="sm" /> {asset.token.symbol}</span></td>
                    <td className="num">{tokens(BigInt(asset.totalLoss), asset.token.decimals, 2)}</td>
                    <td className="num">0</td>
                    <td className="num">0</td>
                    <td className="num muted">None yet</td>
                    <td className="num">0</td>
                    <td className="num muted">{usd(usdOf(BigInt(asset.totalLoss), asset.token))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {capped.length > 0 && (
            <p className="cap-note" role="note">
              <strong>The reward cap applied.</strong> The offer sets a maximum reward for each asset. For {capped.map((info) => info.token.symbol).join(" and ")}, the percentage alone would pay more than that maximum, so the holder got the maximum and the rest went to users.
            </p>
          )}
          <p className="fine-print">Dollar values use made-up prices. These are mock ERC-20 tokens. A real asset would need a wrapped version on the contract&rsquo;s own chain.</p>
        </section>

        <section className="card">
          <h2>Timeline</h2>
          <ol className="timeline">
            <li className="is-bad">
              <p className="timeline-title">Protocol drained</p>
              <p className="timeline-body">{vault && <Party address={vault} compact />} lost {usd(sum.lost)} across {incident.cases.length + incident.pending.length} assets to <Party address={attacker} compact /></p>
              {drainTx && <TxLink hash={drainTx} />}
            </li>
            {!anyOpen && (
              <li>
                <p className="timeline-title">Waiting for an offer</p>
                <p className="timeline-body">The protocol owner has not published terms yet.</p>
              </li>
            )}
            {anyOpen && (
              <>
                <li>
                  <p className="timeline-title">Offer approved and signed</p>
                  <p className="timeline-body">{near.simulated ? "A local test key signed the terms, standing in for NEAR." : `${near.threshold} of ${near.guardians?.length} guardians approved on NEAR, and Chain Signatures signed the hash.`}</p>
                  {near.txs?.approve2 && <TxLink hash={near.txs.approve2} near />}
                </li>
                <li>
                  <p className="timeline-title">Case opened</p>
                  <p className="timeline-body">Terms are fixed from this point. Anyone can relay the signature.</p>
                  {incident.cases[0]?.txs.openCase && <TxLink hash={incident.cases[0].txs.openCase} />}
                </li>
              </>
            )}
            {sum.returned > 0 && (
              <li className="is-good">
                <p className="timeline-title">{usd(sum.returned)} returned</p>
                <p className="timeline-body">{usd(sum.reward)} paid as reward{capped.length > 0 ? ", limited by the reward cap" : ""}, {usd(sum.refund)} booked for users.</p>
              </li>
            )}
          </ol>
        </section>
      </div>

      <div className="col-side">
        <section className="card">
          <h2>Who decided</h2>
          {near.simulated ? (
            <p className="notice">Local mode. The controller is <strong>simulated</strong> with a test key. No NEAR contract or Chain Signatures are involved in this run. <a href="#/guardians">See the real controller on NEAR testnet</a>.</p>
          ) : (
            <dl className="facts">
              <div><dt>NEAR contract</dt><dd className="break"><a href={`https://testnet.nearblocks.io/address/${near.controllerAccount}`} target="_blank" rel="noreferrer">{near.controllerAccount}</a></dd></div>
              <div><dt>Proposal</dt><dd>{proposal ? <strong>{proposal.status}</strong> : nearFailed ? "NEAR read failed" : "Reading NEAR…"}</dd></div>
              <div><dt>Approvals</dt><dd>{proposal ? `${proposal.approvals.length} of ${near.guardians?.length}, ${near.threshold} needed` : "…"}</dd></div>
              <div><dt>Approved by</dt><dd>{proposal ? proposal.approvals.map(nearName).join(", ") : "…"}</dd></div>
              <div><dt>Offer text</dt><dd><a href="#/guardians">Read it as the guardians did</a></dd></div>
            </dl>
          )}
          <dl className="facts">
            <div><dt>Controller</dt><dd><Party address={controllerAddress} /></dd></div>
            <div><dt>Contract</dt><dd><Party address={contracts.Pactum} /></dd></div>
            <div><dt>Drained by</dt><dd><Party address={attacker} /></dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

// Offer tab: view the published offer, or let the protocol owner write one if there is none.
function OfferTab({ incident, onTx }: { incident: Incident; onTx: (label: string, hash: Hash) => void }) {
  const { deployment, desk } = useApp();
  const { address, readOnly } = useWallet();
  const isOwner = !readOnly && !!address && address.toLowerCase() === deployment.actors.owner?.toLowerCase();
  // Until the chain is read we do not know whether an offer exists, so do not show the form too early.
  if (!desk.loaded) return <div className="skeleton skeleton-block" />;
  // Each asset is one transaction. Keep the form until the last asset is open, otherwise
  // a reload halfway would leave the incident half open with no way to finish.
  const writing = incident.cases.length === 0 || ((isOwner || registrations.get(incident.id) === "verified") && incident.pending.length > 0);
  return (
    <div className="tab-stack">
      {writing ? <OfferForm incident={incident} onTx={onTx} /> : <OfferView incident={incident} />}
      <Negotiation incident={incident} />
    </div>
  );
}

function OfferView({ incident }: { incident: Incident }) {
  const { desk } = useApp();
  const first = incident.cases[0]!;
  const tiers = first.terms.tiers;
  const live = currentOffer(incident, desk.states);
  const keep = (live?.rewardBps ?? tiers[0]!.rewardBps) / 100;
  const conditions = offerConditions(incident);
  const matches = (info: CaseInfo) => (info.evidence ? hashEvidence(info.evidence) === info.terms.evidenceHash : null);
  const verified = incident.cases.map(matches);

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card offer-card">
          <p className="offer-label">{live ? "The offer right now" : "The offer has ended"}</p>
          <div className="offer-split" aria-hidden="true">
            <div className="bar-reward" style={{ width: `${keep}%` }} />
            <div className="bar-refund split-grow" />
          </div>
          <p className="offer-headline">Hacker keeps <strong>{keep}%</strong>, users get back <strong>{100 - keep}%</strong></p>
          <p className="muted">The holder sends everything to the contract, and the reward comes back in the same transaction. Nobody has to go first. Percentages are of what comes back.</p>
        </section>

        <section className="card">
          <h2>Special conditions</h2>
          {conditions ? (
            <blockquote className="conditions">{conditions}</blockquote>
          ) : verified.some((item) => item === null) ? (
            <p className="muted">The text of this offer could not be found on the chain. Only its hash is available.</p>
          ) : (
            <p className="muted">The protocol added no special conditions.</p>
          )}
          <p className="notice"><strong>The contract does not enforce this text.</strong> It enforces the reward, deadlines and refunds. The text is public on the chain and hashed into the signed terms, so anyone can check it was not changed afterwards.</p>
          <dl className="facts offer-hash">
            <div>
              <dt>Evidence hash</dt>
              <dd>
                <code>{shortAddress(first.terms.evidenceHash)}</code> <CopyButton value={first.terms.evidenceHash} label="evidence hash" />
                {verified.every((item) => item === true) && <span className="hash-ok"><Check /> Matches this text</span>}
                {verified.some((item) => item === false) && <span className="hash-bad">Does not match this text</span>}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="col-side">
        <RewardSchedule info={first} state={desk.states[first.id]} />
        <section className="card">
          <h2>Limits per asset</h2>
          <ul className="limit-list">
            {incident.cases.map((info) => (
              <li key={info.id}>
                <span className="asset-cell"><AssetIcon symbol={info.token.symbol} size="sm" /> {info.token.symbol}</span>
                <span className="mono muted">max reward {tokens(BigInt(info.terms.rewardCap), info.token.decimals, 2)}</span>
                <StatusBadge status={statusOf(info, desk.states[info.id])} />
              </li>
            ))}
          </ul>
          <p className="fine-print">Once published, no function can lower the reward or change these limits.</p>
        </section>
      </div>
    </div>
  );
}

const MAX_KEEP_PERCENT = 20;
const MAX_DURATION_HOURS = 24 * 365;
const DURATIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "72 hours" },
  { hours: 168, label: "7 days" },
];
const PRESETS = [5, 10, 15, 20];
const MAX_CONDITIONS = 600;

// Reads a percentage with at most 2 decimals, since the contract counts in basis points. Bad input returns null.
function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function PercentPicker({ label, value, onChange, presets, invalid }: { label: string; value: string; onChange(next: string): void; presets: number[]; invalid: boolean }) {
  const [custom, setCustom] = useState(false);
  const isPreset = !custom && presets.includes(Number(value));
  return (
    <div className="field">
      <span>{label}</span>
      <div className="picker-row" role="group" aria-label={label}>
        {presets.map((item) => (
          <button key={item} type="button" className={isPreset && Number(value) === item ? "pill is-active" : "pill"} aria-pressed={isPreset && Number(value) === item} onClick={() => { setCustom(false); onChange(String(item)); }}>{item}%</button>
        ))}
        <button type="button" className={!isPreset ? "pill is-active" : "pill"} aria-pressed={!isPreset} onClick={() => { setCustom(true); onChange(""); }}>Custom</button>
        {!isPreset && (
          <span className="input-with-unit custom-input">
            <input autoFocus inputMode="decimal" value={value} placeholder="12.5" aria-label={`${label}, custom percent`} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />
            <span className="input-unit">%</span>
          </span>
        )}
      </div>
    </div>
  );
}

function DurationPicker({ label, hours, onChange, invalid }: { label: string; hours: number | null; onChange(next: number | null): void; invalid: boolean }) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<"hours" | "days">("days");
  const update = (nextText: string, nextUnit: "hours" | "days") => {
    setText(nextText);
    setUnit(nextUnit);
    const trimmed = nextText.trim();
    onChange(/^[1-9]\d*$/.test(trimmed) ? Number(trimmed) * (nextUnit === "days" ? 24 : 1) : null);
  };
  return (
    <div className="field">
      <span>{label}</span>
      <div className="picker-row" role="group" aria-label={label}>
        {DURATIONS.map((item) => (
          <button key={item.hours} type="button" className={!custom && hours === item.hours ? "pill is-active" : "pill"} aria-pressed={!custom && hours === item.hours} onClick={() => { setCustom(false); onChange(item.hours); }}>{item.label}</button>
        ))}
        <button type="button" className={custom ? "pill is-active" : "pill"} aria-pressed={custom} onClick={() => { setCustom(true); update("", unit); }}>Custom</button>
        {custom && (
          <span className="custom-duration">
            <input autoFocus inputMode="numeric" value={text} placeholder="10" aria-label={`${label}, custom number`} aria-invalid={invalid} onChange={(event) => update(event.target.value, unit)} />
            <span className="unit-toggle" role="group" aria-label="Unit">
              {(["hours", "days"] as const).map((item) => (
                <button key={item} type="button" className={unit === item ? "pill is-active" : "pill"} aria-pressed={unit === item} onClick={() => update(text, item)}>{item}</button>
              ))}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// The post-hack registration step, simulated only: nothing is sent or saved, and a reload loses it.
// In real life this happens off chain. The contract still enforces elsewhere: only guardians can call `propose_offer`.
// Nothing on chain says who owns a protocol, so any wallet can apply, and the guardians decide whether to trust it.
type RegistrationStage = "idle" | "form" | "review" | "verified" | "rejected";
const registrations = new Map<string, RegistrationStage>();
const registrationCodes = new Map<string, string>();
const registrationProofs = new Map<string, string>();

function RegisterProtocol({ incident, stage, onStage }: { incident: Incident; stage: RegistrationStage; onStage(next: RegistrationStage, proof?: string): void }) {
  const { deployment } = useApp();
  const [website, setWebsite] = useState("");
  const [contact, setContact] = useState("");
  const [proof, setProof] = useState("");
  const complete = website.trim() && contact.trim() && proof.trim();
  // A new code for every registration. An existing post cannot contain it, so copying an old link does not work.
  const [code] = useState(() => {
    const existing = registrationCodes.get(incident.id);
    if (existing) return existing;
    const fresh = `PACTUM-${[...crypto.getRandomValues(new Uint8Array(3))].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    registrationCodes.set(incident.id, fresh);
    return fresh;
  });
  const statement = `Our only Pactum offer for ${incident.name} is on contract ${deployment.contracts.Pactum}. Code ${code}`;

  if (stage === "idle") {
    return (
      <section className="card register-card">
        <h2>No offer yet</h2>
        <p className="muted">This protocol has not published terms. Nothing can be returned or claimed until a case opens. Nothing on chain says who runs a protocol, so anyone can ask, and the guardians decide who to believe. The team writes the terms, and only guardians can propose them on NEAR.</p>
        <button type="button" className="button button-primary register-start" onClick={() => onStage("form")}>Are you the team behind this protocol?</button>
      </section>
    );
  }

  if (stage === "rejected") {
    return (
      <section className="card register-card">
        <h2>The guardians did not confirm this team</h2>
        <p className="muted">They will not propose an offer for {incident.name} on this evidence. Nothing has been published, and the team can try again with better proof.</p>
        <button type="button" className="button button-ghost" onClick={() => onStage("form")}>Start again</button>
      </section>
    );
  }

  if (stage === "review") {
    return (
      <section className="card register-card">
        <h2>Waiting for the guardians</h2>
        <p className="muted">Guardians look for code <code>{code}</code> and need at least two of these, all from before the hack:</p>
        <ul className="register-sources">
          <li><strong>Admin on chain:</strong> the code is signed by the owner or multisig of the hacked contract.</li>
          <li><strong>Public channels:</strong> the code is posted from the website or account already known for {incident.name}.</li>
          <li><strong>Known contacts:</strong> an auditor, a bug bounty platform or a security group confirms they know this team.</li>
        </ul>
        <div className="register-actions">
          <button type="button" className="button button-primary" onClick={() => onStage("verified")}>Guardians confirm</button>
          <button type="button" className="button button-ghost" onClick={() => onStage("rejected")}>Guardians reject</button>
        </div>
        <p className="fine-print"><strong>Simulated.</strong> In this demo nobody reviews the request, and these buttons stand in for the guardians&rsquo; decision. In real use it is human judgment, and the contract cannot check it.</p>
      </section>
    );
  }

  return (
    <section className="card register-card">
      <h2>Register with the guardians</h2>
      <p className="muted">Anyone can claim to run a protocol, so guardians only propose an offer for a team they have verified. After a hack, contact them off chain and show that you control {incident.name}.</p>
      <div className="register-statement">
        <p className="conditions-label">Publish exactly this from your official account, or sign it with the protocol&rsquo;s admin wallet</p>
        <p><code>{statement}</code> <CopyButton value={statement} label="statement" /></p>
        <p className="fine-print">A link on its own proves nothing, because anyone can copy one. The code is new, so only someone who controls that account or wallet can publish it. The same post lets a holder check that this offer is real.</p>
      </div>
      <label className="field">
        <span>Official website</span>
        <input value={website} placeholder="https://" onChange={(event) => setWebsite(event.target.value)} />
      </label>
      <label className="field">
        <span>How guardians can reach you</span>
        <input value={contact} placeholder="Telegram, Signal or email" onChange={(event) => setContact(event.target.value)} />
      </label>
      <label className="field">
        <span>Link to that post, or the signature</span>
        <textarea rows={2} value={proof} placeholder={`It must contain ${code}`} onChange={(event) => setProof(event.target.value)} />
      </label>
      <button type="button" className="button button-primary button-block register-send" disabled={!complete} onClick={() => onStage("review", proof.trim())}>Send to the guardians</button>
      <p className="fine-print"><strong>Simulated.</strong> Nothing you type here is sent or saved. In real use this happens by direct contact, off chain.</p>
    </section>
  );
}

function OfferForm({ incident, onTx }: { incident: Incident; onTx: (label: string, hash: Hash) => void }) {
  const { deployment, desk } = useApp();
  const toast = useToast();
  const { address, persona, connect, readOnly } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [keepText, setKeepText] = useState("20");
  const [deadline, setDeadline] = useState<number | null>(48);
  const [stepDown, setStepDown] = useState(true);
  const [laterText, setLaterText] = useState("10");
  const [laterDeadline, setLaterDeadline] = useState<number | null>(168);
  const [conditions, setConditions] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationStage>(() => registrations.get(incident.id) ?? "idle");
  const moveRegistration = (next: RegistrationStage, proof?: string) => {
    registrations.set(incident.id, next);
    if (proof) registrationProofs.set(incident.id, proof);
    setRegistration(next);
  };

  const isOwner = !readOnly && !!address && address.toLowerCase() === deployment.actors.owner?.toLowerCase();
  // The Protocol owner role is only a shortcut for trying things: it also has to pass verification before writing a new offer.
  const canWrite = !readOnly && !!address && (registration === "verified" || (isOwner && !!incident.cases[0]));
  const keep = parsePercent(keepText) ?? 0;
  const later = parsePercent(laterText);
  const keepValid = keep > 0 && keep <= MAX_KEEP_PERCENT;
  const deadlineValid = deadline !== null && deadline <= MAX_DURATION_HOURS;
  const laterPercentValid = !stepDown || (later !== null && later < keep);
  const laterTimeValid = !stepDown || (laterDeadline !== null && deadline !== null && laterDeadline > deadline && laterDeadline <= MAX_DURATION_HOURS);
  const valid = keepValid && deadlineValid && laterPercentValid && laterTimeValid && conditions.length <= MAX_CONDITIONS;
  const busy = progress !== null;
  // The last attempt stopped halfway: the remaining assets must use the exact published terms.
  const started = incident.cases[0];

  const publish = async () => {
    if ((!started && !valid) || !canWrite || deployment.network !== "local") return;
    setFailure(null);
    try {
      const { client: wallet, account } = await walletFor(deployment, persona);
      const desk_ = deployment.contracts.Pactum;
      const now = (await client.getBlock()).timestamp;
      const tiers = started ? started.terms.tiers : [{ until: (now + BigInt(deadline! * 3600)).toString(), rewardBps: Math.round(keep * 100) }];
      if (!started && stepDown) tiers.push({ until: (now + BigInt(laterDeadline! * 3600)).toString(), rewardBps: Math.round(later! * 100) });
      const finalBps = tiers[0]!.rewardBps;
      const finalConditions = started ? (started.evidence?.offer?.conditions ?? "") : conditions.trim();

      // The contract counts one case per token, so each asset needs its own opening transaction.
      for (const [index, asset] of incident.pending.entries()) {
        setProgress(`Opening ${asset.token.symbol} (${index + 1} of ${incident.pending.length})`);
        const evidence: Evidence = { incident: incident.name, protocol: asset.vault as string, token: asset.token.address, drainTx: asset.txs.drain, totalLoss: asset.totalLoss, offer: { conditions: finalConditions, ...(registrationProofs.has(incident.id) ? { officialPost: registrationProofs.get(incident.id) } : {}) } };
        const terms = buildTerms(incident, asset, tiers, evidence, finalBps, deployment.chainId, index);
        const args = termsForContract(terms);
        // Publishes the text before opening the case, so an offer is never open without readable conditions.
        const noteHash = await wallet.writeContract({ account, chain: wallet.chain, address: deployment.contracts.PublicNotes!, abi: notesAbi, functionName: "post", args: [terms.caseId, JSON.stringify(evidence)] });
        await client.waitForTransactionReceipt({ hash: noteHash });
        const digest = await client.readContract({ address: desk_, abi: deskAbi, functionName: "hashCaseTerms", args: [args] });
        const signature = await signAsSimulatedController(digest);
        const hash = await wallet.writeContract({ account, chain: wallet.chain, address: desk_, abi: deskAbi, functionName: "openCase", args: [args, signature] });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`Opening ${asset.token.symbol} reverted`);
        onTx(`Offer published for ${asset.token.symbol}`, hash);
        toast({ kind: "ok", title: `${asset.token.symbol} case opened`, href: txUrl(deployment, hash) });
      }
      await desk.refresh();
    } catch (reason) {
      const text = reason instanceof Error ? reason.message.split("\n")[0]! : "Publishing failed";
      setFailure(text);
      toast({ kind: "error", title: "Could not publish the offer", detail: text });
    } finally {
      setProgress(null);
    }
  };

  const onLocal = deployment.network === "local";

  return (
    <div className="two-col">
      <div className="col-main">
        {!address && (
          <section className="card">
            <h2>No offer yet</h2>
            <p className="muted">This protocol has not published its terms. Nothing can be returned or claimed until a case opens.</p>
            <button type="button" className="button button-primary" onClick={connect}>Connect wallet</button>
          </section>
        )}
        {address && readOnly && (
          <section className="card">
            <h2>No offer yet</h2>
            <p className="block-reason" role="status">This is a view of a wallet you typed in. It can read, but it cannot register or send anything.</p>
          </section>
        )}
        {canWrite && started && (
          <section className="card">
            <h2>Finish publishing your offer</h2>
            <p className="muted">Publishing stopped before every asset was opened. {incident.pending.map((asset) => asset.token.symbol).join(", ")} still {incident.pending.length === 1 ? "needs" : "need"} a case, using the same terms: the holder keeps {started.terms.tiers[0]!.rewardBps / 100}%.</p>
            {progress && <p className="progress-line" aria-live="polite"><span className="spinner" /> {progress}</p>}
            <button type="button" className="button button-primary button-block" disabled={busy || !onLocal} onClick={publish}>{busy ? "Publishing…" : "Finish publishing"}</button>
            {failure && <p className="field-error" role="alert">{failure}</p>}
          </section>
        )}
        {address && !readOnly && !started && registration !== "verified" && <RegisterProtocol incident={incident} stage={registration} onStage={moveRegistration} />}
        {canWrite && !started && (
          <section className="card">
            <span className="tag register-tag">Verified by the guardians, simulated</span>
            <h2>Write your offer</h2>
            <p className="muted">Offer a deal the holder can accept without talking to you. Once published, you cannot lower it.</p>

            <PercentPicker label="The hacker keeps" value={keepText} presets={PRESETS} invalid={!keepValid} onChange={setKeepText} />
            {!keepValid && <p className="field-error">Enter a percent above 0 and up to {MAX_KEEP_PERCENT}, with at most 2 decimals. The controller rejects more than {MAX_KEEP_PERCENT}%.</p>}

            <DurationPicker label="If everything comes back within" hours={deadline} invalid={!deadlineValid} onChange={setDeadline} />
            {!deadlineValid && <p className="field-error">Enter a whole number of hours or days, up to 365 days.</p>}

            <label className="check-field">
              <input type="checkbox" checked={stepDown} onChange={(event) => setStepDown(event.target.checked)} />
              <span>Then lower the reward instead of closing the case</span>
            </label>
            {stepDown && (
              <>
                <PercentPicker label="Later reward" value={laterText} presets={PRESETS.filter((item) => item < keep)} invalid={!laterPercentValid} onChange={setLaterText} />
                {!laterPercentValid && <p className="field-error">The later reward must be lower than the first one.</p>}
                <DurationPicker label="Until" hours={laterDeadline} invalid={!laterTimeValid} onChange={setLaterDeadline} />
                {!laterTimeValid && <p className="field-error">This deadline must be later than the first one, and within 365 days.</p>}
              </>
            )}

            <label className="field">
              <span>Special conditions (optional)</span>
              <textarea rows={4} value={conditions} maxLength={MAX_CONDITIONS} placeholder="For example: return within 48 hours and the team will not contact you. We will publish a full post-mortem." onChange={(event) => setConditions(event.target.value)} />
            </label>
            <p className="field-hint muted">{conditions.length} of {MAX_CONDITIONS}. Public and fixed by a hash once published. <strong>The contract does not enforce this text.</strong></p>

            {progress && <p className="progress-line" aria-live="polite"><span className="spinner" /> {progress}</p>}
            <button type="button" className="button button-primary button-block" disabled={!valid || busy || !onLocal} onClick={publish}>
              {busy ? "Publishing…" : `Publish offer for ${incident.pending.length} ${incident.pending.length === 1 ? "asset" : "assets"}`}
            </button>
            {failure && <p className="field-error" role="alert">{failure}</p>}
            {onLocal ? (
              <p className="fine-print">Local mode: a test key signs in place of the guardians. On a real deployment, guardians must approve the offer on NEAR first.</p>
            ) : (
              <p className="fine-print">On testnet, an offer needs approval from the guardians on NEAR. This form only publishes in the local demo.</p>
            )}
          </section>
        )}
      </div>

      <div className="col-side">
        {canWrite && !started && <section className="card">
          <h2>What this offer means</h2>
          {keepValid ? (
            <>
              <div className="offer-split" aria-hidden="true">
                <div className="bar-reward" style={{ width: `${keep}%` }} />
                <div className="bar-refund split-grow" />
              </div>
              <p className="offer-headline-small">Hacker keeps <strong>{keep}%</strong>, users get back <strong>{100 - keep}%</strong></p>
            </>
          ) : (
            <p className="muted">Enter a reward to see the split.</p>
          )}
          <ul className="limit-list">
            {incident.pending.map((asset) => {
              const loss = BigInt(asset.totalLoss);
              const part = keepValid ? (loss * BigInt(Math.round(keep * 100))) / 10_000n : 0n;
              return (
                <li key={asset.id}>
                  <span className="asset-cell"><AssetIcon symbol={asset.token.symbol} size="sm" /> {asset.token.symbol}</span>
                  <span className="mono muted">keeps {tokens(part, asset.token.decimals, 2)}</span>
                  <span className="mono">returns {tokens(loss - part, asset.token.decimals, 2)}</span>
                </li>
              );
            })}
          </ul>
          <p className="fine-print">Percentages are of what comes back. If nothing comes back, nobody gets anything.</p>
        </section>}
        <section className="card card-quiet">
          <h2>Why can&rsquo;t I change it later?</h2>
          <p>A holder only trusts an offer that cannot be pulled back. That is why the reward and deadlines are fixed when a case opens, even for you.</p>
        </section>
      </div>
    </div>
  );
}

function buildTerms(incident: Incident, asset: PendingAsset, tiers: { until: string; rewardBps: number }[], evidence: Evidence, firstBps: number, chainId: number, index: number): CaseTerms {
  const totalLoss = BigInt(asset.totalLoss);
  // Each new case needs an unused nonce. Use the current time so it never repeats an earlier one.
  const nonce = BigInt(Date.now()) * 100n + BigInt(index);
  return {
    caseId: offerCaseId(incident.id, asset.token.symbol),
    token: asset.token.address,
    totalLoss: asset.totalLoss,
    maxReturn: asset.totalLoss,
    rewardCap: ((totalLoss * BigInt(firstBps)) / 10_000n).toString(),
    refundRoot: asset.refundRoot,
    evidenceHash: hashEvidence(evidence),
    tiers,
    nonce: nonce.toString(),
    chainId: chainId.toString(),
  };
}

function termsForContract(terms: CaseTerms) {
  return {
    caseId: terms.caseId,
    token: terms.token,
    totalLoss: BigInt(terms.totalLoss),
    maxReturn: BigInt(terms.maxReturn),
    rewardCap: BigInt(terms.rewardCap),
    refundRoot: terms.refundRoot,
    evidenceHash: terms.evidenceHash,
    tiers: terms.tiers.map((tier) => ({ until: BigInt(tier.until), rewardBps: tier.rewardBps })),
    nonce: BigInt(terms.nonce),
    chainId: BigInt(terms.chainId),
  };
}
