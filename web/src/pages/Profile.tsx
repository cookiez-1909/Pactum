// The user's page: the wallet's numbers, the operators' stakes, and where they want to receive funds through NEAR Intents.
import { useEffect, useMemo, useState } from "react";
import { isAddress, parseUnits, type Address } from "viem";
import { useApp, useToast } from "../appdata";
import { deskAbi, publicClientOf, txUrl, walletFor } from "../chain";
import { Mascot } from "../components/Mascot";
import { RoleTag } from "../components/Party";
import { celebrate, earn } from "../fun";
import { decimalString, shortAddress, tokens as tokenText } from "../format";
import { chainName, dryQuote, isEvmChain, loadIntentsTokens, savedPayout, savePayout, type IntentsToken, type PayoutChoice, type Quote } from "../intents";
import { identify, type Role } from "../labels";
import { acceptsFunds } from "../useDesk";
import { useWallet } from "../wallet";
import { errorText } from "./CasePage";
import { useHoldings, type Holding } from "./others";

export function Profile() {
  const { directory, desk } = useApp();
  const { address, connect, personas, readOnly } = useWallet();
  const holdings = useHoldings(address);
  const ready = (holdings ?? []).filter((item) => item.allocation !== null && item.claimable > 0n);
  // Only cases still accepting funds can pay more. A fully returned or closed case has nothing left to wait for.
  const upcoming = (holdings ?? []).filter((item) => item.allocation !== null && acceptsFunds(item.info, desk.states[item.info.id]) && item.claimed + item.claimable < item.allocation);
  const me = address ? identify(directory, address) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Profile</h1>
          {me && address ? (
            <p className="wallet-identity"><span className="party-name">{me.name}</span> <RoleTag role={me.role as Role} /> <code>{shortAddress(address)}</code></p>
          ) : (
            <p>Connect a wallet to claim refunds and choose where your money goes.</p>
          )}
        </div>
      </header>

      {address ? (
        <PayoutCard key={address} owner={address} readOnly={readOnly} ready={ready} upcoming={upcoming} />
      ) : (
        <button type="button" className="button button-primary" onClick={connect} disabled={personas.length === 0 && !("ethereum" in window)}>Connect wallet</button>
      )}
    </div>
  );
}

// Popular choices, shown only when NEAR Intents really lists the asset.
const QUICK_PICKS = [
  { symbol: "USDC", blockchain: "base" },
  { symbol: "ETH", blockchain: "eth" },
  { symbol: "BTC", blockchain: "btc" },
  { symbol: "SOL", blockchain: "sol" },
  { symbol: "wNEAR", blockchain: "near" },
];

const SAMPLE_USDC = "1000";
const SHOWN_AT_ONCE = 5;

// A sample quote needs an input asset different from the target, so use USDC on the first chain that is not the target.
function sampleOrigin(list: IntentsToken[], target: IntentsToken): IntentsToken | null {
  for (const blockchain of ["arb", "base", "eth"]) {
    const match = list.find((item) => item.symbol === "USDC" && item.blockchain === blockchain);
    if (match && match.assetId !== target.assetId) return match;
  }
  return null;
}

