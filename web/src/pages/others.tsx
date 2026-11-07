// The remaining app pages: Hack tracker, Activity, My wallet and How it works.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appdata";
import { erc20Abi, deskAbi, publicClientOf, txUrl, type CaseInfo } from "../chain";
import { AssetIcon } from "../components/case-bits";
import { Chevron, ExternalLink } from "../components/icons";
import { Party, RoleTag } from "../components/Party";
import { REPORTED_INCIDENTS, REPORTED_SNAPSHOT } from "../data/reported";
import { shortAddress, timeAgo, tokens } from "../format";
import { identify, type Role } from "../labels";
import { acceptsFunds, rankIncidents } from "../useDesk";
import { useWallet } from "../wallet";

export function Tracker() {
  const [expanded, setExpanded] = useState<string | null>(REPORTED_INCIDENTS[0]?.name ?? null);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Hack tracker</h1>
          <p>Real hacks, for context. <strong>None of these organizations uses Pactum</strong>, and no case exists for them.</p>
        </div>
        <span className="tag tag-real">Updated {REPORTED_SNAPSHOT}</span>
      </header>
      <p className="fine-print">Figures are as reported by the linked sources and may change. &ldquo;Would it fit?&rdquo; is this project&rsquo;s own opinion.</p>

      <ul className="tracker">
        {REPORTED_INCIDENTS.map((item, index) => {
          const open = expanded === item.name;
          return (
            <li key={item.name} className={open ? "tracker-item is-open" : "tracker-item"} style={{ animationDelay: `${index * 50}ms` }}>
              <button type="button" className="tracker-head" aria-expanded={open} onClick={() => setExpanded(open ? null : item.name)}>
                <span className="tracker-name">{item.name}</span>
                <span className="tracker-date">{item.date}</span>
                <span className="tracker-loss mono">{item.loss}</span>
                <span className={item.fit === "Close match" ? "fit fit-good" : "fit"}>{item.fit}</span>
                <Chevron className="chevron" />
              </button>
              <div className="tracker-body">
                <div>
                  <dl className="facts">
                    <div><dt>Assets</dt><dd>{item.assets}</dd></div>
                    <div><dt>Outcome</dt><dd>{item.outcome}</dd></div>
                    <div><dt>Attributed to</dt><dd>{item.attribution}</dd></div>
                    <div><dt>Would it fit?</dt><dd><strong>{item.fit}.</strong> {item.fitReason}</dd></div>
                    <div>
                      <dt>Sources</dt>
                      <dd className="sources">
                        {item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink /></a>)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ActivityFilter = "all" | "returned" | "claimed" | "opened";

export function ActivityPage() {
  const { deployment, desk, activity } = useApp();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const rows = activity.rows.filter((row) => filter === "all" || row.kind === filter);
  const filters: { id: ActivityFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "returned", label: "Returns" },
    { id: "claimed", label: "Refund claims" },
    { id: "opened", label: "Cases opened" },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Read directly from the events of the contract.</p>
        </div>
      </header>
      <div className="toolbar">
        <div className="pills" role="group" aria-label="Filter activity">
          {filters.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "pill is-active" : "pill"} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
      </div>
      {activity.failed && <p className="notice">Could not read contract events from this RPC node.</p>}
      {!activity.failed && rows.length === 0 && <p className="empty">Nothing here yet.</p>}
      <ol className="feed">
        {rows.map((row, index) => {
          const { token, incidentId, incident } = row.info;
          const fmt = (value: bigint) => tokens(value, token.decimals);
          const href = txUrl(deployment, row.hash);
          return (
            <li key={row.key} className={`feed-row feed-${row.kind}`} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
              <AssetIcon symbol={token.symbol} size="sm" />
              <div className="feed-body">
                <p className="feed-text">
                  {row.kind === "opened" && <>Case opened for <a href={`#/case/${incidentId}`}>{incident}</a> <span className="mono">{token.symbol}</span></>}
                  {row.kind === "returned" && <><Party address={row.from} compact /> returned <strong className="mono">{fmt(row.received)} {token.symbol}</strong> to <a href={`#/case/${incidentId}`}>{incident}</a></>}
                  {row.kind === "claimed" && <><Party address={row.account} compact /> claimed <strong className="mono">{fmt(row.amount)} {token.symbol}</strong> from <a href={`#/case/${incidentId}`}>{incident}</a></>}
                </p>
                {row.kind === "returned" && <p className="feed-sub">{fmt(row.reward)} paid as reward, {fmt(row.refund)} booked for users</p>}
              </div>
              <div className="feed-meta">
                <span>{timeAgo(row.time, desk.now)}</span>
                {href ? <a href={href} target="_blank" rel="noreferrer"><code>{shortAddress(row.hash)}</code></a> : <code>{shortAddress(row.hash)}</code>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface Holding {
  info: CaseInfo;
  balance: bigint;
  allocation: bigint | null;
  claimable: bigint;
  claimed: bigint;
}

export function MyWallet() {
  const { deployment, desk, directory } = useApp();
  const { address, connect, personas } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const version = Object.values(desk.states).reduce((sum, state) => sum + state.totalReturned + state.totalClaimed, 0n).toString();

  useEffect(() => {
    if (!address) {
      setHoldings(null);
      return;
    }
    let cancelled = false;
    Promise.all(
      desk.cases.map(async (info): Promise<Holding> => {
        const entry = info.allocations.find((item) => item.account.toLowerCase() === address.toLowerCase());
        const allocation = entry ? BigInt(entry.allocation) : null;
        const [balance, claimable, claimed] = await Promise.all([
          client.readContract({ address: info.token.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          entry ? client.readContract({ address: deployment.contracts.Pactum, abi: deskAbi, functionName: "claimable", args: [info.terms.caseId, address, allocation!] }) : 0n,
          entry ? client.readContract({ address: deployment.contracts.Pactum, abi: deskAbi, functionName: "claimed", args: [info.terms.caseId, address] }) : 0n,
        ]);
        return { info, balance, allocation, claimable, claimed };
      }),
    )
      .then((rows) => {
        if (!cancelled) setHoldings(rows);
      })
      .catch(() => {
        if (!cancelled) setHoldings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address, client, deployment, desk.cases, version]);

  if (!address) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>My wallet</h1><p>Connect a wallet to see your refunds across every case.</p></div></header>
        <button type="button" className="button button-primary" onClick={connect} disabled={personas.length === 0 && !("ethereum" in window)}>Connect wallet</button>
      </div>
    );
  }

  const me = identify(directory, address);
  const ranked = rankIncidents(desk.incidents, desk.states);
  const order = new Map(ranked.map((incident, index) => [incident.id, index]));
  const sorted = [...(holdings ?? [])].sort((a, b) => order.get(a.info.incidentId)! - order.get(b.info.incidentId)!);
  const claims = sorted.filter((item) => item.allocation !== null);
  const returnable = sorted.filter((item) => item.balance > 0n && acceptsFunds(item.info, desk.states[item.info.id]));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My wallet</h1>
          <p className="wallet-identity"><span className="party-name">{me.name}</span> <RoleTag role={me.role as Role} /> <code>{shortAddress(address)}</code></p>
          <p className="muted">{me.detail}</p>
        </div>
      </header>

      {holdings === null && <div className="skeleton skeleton-block" />}

      {holdings !== null && (
        <>
          <section className="card">
            <h2>Your refunds</h2>
            {claims.length === 0 && <p className="muted">This wallet is not on the refund list of any case.</p>}
            <ul className="wallet-list">
              {claims.map(({ info, allocation, claimable, claimed }) => {
                const fmt = (value: bigint) => tokens(value, info.token.decimals);
                return (
                  <li key={info.id}>
                    <a href={`#/case/${info.incidentId}/refund/${info.token.symbol}`} className="wallet-row">
                      <AssetIcon symbol={info.token.symbol} size="sm" />
                      <span className="wallet-row-name">{info.incident} <span className="ticker">{info.token.symbol}</span></span>
                      <span className="muted small">Lost {fmt(allocation!)} {info.token.symbol}, claimed {fmt(claimed)}</span>
                      <span className={claimable > 0n ? "wallet-claim has-funds" : "wallet-claim"}>{claimable > 0n ? `${fmt(claimable)} ${info.token.symbol} to claim` : "Nothing to claim"}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <h2>Funds you could return</h2>
            {returnable.length === 0 && <p className="muted">This wallet holds none of the tokens that an open case is waiting for.</p>}
            <ul className="wallet-list">
              {returnable.map(({ info, balance }) => {
                const state = desk.states[info.id];
                return (
                  <li key={info.id}>
                    <a href={`#/case/${info.incidentId}/return/${info.token.symbol}`} className="wallet-row">
                      <AssetIcon symbol={info.token.symbol} size="sm" />
                      <span className="wallet-row-name">{info.incident} <span className="ticker">{info.token.symbol}</span></span>
                      <span className="muted small">Holds {tokens(balance, info.token.decimals)} {info.token.symbol}</span>
                      <span className="wallet-claim has-reward">{state ? `${state.rewardBps / 100}% reward now` : ""}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

const PERMISSIONS: { who: string; role: Role; can: string; cannot: string }[] = [
  { who: "Whoever holds the funds", role: "hacker", can: "Return them, choose where the reward goes, and return in parts.", cannot: "Get more than the published reward, or return after the last deadline." },
  { who: "A user who lost funds", role: "user", can: "Claim their share with a proof, again whenever more funds come back.", cannot: "Add themselves to the list or raise their amount after the case opens." },
  { who: "Anyone else", role: "unknown", can: "Relay a signature, or send a claim on someone's behalf. The tokens go only to the listed wallet.", cannot: "Spend anyone's tokens, or receive someone else's refund." },
  { who: "Guardians", role: "guardian", can: "Check who is asking, read an offer on NEAR and approve it once for every chain it covers. Vote to cancel an offer before it opens, replace a guardian, or add a chain.", cannot: "Change a case once it is open, sign anything but approved terms or a revocation, go above the reward limit, or replace a chain already served." },
  { who: "The team behind the protocol", role: "protocol", can: "Show the guardians off chain that it runs the protocol, then write the offer: how much the holder keeps, the deadlines and any special conditions. Guardians must approve it.", cannot: "Lower or change a case once it is open, or withdraw anything. No such function exists. The team does write the refund list, so that list is what to check." },
];

export function HowItWorks() {
  return (
    <div className="page page-narrow">
      <header className="page-head"><div><h1>How it works</h1><p>Who can do what, what the contract enforces, and what you still have to trust.</p></div></header>

      <section className="card">
        <h2>Who can do what</h2>
        <div className="table-wrap">
          <table className="data-table permissions">
            <thead><tr><th scope="col">Who</th><th scope="col">Can</th><th scope="col">Cannot</th></tr></thead>
            <tbody>
              {PERMISSIONS.map((row) => (
                <tr key={row.who}>
                  <td><span className="party-name">{row.who}</span><br /><RoleTag role={row.role} /></td>
                  <td>{row.can}</td>
                  <td>{row.cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Does a hacker have to prove who they are?</h2>
        <p>No. Stolen funds usually move through many wallets and mixers, so any proof would fail anyway. The contract only asks one thing: did this token arrive? A wallet with no link to the hack can return the funds, and the reward can go to any other wallet.</p>
        <p>Nobody can use this to take money from the case, because the caller gives up their own tokens and at most the published reward comes back.</p>
        <p><strong>The real limit is the chain.</strong> A case accepts one token on one chain. The same guardians can open a case on any chain where Pactum runs, which here means Sepolia, Base Sepolia and Robinhood testnet. Funds that went anywhere else must come back first.</p>
      </section>

      <section className="card">
        <h2>The split</h2>
        <p className="formula"><code>reward = min(rewardBps × received ÷ 10000, rewardCap − rewardPaidSoFar)</code></p>
        <p className="formula"><code>refund = received − reward</code></p>
        <p className="formula"><code>claimable = allocation × totalRefund ÷ totalLoss − alreadyClaimed</code></p>
        <p>Amounts are in the token&rsquo;s smallest unit, so assets with different decimals work the same way. The reward cap is a token amount, so no price oracle is needed.</p>
      </section>

      <section className="card">
        <h2>What you still have to trust</h2>
        <ul className="plain-list">
          <li>The refund list must be correct, and the team writes it. A dishonest team could add its own wallets. A wrong list can misallocate that case&rsquo;s refunds, though it cannot pay more than the case&rsquo;s pool or reach another case&rsquo;s tokens. It is fixed and public before funds arrive, so it can be checked, and the file must stay available.</li>
          <li>Guardians must really check who is asking. The contract cannot tell, and who chooses the guardians in real use is not decided yet.</li>
          <li>An offer can be fake. Anyone can deploy their own copy of Pactum, so check that the protocol itself published the contract address, and that its operator has NEAR at stake.</li>
          <li>The council must slash fairly. It decides challenges against staked operators, and on testnet it is three test accounts.</li>
          <li>The Chain Signatures MPC network must behave correctly.</li>
          <li>Guardians must not approve a case for a hack their own team staged. A reward cap and public evidence reduce this risk, but do not remove it.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Limits of this prototype</h2>
        <ul className="plain-list">
          <li>Testnet only, with mock tokens. Not audited.</li>
          <li>No immunity from prosecution, and no sanctions screening.</li>
          <li>Only ERC-20 tokens on the three chains where the contract runs. Native BTC or ADA would need a wrapped version there, and native ETH would need wrapping first.</li>
          <li>The contract keeps one case per token, so a hack across several tokens takes one transaction per token, for opening, returning and claiming.</li>
          <li>Special conditions in an offer are fixed by a hash, but the contract does not enforce them. It only enforces the reward, deadlines and refunds.</li>
          <li>Tokens sent to the contract without using Return funds stay locked, because no withdrawal exists.</li>
        </ul>
      </section>
    </div>
  );
}
