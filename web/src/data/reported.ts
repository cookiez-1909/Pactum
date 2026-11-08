// Real incidents from public sources. Read only; no Pactum case exists for any of them.
// Never add figures here on your own: every number needs a source in `sources`.
// The `fit` column is this project's opinion, not a fact from the sources.

export const REPORTED_SNAPSHOT = "2026-11-08";

export interface ReportedIncident {
  name: string;
  date: string;
  loss: string;
  assets: string;
  outcome: string;
  attribution: string;
  fit: "Close match" | "Possible" | "Unlikely";
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
    name: "Renegade",
    date: "May 2026",
    loss: "About $190,000",
    assets: "Funds in its Arbitrum dark pool",
    outcome: "Renegade offered a 10% whitehat bounty in an on-chain message for returning 90%, and the hacker complied.",
    attribution: "Unnamed whitehat.",
    fit: "Close match",
    fitReason: "This is the exact deal Pactum automates, at a size where a small team cannot run a long negotiation.",
    sources: [{ label: "Blockchain.news", url: "https://blockchain.news/news/whitehat-returns-190k-renegade-exploit" }],
  },
  {
    name: "Drift Protocol",
    date: "Apr 1, 2026",
    loss: "$280M to $286M",
    assets: "Perpetuals exchange funds on Solana",
    outcome: "The attacker took over the Security Council's admin powers. Funds moved to Ethereum within hours. Reports we read describe tracing efforts and no recovery.",
    attribution: "Suspected North Korea, according to Elliptic and Drift. Not confirmed.",
    fit: "Unlikely",
    fitReason: "A suspected state-linked group is unlikely to return funds, and paying it raises sanctions problems.",
    sources: [
      { label: "Elliptic", url: "https://www.elliptic.co/insights/drift-protocol-exploited-for-286-million-in-suspected-dprk-linked-attack/" },
      { label: "BleepingComputer", url: "https://www.bleepingcomputer.com/news/security/drift-loses-280-million-north-korean-hackers-seize-security-council-powers" },
    ],
  },
  {
    name: "Balancer",
    date: "Nov 3, 2025",
    loss: "About $128M",
    assets: "V2 Composable Stable Pools, across eight chains",
    outcome: "A rounding bug was exploited. About $28M was recovered in total, mostly by whitehats and partner teams, and affected users were to be repaid pro rata. No return by the attacker reported.",
    attribution: "Unnamed attacker.",
    fit: "Possible",
    fitReason: "The pro-rata repayment is what Pactum does. Whether an anonymous attacker would have used it is unknown.",
    sources: [
      { label: "The Block", url: "https://www.theblock.co/post/380751/balancer-recovered-funds-distribution" },
      { label: "DappRadar", url: "https://dappradar.com/blog/balancer-exploit-november-2025" },
    ],
  },
  {
    name: "GMX",
    date: "Jul 2025",
    loss: "About $42M",
    assets: "GMX V1 pools on Arbitrum",
    outcome: "GMX offered 10% in an on-chain message and promised no legal action within 48 hours. The exploiter returned about $40.5M and kept about $5M.",
    attribution: "Unnamed exploiter.",
    fit: "Close match",
    fitReason: "A 10% on-chain offer, accepted by an anonymous holder. Pactum would have made that split one transaction.",
    sources: [
      { label: "The Block", url: "https://www.theblock.co/post/362164/gmx-token-surges-14-after-hacker-begins-returning-funds-from-40-million-exploit" },
      { label: "Halborn", url: "https://www.halborn.com/blog/post/explained-the-gmx-hack-july-2025" },
    ],
  },
  {
    name: "Cetus Protocol",
    date: "May 22, 2025",
    loss: "About $223M",
    assets: "Liquidity pools on Sui",
    outcome: "Validators froze about $162M, and a governance vote moved it toward repaying users. Cetus offered to let the attacker keep $6M, and reported no response.",
    attribution: "Unnamed attacker.",
    fit: "Possible",
    fitReason: "The team made this kind of offer and the attacker ignored it. A binding contract may or may not have changed that.",
    sources: [
      { label: "The Defiant", url: "https://thedefiant.io/news/hacks/cetus-protocol-hit-223-million-hack-162-million-frozen-5-million-bounty-vote-on-c13985eb" },
      { label: "The Block", url: "https://www.theblock.co/post/356347/sui-community-passes-governance-vote-to-recover-stolen-cetus-funds-blocked-by-validators-in-223m-heist" },
    ],
  },
  {
    name: "Loopscale",
    date: "Apr 26, 2025",
    loss: "About $5.8M",
    assets: "About 5.7M USDC and 1,200 SOL",
    outcome: "Loopscale offered a 10% bounty and legal immunity. It later said all funds were returned and users lost nothing.",
    attribution: "Unnamed exploiter.",
    fit: "Close match",
    fitReason: "A mid-sized protocol and a holder willing to deal, which is the case Pactum is built for.",
    sources: [
      { label: "The Block", url: "https://www.theblock.co/post/352100" },
      { label: "Halborn", url: "https://www.halborn.com/blog/post/explained-the-loopscale-hack-april-2025" },
    ],
  },
  {
    name: "ZKsync",
    date: "Apr 15, 2025",
    loss: "About $5M",
    assets: "About 111M ZK tokens minted from airdrop reserves",
    outcome: "A leaked admin key was used. The Security Council offered 10% for returning 90% within 72 hours, and the hacker returned the funds on April 23.",
    attribution: "Unnamed hacker.",
    fit: "Close match",
    fitReason: "A public offer with a deadline, which is exactly what a Pactum case publishes.",
    sources: [
      { label: "The Block", url: "https://www.theblock.co/news/regulation/2025-04-24-zksync-reclaims-5-million-worth-of-hacked-tokens-following-10-bounty-offer-351823" },
      { label: "Cointelegraph", url: "https://cointelegraph.com/news/zk-sync-recovers-5-million-stolen-tokens-hacker-accepts-bounty" },
    ],
  },
  {
    name: "KiloEx",
    date: "Apr 2025",
    loss: "$7.5M to $8.4M",
    assets: "Perpetuals vaults across several chains",
    outcome: "A price oracle was manipulated. KiloEx offered 10% and to drop the case, and the attacker returned everything within days.",
    attribution: "Unnamed attacker.",
    fit: "Close match",
    fitReason: "A short, successful negotiation that a published offer could have replaced.",
    sources: [
      { label: "Halborn", url: "https://www.halborn.com/blog/post/explained-the-kiloex-hack-april-2025" },
      { label: "SlowMist", url: "https://slowmist.medium.com/slowmist-assists-kiloex-in-recovering-all-stolen-funds-incident-recap-273d10f6d466" },
    ],
  },
  {
    name: "Bybit",
    date: "Feb 2025",
    loss: "$1.4B to $1.5B",
    assets: "Mostly ETH, from an exchange cold wallet",
    outcome: "Bybit offered a 10% bounty for recovery help and said customers were covered. Most of the funds were laundered within six months.",
    attribution: "North Korea's TraderTraitor, according to the FBI.",
    fit: "Unlikely",
    fitReason: "A state-linked group did not return funds, and paying it raises sanctions problems.",
    sources: [
      { label: "Decrypt", url: "https://decrypt.co/307990/fbi-links-north-korea-to-1-4-billion-bybit-crypto-heist" },
      { label: "The Defiant", url: "https://thedefiant.io/news/hacks/north-korean-hackers-have-laundered-over-usd1-billion-stolen-from-bybit-in-under-six-months" },
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
    fitReason: "An individual holder negotiating a return is the case Pactum is built for, without the negotiation.",
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
