// A victim sees whether their refund can be swapped into the asset and chain they want through NEAR Intents.
// This is a real quote in dry mode: no deposit address is created and no money moves.
// No real swap runs, because NEAR Intents has no testnet and the demo tokens are fake.
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import type { TokenInfo } from "../chain";
import { decimalString } from "../format";
import { chainName, dryQuote, isEvmChain, loadIntentsTokens, savedPayout, type IntentsToken, type Quote } from "../intents";

// The real asset behind each fake token, and the preferred EVM chains. Refunds live on an EVM chain,
// so the swap's input must be an ERC-20 token on an EVM chain.
const REAL_ASSET: Record<string, string[]> = {
  mBTC: ["cbBTC", "WBTC"],
  mETH: ["WETH", "ETH"],
  mUSDC: ["USDC"],
  mUSD: ["USDC"],
  mUSDT: ["USDT"],
  mLINK: ["LINK"],
  mHYPE: ["HYPE"],
  mADA: ["ADA"],
  mSOL: ["SOL"],
};
const EVM_CHAINS = ["base", "arb", "eth", "op", "pol", "bsc", "avax"];
interface Destination {
  id: string;
  symbol: string;
  chain: string;
  placeholder: string;
  assetId?: string;
}

const DESTINATIONS: Destination[] = [
  { id: "btc", symbol: "BTC", chain: "btc", placeholder: "bc1…" },
  { id: "eth", symbol: "ETH", chain: "eth", placeholder: "0x…" },
  { id: "usdc-base", symbol: "USDC", chain: "base", placeholder: "0x…" },
  { id: "sol", symbol: "SOL", chain: "sol", placeholder: "Solana address" },
  { id: "near", symbol: "wNEAR", chain: "near", placeholder: "you.near" },
];

function findOrigin(tokens: IntentsToken[], symbol: string): IntentsToken | null {
  for (const name of REAL_ASSET[symbol] ?? []) {
    for (const chain of EVM_CHAINS) {
      const match = tokens.find((item) => item.symbol === name && item.blockchain === chain);
      if (match) return match;
    }
  }
  return null;
}

export function ConvertRefund({ token, amount, owner }: { token: TokenInfo; amount: bigint; owner: Address }) {
  const [tokens, setTokens] = useState<IntentsToken[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // If the user picked where to receive funds on the Profile page, open with that choice.
  const saved = useMemo(() => savedPayout(owner), [owner]);
  const savedOption: Destination | null = saved ? { id: "saved", symbol: saved.symbol, chain: saved.blockchain, placeholder: "", assetId: saved.assetId } : null;
  const options = savedOption ? [savedOption, ...DESTINATIONS.filter((item) => item.symbol !== savedOption.symbol || item.chain !== savedOption.chain)] : DESTINATIONS;
  const [destinationId, setDestinationId] = useState(saved ? "saved" : "btc");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadIntentsTokens()
      .then((list) => {
        if (!cancelled) setTokens(list);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = useMemo(() => (tokens ? findOrigin(tokens, token.symbol) : null), [tokens, token.symbol]);
  const destination = options.find((item) => item.id === destinationId)!;
  const target = tokens?.find((item) => (destination.assetId ? item.assetId === destination.assetId : item.symbol === destination.symbol && item.blockchain === destination.chain));
  const isEvmTarget = isEvmChain(destination.chain);

  useEffect(() => {
    setQuote(null);
    setFailure(null);
    setRecipient(destinationId === "saved" && saved ? saved.recipient : isEvmTarget ? owner : "");
  }, [destinationId, isEvmTarget, owner, amount, saved]);

  if (unavailable) return null;
  if (!tokens) return null;
  if (!origin) {
    return (
      <section className="card card-quiet">
        <h2>Receive it in another asset</h2>
        <p>NEAR Intents lists no ERC-20 route for the real version of {token.symbol}, so this refund stays in {token.symbol}.</p>
      </section>
    );
  }

  const getQuote = async () => {
    if (!target || recipient.trim().length === 0 || amount === 0n) return;
    setBusy(true);
    setQuote(null);
    setFailure(null);
    try {
      // Fake and real tokens can have different decimals, so convert using the real amount.
      const realAmount = parseUnits(formatUnits(amount, token.decimals), origin.decimals);
      setQuote(await dryQuote({ originAsset: origin.assetId, destinationAsset: target.assetId, amount: realAmount.toString(), refundTo: owner, recipient: recipient.trim() }));
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "No quote is available for this route.");
    } finally {
      setBusy(false);
    }
  };

  const chainLabel = chainName(origin.blockchain);

  return (
    <section className="card convert">
      <div className="card-head">
        <h2>Receive it in another asset</h2>
        <span className="tag">NEAR Intents</span>
      </div>
      <p className="muted small">Your refund arrives as {token.symbol}. With NEAR Intents you could then swap it for an asset on another chain, without a bridge. This shows a live quote for the real {origin.symbol} on {chainLabel}.</p>

      <div className="picker-row convert-targets" role="group" aria-label="Receive as">
        {options.map((item) => (
          <button key={item.id} type="button" className={destinationId === item.id ? "pill is-active" : "pill"} aria-pressed={destinationId === item.id} onClick={() => setDestinationId(item.id)}>
            {item.symbol} on {chainName(item.chain)}{item.id === "saved" ? " (your choice)" : ""}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Your wallet on {chainName(destination.chain)}</span>
        <input value={recipient} spellCheck={false} placeholder={destination.placeholder} onChange={(event) => setRecipient(event.target.value)} />
      </label>

      <button type="button" className="button convert-button" disabled={busy || recipient.trim().length === 0 || amount === 0n || !target} onClick={getQuote}>
        {busy ? <><span className="spinner" /> Getting a live quote…</> : amount === 0n ? "Nothing available to convert yet" : "Get a live quote"}
      </button>
      <p className="fine-print">Getting a quote sends the amount and this destination address to the NEAR Intents service. <a href="#/profile">{saved ? "Change your default" : "Set a default for future refunds"}</a></p>

      {failure && <p className="field-error" role="alert">NEAR Intents returned: {failure}</p>}
      {quote && (
        <div className="quote-result" role="status">
          <p className="quote-amount">About <strong>{decimalString(quote.amountOut)} {destination.symbol}</strong></p>
          <p className="muted small">Worth about ${Number(quote.usdOut).toLocaleString("en-US", { maximumFractionDigits: 2 })}, in about {Math.max(1, Math.round(quote.seconds / 60))} {Math.round(quote.seconds / 60) > 1 ? "minutes" : "minute"}.</p>
          <p className="fine-print"><strong>Nothing was swapped.</strong> This is a real quote at mainnet prices. NEAR Intents has no testnet and {token.symbol} is a mock token, so the swap itself is not available in this demo.</p>
        </div>
      )}
    </section>
  );
}