function PayoutCard({ owner, readOnly, ready, upcoming }: { owner: Address; readOnly: boolean; ready: Holding[]; upcoming: Holding[] }) {
  const toast = useToast();
  const { deployment, desk } = useApp();
  const { persona } = useWallet();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimFailure, setClaimFailure] = useState<string | null>(null);
  const [list, setList] = useState<IntentsToken[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saved, setSaved] = useState<PayoutChoice | null>(() => savedPayout(owner));
  const [assetId, setAssetId] = useState(saved?.assetId ?? "");
  const [recipient, setRecipient] = useState(saved?.recipient ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sample, setSample] = useState<{ quote: Quote; symbol: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadIntentsTokens()
      .then((tokens) => {
        if (!cancelled) setList(tokens);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = list?.find((item) => item.assetId === assetId) ?? null;
  const chains = useMemo(() => [...new Set((list ?? []).map((item) => item.blockchain))].sort((a, b) => chainName(a).localeCompare(chainName(b))), [list]);
  const assets = useMemo(() => (list ?? []).filter((item) => item.blockchain === selected?.blockchain).sort((a, b) => a.symbol.localeCompare(b.symbol)), [list, selected?.blockchain]);
  const quickPicks = QUICK_PICKS.map((pick) => list?.find((item) => item.symbol === pick.symbol && item.blockchain === pick.blockchain)).filter((item): item is IntentsToken => !!item);

  const pick = (token: IntentsToken) => {
    setAssetId(token.assetId);
    setFailure(null);
    setSample(null);
    setRecipient(saved?.assetId === token.assetId ? saved.recipient : isEvmChain(token.blockchain) ? owner : "");
  };

  const keepOriginal = () => {
    setAssetId("");
    setRecipient("");
    setFailure(null);
    setSample(null);
    setSaved(null);
    savePayout(owner, null);
  };

  // Claims right here, without opening each case. The money arrives in that case's token.
  const claim = async ({ info, claimable }: Holding) => {
    const entry = info.allocations.find((item) => item.account.toLowerCase() === owner.toLowerCase());
    if (!entry) return;
    setClaiming(info.id);
    setClaimFailure(null);
    try {
      const { client: wallet, account } = await walletFor(deployment, persona);
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: deployment.contracts.Pactum, abi: deskAbi, functionName: "claimRefund", args: [info.terms.caseId, entry.account, BigInt(entry.allocation), entry.proof] });
      const receipt = await publicClientOf(deployment).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      toast({ kind: "ok", title: "Refund received", detail: `${tokenText(claimable, info.token.decimals)} ${info.token.symbol} is now in this wallet.`, href: txUrl(deployment, hash) });
      celebrate();
      const badge = earn("claimer");
      if (badge) toast({ kind: "ok", title: `Badge unlocked: ${badge.name}`, detail: badge.how });
      await desk.refresh();
    } catch (reason) {
      setClaimFailure(errorText(reason, "The claim failed"));
    } finally {
      setClaiming(null);
    }
  };

  const destination = recipient.trim();
  const evmAddressWrong = !!selected && isEvmChain(selected.blockchain) && destination.length > 0 && !isAddress(destination);
  const isSaved = !!saved && saved.assetId === assetId && saved.recipient === destination;
  const label = selected ? `${selected.symbol} on ${chainName(selected.blockchain)}` : "The same token";

  const save = async () => {
    if (!selected || !list || !destination || evmAddressWrong) return;
    const origin = sampleOrigin(list, selected);
    if (!origin) return;
    setBusy(true);
    setFailure(null);
    setSample(null);
    try {
      // Asks NEAR Intents before saving, so an address that this route would reject is never saved.
      const quote = await dryQuote({ originAsset: origin.assetId, destinationAsset: selected.assetId, amount: parseUnits(SAMPLE_USDC, origin.decimals).toString(), refundTo: owner, recipient: destination });
      const choice = { assetId: selected.assetId, symbol: selected.symbol, blockchain: selected.blockchain, recipient: destination };
      savePayout(owner, choice);
      setSaved(choice);
      setSample({ quote, symbol: selected.symbol });
      toast({ kind: "ok", title: "Choice saved", detail: `Future refunds will be quoted as ${label}.` });
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "No quote is available for this route.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card intent-card">
      <div className="intent-head">
        <Mascot action="travel" size={120} />
        <div>
          <span className="tag intent-tag">Powered by NEAR Intents</span>
          <h2>Where do you want your returned money to go?</h2>
          <p className="muted">Pick any asset on any chain NEAR Intents supports. No bridge to find, and no swap to set up each time.</p>
        </div>
      </div>

      <div className="intent-flow" aria-hidden="true">
        <span className="intent-node">Any token that comes back</span>
        <span className="intent-link" />
        <span className="intent-node is-intent">NEAR Intents</span>
        <span className="intent-link" />
        <span className="intent-node is-end">{label}</span>
      </div>

      {unavailable && <p className="field-error" role="alert">NEAR Intents could not be reached, so the list of assets is not available right now.</p>}
      {!list && !unavailable && <p className="muted small"><span className="spinner" /> Loading the assets NEAR Intents supports…</p>}

      {list && (
        <>
          <div className="picker-row intent-picks" role="group" aria-label="Receive as">
            <button type="button" className={!assetId ? "pill is-active" : "pill"} aria-pressed={!assetId} onClick={keepOriginal}>Keep the same token</button>
            {quickPicks.map((token) => (
              <button key={token.assetId} type="button" className={assetId === token.assetId ? "pill is-active" : "pill"} aria-pressed={assetId === token.assetId} onClick={() => pick(token)}>
                {token.symbol} on {chainName(token.blockchain)}
              </button>
            ))}
          </div>

          <div className="intent-selects">
            <label className="field">
              <span>Chain ({chains.length} available)</span>
              <select
                className="intent-chain"
                value={selected?.blockchain ?? ""}
                onChange={(event) => {
                  const inChain = list.filter((item) => item.blockchain === event.target.value);
                  const first = inChain.find((item) => item.symbol === "USDC") ?? inChain[0];
                  if (first) pick(first);
                }}
              >
                {!selected && <option value="">Choose a chain</option>}
                {chains.map((id) => <option key={id} value={id}>{chainName(id)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Asset</span>
              <select
                className="intent-asset"
                value={assetId}
                disabled={!selected}
                onChange={(event) => {
                  const token = list.find((item) => item.assetId === event.target.value);
                  if (token) pick(token);
                }}
              >
                {!selected && <option value="">Choose a chain first</option>}
                {assets.map((token) => <option key={token.assetId} value={token.assetId}>{token.symbol}</option>)}
              </select>
            </label>
          </div>

          {selected && (
            <>
              <label className="field">
                <span>Your wallet on {chainName(selected.blockchain)}</span>
                <input className="intent-recipient" value={recipient} spellCheck={false} placeholder={`Your ${chainName(selected.blockchain)} address`} onChange={(event) => { setRecipient(event.target.value); setFailure(null); }} />
              </label>
              {evmAddressWrong && <p className="field-error" role="alert">That is not a valid address for this chain.</p>}
              <button type="button" className="button button-primary intent-save" disabled={busy || readOnly || !destination || evmAddressWrong || isSaved} onClick={save}>
                {busy ? <><span className="spinner" /> Checking with NEAR Intents…</> : isSaved ? "Saved" : "Save my choice"}
              </button>
              {readOnly && <p className="field-hint">This is a view of a wallet you typed in, so it cannot save a choice.</p>}
            </>
          )}

          {failure && <p className="field-error" role="alert">NEAR Intents returned: {failure}</p>}
          {sample && (
            <div className="quote-result" role="status">
              <p className="quote-amount">A {SAMPLE_USDC} USDC refund today would arrive as about <strong>{decimalString(sample.quote.amountOut)} {sample.symbol}</strong></p>
              <p className="muted small">Worth about ${Number(sample.quote.usdOut).toLocaleString("en-US", { maximumFractionDigits: 2 })}, in about {Math.max(1, Math.round(sample.quote.seconds / 60))} min. Live quote at mainnet prices.</p>
            </div>
          )}
        </>
      )}

      <h3 className="intent-upcoming">Available refunds</h3>
      {ready.length === 0 ? (
        <p className="muted small">Nothing to claim right now.</p>
      ) : (
        <ul className="available-list">
          {ready.map((item) => (
            <li key={item.info.id}>
              <a href={`#/case/${item.info.incidentId}/refund/${item.info.token.symbol}`}>{item.info.incident}</a>
              <span className="mono small">{tokenText(item.claimable, item.info.token.decimals, 2)} {item.info.token.symbol}</span>
              <button type="button" className="button button-primary available-claim" disabled={readOnly || claiming !== null} onClick={() => claim(item)}>
                {claiming === item.info.id ? <><span className="spinner" /> Claiming…</> : "Claim"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {claimFailure && <p className="field-error" role="alert">{claimFailure}</p>}

      <h3 className="intent-upcoming">Your upcoming refunds</h3>
      {upcoming.length === 0 ? (
        <p className="muted small">No refunds are on the way for this wallet. Your choice will apply to any case you join later.</p>
      ) : (
        <ul className="intent-list">
          {(showAll ? upcoming : upcoming.slice(0, SHOWN_AT_ONCE)).map(({ info, allocation, claimed, claimable }) => (
            <li key={info.id}>
              <a href={`#/case/${info.incidentId}/refund/${info.token.symbol}`}>
                <span className="intent-case">{info.incident}</span>
                <span className="mono small">up to {tokenText(allocation! - claimed - claimable, info.token.decimals, 2)} {info.token.symbol}</span>
                <span className="intent-target">{selected ? `as ${label}` : `stays ${info.token.symbol}`}</span>
                <span className="side-badge">Waiting</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {!showAll && upcoming.length > SHOWN_AT_ONCE && <button type="button" className="show-more" onClick={() => setShowAll(true)}>Show more ({upcoming.length - SHOWN_AT_ONCE} left)</button>}

      <p className="fine-print"><strong>Nothing is swapped in this demo.</strong> NEAR Intents has no testnet and refund tokens here are mock, so your choice sets the live quote you see when a refund is ready. It is saved in this browser only. Saving sends this destination address to the NEAR Intents service to check the route.</p>
    </section>
  );
}
