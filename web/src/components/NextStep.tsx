// Two blocks that help newcomers: the case's progress, and the one thing to do next with the selected wallet.
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useApp } from "../appdata";
import { deskAbi, erc20Abi, publicClientOf, type CaseInfo } from "../chain";
import { tokens } from "../format";
import { acceptsFunds, currentOffer, incidentTotals, type Incident } from "../useDesk";
import { useWallet } from "../wallet";
import { Mascot } from "./Mascot";

export function RecoveryQuest({ incident }: { incident: Incident }) {
  const { desk } = useApp();
  const sum = incidentTotals(incident, desk.states);
  const claimed = incident.cases.some((info) => (desk.states[info.id]?.totalClaimed ?? 0n) > 0n);
  const percent = sum.lost > 0 ? Math.min(100, Math.round((sum.returned / sum.lost) * 100)) : 0;
  const steps = [
    { label: "Hacked", done: true },
    { label: "Offer live", done: incident.cases.length > 0 },
    { label: "Funds coming back", done: sum.returned > 0 },
    { label: "Users paid", done: claimed },
  ];
  const reached = steps.filter((step) => step.done).length;
  return (
    <section className="quest" aria-label="Recovery progress">
      <div className="quest-top">
        <span className="quest-title">Recovery progress</span>
        <span className="quest-percent">{percent}% returned</span>
      </div>
      <div className="quest-meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the lost funds returned"><div style={{ width: `${percent}%` }} /></div>
      <ol className="quest-steps">
        {steps.map((step, index) => (
          <li key={step.label} className={step.done ? (index === reached - 1 ? "is-done is-current" : "is-done") : ""}>
            <span className="quest-dot">{step.done ? "✓" : index + 1}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Position {
  holds: { info: CaseInfo; balance: bigint }[];
  owed: { info: CaseInfo; amount: bigint }[];
  listed: boolean;
  claimedAny: boolean;
}

export function NextStep({ incident }: { incident: Incident }) {
  const { deployment, desk } = useApp();
  const { address, connect } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [position, setPosition] = useState<Position | null>(null);
  const version = incident.cases.map((info) => `${desk.states[info.id]?.totalReturned}:${desk.states[info.id]?.totalClaimed}`).join();

  useEffect(() => {
    if (!address) return setPosition(null);
    let cancelled = false;
    const wallet = address as Address;
    Promise.all(
      incident.cases.map(async (info) => {
        const entry = info.allocations.find((item) => item.account.toLowerCase() === wallet.toLowerCase());
        const [balance, amount, claimed] = await Promise.all([
          client.readContract({ address: info.token.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
          entry ? client.readContract({ address: deployment.contracts.Pactum, abi: deskAbi, functionName: "claimable", args: [info.terms.caseId, wallet, BigInt(entry.allocation)] }) : Promise.resolve(0n),
          entry ? client.readContract({ address: deployment.contracts.Pactum, abi: deskAbi, functionName: "claimed", args: [info.terms.caseId, wallet] }) : Promise.resolve(0n),
        ]);
        return { info, balance, amount, claimed, listed: !!entry };
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        const pendingListed = incident.pending.some((asset) => asset.allocations.some((item) => item.account.toLowerCase() === wallet.toLowerCase()));
        setPosition({
          holds: rows.filter((row) => row.balance > 0n).map(({ info, balance }) => ({ info, balance })),
          owed: rows.filter((row) => row.amount > 0n).map(({ info, amount }) => ({ info, amount })),
          listed: pendingListed || rows.some((row) => row.listed),
          claimedAny: rows.some((row) => row.claimed > 0n),
        });
      })
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [address, client, deployment.contracts.Pactum, incident, version]);

  const offer = currentOffer(incident, desk.states);
  // A fully returned or closed case gets no more money, so the user must not be told to wait.
  const moreCanCome = incident.pending.length > 0 || incident.cases.some((info) => acceptsFunds(info, desk.states[info.id]));
  const base = `#/case/${incident.id}`;
  let art = <Mascot action="idle" size={88} />;
  let title = "Nothing you need to do here";
  let body = "This wallet holds none of these tokens and is not on the refund list. You can still follow what happens.";
  let cta: { label: string; href?: string; onClick?: () => void } | null = null;

  if (!address) {
    art = <Mascot action="wave" size={88} />;
    title = "Connect a wallet to see what you can do";
    body = "Everything on this page is public, so you can read without one.";
    cta = { label: "Connect wallet", onClick: connect };
  } else if (position?.owed[0]) {
    const { info, amount } = position.owed[0];
    art = <Mascot action="cheer" size={88} />;
    title = "You have money waiting";
    body = `${tokens(amount, info.token.decimals)} ${info.token.symbol} is ready for you to claim.`;
    cta = { label: "Claim my refund", href: `${base}/refund/${info.token.symbol}` };
  } else if (offer && position?.holds[0]) {
    const { info, balance } = position.holds[0];
    art = <Mascot action="sneak" size={88} />;
    title = "This wallet holds tokens this case is asking for";
    body = `If these ${tokens(balance, info.token.decimals)} ${info.token.symbol} came from this hack, you can return them and keep ${offer.rewardBps / 100}%. If they are your own money, do not send them.`;
    cta = { label: "Review the return", href: `${base}/return/${info.token.symbol}` };
  } else if (position?.listed && !moreCanCome) {
    art = <Mascot action={position.claimedAny ? "cheer" : "sad"} size={88} />;
    title = position.claimedAny ? "All done. You have been paid" : "Nothing more is coming";
    body = position.claimedAny ? "You claimed your share of everything that came back. There is nothing left to do here." : "This case has ended, and no funds came back for your share.";
    if (position.claimedAny) cta = { label: "See my wallet", href: "#/wallet" };
  } else if (position?.listed) {
    art = <Mascot action="wait" size={88} />;
    title = "You are on the refund list";
    body = "Nothing is waiting for you right now. When funds come back, your share shows up here.";
  } else if (incident.cases.length === 0) {
    art = <Mascot action="write" size={88} />;
    title = "Waiting for an offer";
    body = "Nothing can be returned or claimed until the team is verified and an offer is published.";
    cta = { label: "See the offer page", href: `${base}/offer` };
  }

  return (
    <section className="next-step">
      <span className="next-art">{art}</span>
      <div className="next-text">
        <p className="next-kicker">What to do next</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {cta && (cta.href ? <a className="button button-primary next-cta" href={cta.href}>{cta.label}</a> : <button type="button" className="button button-primary next-cta" onClick={cta.onClick}>{cta.label}</button>)}
    </section>
  );
}
