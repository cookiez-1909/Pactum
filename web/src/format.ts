// Shows token amounts with each asset's own decimals.
import { formatUnits } from "viem";

export function tokens(value: bigint, decimals: number, maxFraction = 4): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const kept = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}

// A decimal string from an API: adds thousands separators without converting to Number, so no precision is lost.
export function decimalString(value: string, maxFraction = 8): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return value;
  const [whole = "0", fraction = ""] = value.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const kept = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}

export function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

export function usd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function countdown(until: bigint, nowMs: number): string {
  const left = Number(until) - Math.floor(nowMs / 1000);
  if (left <= 0) return "ended";
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

// A short label for the sidebar, such as "3d left" or "19m left".
export function timeLeft(until: bigint, nowMs: number): string {
  const left = Number(until) - Math.floor(nowMs / 1000);
  if (left <= 0) return "ended";
  if (left >= 86400) return `${Math.floor(left / 86400)}d left`;
  if (left >= 3600) return `${Math.floor(left / 3600)}h left`;
  return `${Math.max(1, Math.floor(left / 60))}m left`;
}

export function timeAgo(seconds: number, nowMs: number): string {
  const delta = Math.max(0, Math.floor(nowMs / 1000) - seconds);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
