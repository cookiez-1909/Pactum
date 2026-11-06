import { useMemo, useState } from "react";
import { useApp } from "../appdata";
import { AssetSummary, RecoveryBar, RecoveryLegend, StatusBadge, type LostAsset } from "../components/case-bits";
import { CountUp } from "../components/motion";
import { countdown, usd } from "../format";
import { currentOffer, incidentStatus, incidentTotals, rankIncidents, usdOf, type Incident, type IncidentStatus } from "../useDesk";

const STATUS_FILTERS: (IncidentStatus | "All")[] = ["All", "Open", "Partly returned", "Awaiting offer", "Fully returned", "Closed"];

export function lostAssets(incident: Incident): LostAsset[] {
  return [
    ...incident.cases.map((info) => ({ symbol: info.token.symbol, decimals: info.token.decimals, amount: BigInt(info.terms.totalLoss), value: usdOf(BigInt(info.terms.totalLoss), info.token) })),
    ...incident.pending.map((asset) => ({ symbol: asset.token.symbol, decimals: asset.token.decimals, amount: BigInt(asset.totalLoss), value: usdOf(BigInt(asset.totalLoss), asset.token) })),
  ];
}

export function CasesPage() {
  const { desk } = useApp();
  const { incidents, states, loaded, now } = desk;
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "All">("All");
  const [assetFilter, setAssetFilter] = useState("All");
  const assets = useMemo(() => [...new Set(incidents.flatMap((item) => lostAssets(item).map((asset) => asset.symbol)))].sort(), [incidents]);

  const totals = useMemo(() => {
    const sum = { lost: 0, returned: 0, refunds: 0, open: 0 };
    for (const incident of incidents) {
      const item = incidentTotals(incident, states);
      sum.lost += item.lost;
      sum.returned += item.returned;
      sum.refunds += item.refund;
      if (currentOffer(incident, states)) sum.open += 1;
    }
    return sum;
  }, [incidents, states]);

  const visible = rankIncidents(incidents, states).filter((incident) => {
    const status = incidentStatus(incident, states);
    const hasAsset = assetFilter === "All" || lostAssets(incident).some((asset) => asset.symbol === assetFilter);
    return (statusFilter === "All" || status === statusFilter) && hasAsset;
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Cases</h1>
          <p>Every protocol here is fictional and the tokens have no value. The transactions and contract rules are real.</p>
        </div>
      </header>

      <dl className="stat-grid">
        <div className="stat"><dt>Accepting funds</dt><dd>{loaded ? `${totals.open} of ${incidents.length}` : <span className="skeleton" />}</dd></div>
        <div className="stat"><dt>Total lost</dt><dd><CountUp value={totals.lost} format={usd} /></dd></div>
        <div className="stat"><dt>Returned</dt><dd>{loaded ? <CountUp value={totals.returned} format={usd} /> : <span className="skeleton" />}</dd></div>
        <div className="stat"><dt>In refund pools</dt><dd>{loaded ? <CountUp value={totals.refunds} format={usd} /> : <span className="skeleton" />}</dd></div>
      </dl>
      <p className="fine-print">Dollar values use made-up prices, only to add different assets together.</p>

      <div className="toolbar">
        <div className="pills" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((item) => (
            <button key={item} type="button" className={statusFilter === item ? "pill is-active" : "pill"} aria-pressed={statusFilter === item} onClick={() => setStatusFilter(item)}>{item}</button>
          ))}
        </div>
        <label className="select-field">
          <span className="sr-only">Filter by asset</span>
          <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="All">All assets</option>
            {assets.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div className="case-table">
        <div className="case-head" aria-hidden="true">
          <span>Protocol</span><span>Assets lost</span><span>Recovery</span><span>Offer</span><span>Status</span>
        </div>
        <ul>
          {visible.map((incident, index) => {
            const status = incidentStatus(incident, states);
            const offer = currentOffer(incident, states);
            const sum = incidentTotals(incident, states);
            return (
              <li key={incident.id} style={{ animationDelay: `${index * 45}ms` }} className={status === "Closed" ? "case-row is-closed" : "case-row"}>
                <a href={`#/case/${incident.id}`} className="case-link">
                  <span className="case-identity">
                    <span>
                      <span className="case-name">{incident.name}</span>
                      <span className="case-worth mono">{usd(sum.lost)} lost</span>
                    </span>
                  </span>
                  <span className="case-cell"><AssetSummary assets={lostAssets(incident)} /></span>
                  <span className="case-cell case-progress">
                    <RecoveryBar total={sum.lost} reward={sum.reward} refund={sum.refund} label={`${usd(sum.reward)} reward paid, ${usd(sum.refund)} refunds, ${usd(sum.lost - sum.returned)} not returned`} />
                  </span>
                  <span className="case-cell">
                    <span className="cell-label">Offer</span>
                    {offer ? (
                      <><span className="mono strong">Keep {offer.rewardBps / 100}%</span> <span className="muted small mono case-countdown">{countdown(offer.until, now)}</span></>
                    ) : (
                      <span className="muted">{status === "Awaiting offer" ? "Not published yet" : "Ended"}</span>
                    )}
                  </span>
                  <span className="case-cell"><StatusBadge status={status} /></span>
                </a>
              </li>
            );
          })}
        </ul>
        {visible.length === 0 && <p className="empty">No cases match these filters.</p>}
      </div>
      <RecoveryLegend />
    </div>
  );
}
