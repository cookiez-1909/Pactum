// Real incidents from public sources. Read only; no Pactum case exists for any of them.
// Never add figures here on your own: every number needs a source in `sources`.
// The `fit` column is this project's opinion, not a fact from the sources.

export const REPORTED_SNAPSHOT = "2026-11-06";

export interface ReportedIncident {
  name: string;
  date: string;
  loss: string;
  assets: string;
  outcome: string;
  attribution: string;
  fit: "Close match" | "Unlikely";
  fitReason: string;
  sources: { label: string; url: string }[];
}

export const REPORTED_INCIDENTS: ReportedIncident[] = [
  {
    name: "Binance",
    date: "Oct 29, 2026",
    loss: "$6.3B to $6.43B",
    assets: "USDT, USDC, ETH, 18,270 BTC, XRP and more, across 11 chains",
    outcome: "About $2.85B frozen or seized, mostly stablecoins. Binance says it will cover losses from its own funds. No return by the attacker reported.",
    attribution: "North Korea's TraderTraitor, according to the FBI. North Korea denies it.",
    fit: "Unlikely",
    fitReason: "A state-linked group is unlikely to return funds, and paying it a reward raises sanctions problems.",
    sources: [
      { label: "Elliptic", url: "https://www.elliptic.co/insights/binance-largest-hack-in-history/" },
      { label: "Chainalysis", url: "https://www.chainalysis.com/blog/binance-exploit-latest-findings-and-response/" },
      { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/2026_Binance_hack" },
    ],
  },
  {
    name: "Bitget",
    date: "Sep 2026",
    loss: "$352M to about $387M",
    assets: "Exchange hot wallets",
    outcome: "Bitget says its $464M protection fund covers the loss, and it offered 5% bounties for freezing and for recovery.",
    attribution: "North Korea's Lazarus Group, according to investigators cited in reports.",
    fit: "Unlikely",
    fitReason: "Same problem: the reported holder is a state-linked group, even with a bounty on offer.",
    sources: [
      { label: "Halborn", url: "https://www.halborn.com/blog/post/explained-the-bitget-hack-september-2026" },
      { label: "CoinDesk", url: "https://www.coindesk.com/markets/2026/09/24/crypto-exchange-bitget-loses-usd352-million-in-hack-claims-user-funds-are-safe" },
      { label: "Fortune", url: "https://fortune.com/2026/09/25/north-korea-bitget-387-million-crypto-attack/" },
    ],
  },
  {
    name: "Euler Finance",
    date: "Mar 13, 2023",
    loss: "About $197M",
    assets: "DeFi lending assets",
    outcome: "All recoverable funds were returned after negotiating with the exploiter.",
    attribution: "Unnamed exploiter.",
    fit: "Close match",
    fitReason: "An individual holder negotiating a return is the case Pactum is built for, with the deal enforced by a contract.",
    sources: [{ label: "CoinDesk", url: "https://www.coindesk.com/business/2023/04/03/euler-says-all-recoverable-funds-stolen-in-200m-hack-have-been-returned" }],
  },
  {
    name: "Poly Network",
    date: "Aug 2021",
    loss: "About $610M",
    assets: "Assets across several chains",
    outcome: "The hacker returned the funds. Reports differ on whether the offered $500,000 bounty was accepted.",
    attribution: "Unnamed hacker.",
    fit: "Close match",
    fitReason: "A published reward paid in the same transaction would have removed the doubt over the bounty.",
    sources: [{ label: "Blockworks", url: "https://blockworks.co/news/poly-network-hacker-returns-600-million-offered-500000-bug-bounty" }],
  },
];
