// A replay of a real hack where the hacker returned the funds. The "happened" column only states what public sources report.
export const REPLAY_ID = "gmx-replay";

export const REPLAY = {
  title: "Replay of the real GMX hack, July 2025",
  intro: "The dates and figures under What happened come from public reports. The case on this page runs on a local test chain with test tokens. GMX did not use Pactum and has no link to this project.",
  rows: [
    {
      step: "The offer",
      happened: "An on-chain text message: keep 10%, and no legal action if the funds came back within 48 hours. Nothing enforced it.",
      pactum: "The same terms, signed and stored on chain: 10% for 48 hours. The contract pays it, so neither side has to trust the other.",
    },
    {
      step: "Returning the funds",
      happened: "Sent back in several batches from July 11, about $40.5M in total, to an address the team controlled.",
      pactum: "One transaction. Use Return funds on this page, as the Hacker wallet, to run it.",
    },
    {
      step: "The reward",
      happened: "GMX reported paying a $5M bounty.",
      pactum: "$4.2M, exactly 10% of $42M, paid in that same transaction.",
    },
    {
      step: "Where the money sat",
      happened: "Held by the GMX DAO until holders agreed on a plan.",
      pactum: "$37.8M booked for users inside the contract, where the team cannot move it.",
    },
    {
      step: "Paying users",
      happened: "On July 16 the form and timing of repayment were still undecided. About $44M became claimable in mid-August, about five weeks after the hack, including $2M from the treasury.",
      pactum: "The refund list is fixed before the funds arrive, so each user can claim as soon as the return lands.",
    },
  ],
  limits: "What this replay leaves out: the real loss was a mix of assets in a liquidity pool, and here it is one test token and three test wallets. A real refund list would need a snapshot of GLP holders before the offer. Pactum pays only from what comes back, so it would not have added the $2M GMX paid from its treasury, and it cannot make a hacker return funds sooner. Reports put the loss between about $40M and $42M. This replay uses $42M.",
  sources: [
    { label: "GMX: funds recovered", url: "https://gmxio.substack.com/p/glp-funds-on-arbitrum-fully-recovered" },
    { label: "The Block: funds returning", url: "https://www.theblock.co/post/362164/gmx-token-surges-14-after-hacker-begins-returning-funds-from-40-million-exploit" },
    { label: "The Block: $44M plan", url: "https://www.theblock.co/post/366890/gmx-44-million-compensation-plan" },
  ],
};
