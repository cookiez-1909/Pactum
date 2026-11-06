// Pieces of an incident's interface: asset icons, the asset list, the status and the progress bar.
import { tokens, usd } from "../format";
import type { IncidentStatus } from "../useDesk";

// Generic currency symbols, no one's logo.
const ASSET_GLYPH: Record<string, string> = { BTC: "₿", ETH: "Ξ", ADA: "₳", USDC: "$", USD: "$", USDT: "₮", HYPE: "H", SOL: "S", LINK: "L" };

export function AssetIcon({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const name = symbol.replace(/^m/, "");
  return <span className={`asset-icon asset-${name.toLowerCase()} asset-${size}`} aria-hidden="true">{ASSET_GLYPH[name] ?? name.slice(0, 1)}</span>;
}

export interface LostAsset {
  symbol: string;
  decimals: number;
  amount: bigint;
  value: number;
}

const VISIBLE_ASSETS = 3;

// Shows the first few assets. If there are more, the ! mark opens the full list on hover or keyboard focus.
export function AssetSummary({ assets }: { assets: LostAsset[] }) {
  const sorted = [...assets].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, VISIBLE_ASSETS);
  const hidden = sorted.length - shown.length;
  return (
    <span className="asset-summary">
      <span className="asset-summary-list">
        {shown.map((asset) => (
          <span key={asset.symbol} className="asset-chip">
            <AssetIcon symbol={asset.symbol} size="sm" />
            <span className="mono">{tokens(asset.amount, asset.decimals, 2)} {asset.symbol}</span>
          </span>
        ))}
      </span>
      {hidden > 0 && (
        <span className="more-assets" tabIndex={0} aria-label={`All ${assets.length} assets lost: ${sorted.map((asset) => `${tokens(asset.amount, asset.decimals, 2)} ${asset.symbol}`).join(", ")}`}>
          <span className="more-count">+{hidden}</span>
          <span className="more-mark" aria-hidden="true">!</span>
          <span className="asset-tooltip" role="tooltip">
            <span className="asset-tooltip-head">All {assets.length} assets lost</span>
            {sorted.map((asset) => (
              <span key={asset.symbol} className="asset-tooltip-row">
                <AssetIcon symbol={asset.symbol} size="sm" />
                <span className="mono">{tokens(asset.amount, asset.decimals, 2)} {asset.symbol}</span>
                <span className="asset-tooltip-value">{usd(asset.value)}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

const STATUS_ICON: Record<IncidentStatus, string> = {
  Open: "●",
  "Partly returned": "◐",
  "Fully returned": "✓",
  Closed: "■",
  "Awaiting offer": "…",
};

export function StatusBadge({ status }: { status: IncidentStatus | null }) {
  if (!status) return <span className="badge badge-loading">Loading</span>;
  return (
    <span className={`badge badge-${status.toLowerCase().replace(" ", "-")}`}>
      <span aria-hidden="true" className="badge-mark">{STATUS_ICON[status]}</span> {status}
    </span>
  );
}

// A bar showing where the lost money went: reward, refunds for users, or not returned.
// Takes amounts already converted to one scale, so it works for one asset or a whole incident.
export function RecoveryBar({ total, reward, refund, label, tall = false }: { total: number; reward: number; refund: number; label: string; tall?: boolean }) {
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  return (
    <div className={tall ? "recovery-bar is-tall" : "recovery-bar"} role="img" aria-label={label} title={label}>
      {reward > 0 && <div className="bar-reward" style={{ width: `${share(reward)}%` }} />}
      {refund > 0 && <div className="bar-refund" style={{ width: `${share(refund)}%` }} />}
      {/* When fully returned, the remainder is not drawn, to avoid a stray sliver at the end of the bar. */}
      {total - reward - refund > total * 0.001 && <div className="bar-rest" />}
    </div>
  );
}

export function RecoveryLegend() {
  return (
    <ul className="legend" aria-label="Chart legend">
      <li><span className="swatch bar-reward" /> Reward paid</li>
      <li><span className="swatch bar-refund" /> Refund pool</li>
      <li><span className="swatch bar-rest" /> Not returned</li>
    </ul>
  );
}
