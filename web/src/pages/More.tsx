// Pages under More: overall stats, and the operators' stakes on NEAR.
import { useEffect, useMemo, useState } from "react";
import registryInfo from "../../../deployments/registry.json";
import { useApp } from "../appdata";
import { nearAccountUrl, nearAmount, nearView, type RegistryConfig, type RegistryOperator } from "../chain";
import { RecoveryBar, RecoveryLegend, StatusBadge } from "../components/case-bits";
import { CountUp } from "../components/motion";
import { BADGES, earnedBadges } from "../fun";
import { usd } from "../format";
import { nearName } from "../labels";
import { incidentStatus, incidentTotals, rankIncidents, usdOf } from "../useDesk";
import { useWallet } from "../wallet";
import { useHoldings } from "./others";

// The storage fee the registry adds on registration, equal to OPERATOR_STORAGE in the contract.
const OPERATOR_STORAGE = 10n ** 22n;

export function StatsPage() {
  const { desk, activity } = useApp();
  const { address, connect, personas } = useWallet();
  const holdings = useHoldings(address);

  const all = useMemo(() => {
    const rows = rankIncidents(desk.incidents, desk.states).map((incident) => ({ incident, sum: incidentTotals(incident, desk.states), status: incidentStatus(incident, desk.states) }));
    const claimed = desk.cases.reduce((total, info) => total + usdOf(desk.states[info.id]?.totalClaimed ?? 0n, info.token), 0);
    const lost = rows.reduce((total, row) => total + row.sum.lost, 0);
    const returned = rows.reduce((total, row) => total + row.sum.returned, 0);
    const reward = rows.reduce((total, row) => total + row.sum.reward, 0);
    return { rows, claimed, lost, returned, reward, rate: lost > 0 ? (returned / lost) * 100 : 0 };
  }, [desk.incidents, desk.cases, desk.states]);

  const mine = useMemo(() => {
    const listed = (holdings ?? []).filter((item) => item.allocation !== null);
    const lower = address?.toLowerCase();
    let returned = 0;
    let reward = 0;
    for (const row of activity.rows) {
      if (row.kind !== "returned") continue;
      if (row.from.toLowerCase() === lower) returned += usdOf(row.received, row.info.token);
      if (row.rewardTo.toLowerCase() === lower) reward += usdOf(row.reward, row.info.token);
    }
    return {
      received: listed.reduce((total, item) => total + usdOf(item.claimed, item.info.token), 0),
      ready: listed.reduce((total, item) => total + usdOf(item.claimable, item.info.token), 0),
      returned,
      reward,
      cases: new Set(listed.map((item) => item.info.incidentId)).size,
    };
  }, [holdings, activity.rows, address]);

  const returns = activity.rows.filter((row) => row.kind === "returned").length;
  const claims = activity.rows.filter((row) => row.kind === "claimed").length;
  const loading = <span className="skeleton" />;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Stats</h1>
          <p>Every number is read from the contracts. Dollar values use made-up prices, on test tokens.</p>
        </div>
      </header>

      <h2 className="stats-heading">All of Pactum</h2>
      <dl className="stat-grid">
        <div className="stat"><dt>Total lost</dt><dd>{desk.loaded ? <CountUp value={all.lost} format={usd} /> : loading}</dd></div>
        <div className="stat"><dt>Returned</dt><dd>{desk.loaded ? <CountUp value={all.returned} format={usd} /> : loading}</dd></div>
        <div className="stat"><dt>Recovery rate</dt><dd>{desk.loaded ? `${all.rate.toFixed(1)}%` : loading}</dd></div>
        <div className="stat"><dt>Claimed by users</dt><dd>{desk.loaded ? <CountUp value={all.claimed} format={usd} /> : loading}</dd></div>
      </dl>
      <p className="fine-print profile-note">{desk.incidents.length} cases, {returns} {returns === 1 ? "return" : "returns"}, {claims} {claims === 1 ? "claim" : "claims"}, {usd(all.reward)} paid as rewards.</p>

      <section className="card stats-cases">
        <div className="card-head"><h2>Recovery by case</h2></div>
        <RecoveryLegend />
        <ul className="stats-list">
          {all.rows.map(({ incident, sum, status }) => (
            <li key={incident.id}>
              <a href={`#/case/${incident.id}`}>
                <span className="stats-name">{incident.name}</span>
                <StatusBadge status={status} />
                <RecoveryBar total={sum.lost} reward={sum.reward} refund={sum.refund} label={`${incident.name}: ${usd(sum.reward)} reward paid, ${usd(sum.refund)} in the refund pool, ${usd(sum.lost)} lost`} />
                <span className="mono small stats-percent">{sum.lost > 0 ? Math.round((sum.returned / sum.lost) * 100) : 0}%</span>
                <span className="mono small stats-lost">{usd(sum.returned)} of {usd(sum.lost)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="stats-heading">Your numbers</h2>
      {address ? (
        <>
          <dl className="stat-grid">
            <div className="stat"><dt>Refunds received</dt><dd>{holdings ? <CountUp value={mine.received} format={usd} /> : loading}</dd></div>
            <div className="stat"><dt>Ready to claim</dt><dd>{holdings ? <CountUp value={mine.ready} format={usd} /> : loading}</dd></div>
            <div className="stat"><dt>Funds you returned</dt><dd><CountUp value={mine.returned} format={usd} /></dd></div>
            <div className="stat"><dt>Reward earned</dt><dd><CountUp value={mine.reward} format={usd} /></dd></div>
          </dl>
          <p className="fine-print profile-note">On the refund list of {mine.cases} {mine.cases === 1 ? "case" : "cases"}. {earnedBadges().length} of {BADGES.length} badges.{mine.ready > 0 && <> <a href="#/profile">Claim now</a></>}</p>
        </>
      ) : (
        <button type="button" className="button button-primary" onClick={connect} disabled={personas.length === 0 && !("ethereum" in window)}>Connect wallet</button>
      )}
    </div>
  );
}

export function StakePage() {
  const [data, setData] = useState<{ config: RegistryConfig; operators: { operator: RegistryOperator; listed: boolean }[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [config, operators] = await Promise.all([
        nearView<RegistryConfig>(registryInfo.registry, "get_config", {}),
        nearView<RegistryOperator[]>(registryInfo.registry, "list_operators", { from: 0, limit: 20 }),
      ]);
      if (!config || !operators) throw new Error("empty");
      const rows = await Promise.all(operators.map(async (operator) => ({ operator, listed: (await nearView<boolean>(registryInfo.registry, "is_listed", { controller: operator.controller })) ?? false })));
      if (!cancelled) setData({ config, operators: rows });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const staked = data?.operators.reduce((sum, { operator }) => sum + BigInt(operator.withdrawn ? "0" : operator.stake), 0n) ?? 0n;

  return (
    <div className="page">
    <header className="page-head">
      <div>
        <h1>Stake</h1>
        <p>Whoever runs a Pactum desk locks NEAR as a bond. If they cheat, the council can slash it, and slashed NEAR stays locked for good. You do not need to stake anything to get a refund.</p>
      </div>
      <a className="tag" href={nearAccountUrl(registryInfo.registry)} target="_blank" rel="noreferrer">Live on NEAR testnet</a>
    </header>
    <section className="card staking-card">

      {failed && <p className="field-error" role="alert">Could not read the registry on NEAR testnet.</p>}
      {!data && !failed && <p className="muted small"><span className="spinner" /> Reading the registry…</p>}
      {data && (
        <>
          <dl className="stat-grid staking-stats">
            <div className="stat"><dt>Total staked</dt><dd className="stat-small">{nearAmount(staked)}</dd></div>
            <div className="stat"><dt>Slashed for good</dt><dd className="stat-small">{nearAmount(data.config.total_slashed)}</dd></div>
            <div className="stat"><dt>Minimum to be listed</dt><dd className="stat-small">{nearAmount(data.config.min_stake)}</dd></div>
            <div className="stat"><dt>Council</dt><dd className="stat-small">{data.config.council_threshold} of {data.config.council.length}</dd></div>
          </dl>
          <ul className="operator-list">
            {data.operators.map(({ operator, listed }) => (
              <li key={operator.controller}>
                <div className="operator-name">
                  <a href={nearAccountUrl(operator.controller)} target="_blank" rel="noreferrer">{operator.controller}</a>
                  <span className="muted small">Staked by {nearName(operator.owner)}</span>
                </div>
                <span className="mono">{nearAmount(operator.stake)}</span>
                <span className="muted small">{nearAmount(operator.total_slashed)} slashed</span>
                <span className={listed ? "side-badge is-live" : "side-badge"}>{operator.banned ? "Banned" : listed ? "Listed" : "Not listed"}</span>
              </li>
            ))}
          </ul>
          <details className="proposal-record">
            <summary>Stake as an operator</summary>
            <p className="muted small">Staking needs a NEAR account that is a guardian of the controller you register. Run this with your own key:</p>
            <pre>{`near contract call-function as-transaction ${registryInfo.registry} register json-args '{"controller":"<your-controller>.testnet","website":"https://your-protocol.example"}' prepaid-gas '300.0 Tgas' attached-deposit '${nearAmount(BigInt(data.config.min_stake) + OPERATOR_STORAGE)}' sign-as <your-account>.testnet network-config testnet sign-with-keychain send`}</pre>
          </details>
          <p className="fine-print">These operators and the council are test accounts.</p>
        </>
      )}
    </section>
    </div>
  );
}
