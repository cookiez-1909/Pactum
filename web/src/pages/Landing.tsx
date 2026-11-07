// The landing page. Figures here are real measurements from tests and testnet, or clearly marked as examples.
import proof from "../../../deployments/sepolia.json";
import baseProof from "../../../deployments/base-sepolia.json";
import robinhoodProof from "../../../deployments/robinhood-testnet.json";
import { useEffect } from "react";
import { Arrow, Clock, ExternalLink, Lock, Shield, Split } from "../components/icons";
import { CountUp, Reveal } from "../components/motion";
import { Faq } from "./Faq";

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

const FEARS = [
  { who: "The hacker", fear: "Returns the money and gets nothing, or gets identified while making contact." },
  { who: "The protocol", fear: "Pays the reward first and never sees the funds come back." },
  { who: "The users", fear: "The money reaches the team's wallet and never gets shared out fairly." },
];

const STEPS = [
  { title: "The protocol makes an offer", body: "The team registers with the guardians off chain and shows it controls the protocol. It then sets how much the holder keeps, the deadlines and any special conditions. Guardians on NEAR must approve it, and the contract hashes exactly what they approved." },
  { title: "Chain Signatures signs the terms", body: "The MPC network signs that hash and nothing else. Anyone can carry the signature to the EVM chain to open the case." },
  { title: "Funds return, and split at once", body: "One transaction pays the published reward to an address the holder chooses, and books the rest for users." },
  { title: "Users claim their share", body: "Each user proves their allocation with a Merkle proof. If more funds come back later, they can claim again." },
];

const GUARANTEES = [
  { icon: Split, title: "One transaction", body: "The reward and the refund booking happen together, so neither side has to go first." },
  { icon: Lock, title: "No team withdrawal", body: "No owner, no upgrade, no withdraw function. Tokens leave only as a reward or a refund." },
  { icon: Shield, title: "Terms cannot change", body: "Once a case opens, no function can lower the reward or edit the terms." },
  { icon: Clock, title: "A real deadline", body: "The reward falls over time. After the last deadline the case stops accepting funds." },
];

const COMPARISON = [
  { label: "Who moves the money", manual: "The two sides, by hand", seal: "The whitehat, to the protocol's address", desk: "The contract, in one transaction" },
  { label: "Can terms change", manual: "Any time", seal: "The owner can update them", desk: "No, fixed when the case opens" },
  { label: "User refunds", manual: "Up to the team", seal: "Up to the protocol", desk: "Claimed directly with a proof" },
  { label: "Who it covers", manual: "Whoever negotiates", seal: "Eligible whitehats", desk: "Anyone holding the funds" },
  { label: "Legal protection", manual: "Negotiated case by case", seal: "Yes, a legal agreement", desk: "None, payment only" },
];

const LIMITS = [
  { title: "The team writes the refund list", body: "A dishonest team could add its own wallets. The list is fixed and public before any money arrives, so guardians and users can check it, but the contract cannot tell who really lost funds." },
  { title: "An offer can be fake", body: "Anyone can deploy their own copy of Pactum and call it official. A staked operator has money to lose, but the stake on testnet is small. Check that the protocol itself published the contract address." },
  { title: "A team could hack itself", body: "It could drain its own protocol and collect the reward. A reward cap, several guardians and public evidence reduce this but do not remove it. This is the biggest weakness." },
  { title: "No immunity", body: "The contract commits to a payment and nothing more. Prosecution is still possible." },
  { title: "Sanctions are unsolved", body: "Paying a sanctioned party can be illegal. Real use needs legal advice and screening, and this prototype has neither." },
  { title: "State-linked groups are unlikely to use it", body: "It fits an independent hacker at a small or mid-sized protocol. It is unlikely to have helped in the largest recent exchange hacks." },
];

// The main animation: money comes in on one side and splits into the reward and the users' refunds.
function SplitFlow() {
  return (
    <figure className="flow" aria-label="Example: a return of 1,000,000 tokens at a 10% reward. 100,000 goes to the reward address and 900,000 to the refund pool, in one transaction.">
      <svg viewBox="0 0 640 340" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="flow-in" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="300" y2="0">
            <stop offset="0" stopColor="#8fa2ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#8fa2ff" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <path className="ribbon ribbon-in" d="M 40 170 H 300" stroke="url(#flow-in)" strokeWidth="110" />
        <path className="ribbon ribbon-reward" d="M 300 121 C 370 121 370 66 450 66 H 610" stroke="var(--reward)" strokeWidth="11" />
        <path className="ribbon ribbon-refund" d="M 300 175 C 370 175 370 236 450 236 H 610" stroke="var(--refund)" strokeWidth="99" />

        <path className="stream" d="M 40 170 H 300" strokeWidth="110" />
        <path className="stream stream-out" d="M 300 121 C 370 121 370 66 450 66 H 610" strokeWidth="11" />
        <path className="stream stream-out" d="M 300 175 C 370 175 370 236 450 236 H 610" strokeWidth="99" />

        <rect className="flow-gate" x="292" y="108" width="16" height="124" rx="5" />

        <text x="52" y="162" className="flow-amount">1,000,000</text>
        <text x="52" y="184" className="flow-caption flow-caption-on">returned</text>
        <text x="600" y="50" textAnchor="end" className="flow-amount">100,000</text>
        <text x="600" y="24" textAnchor="end" className="flow-caption">Reward, 10%</text>
        <text x="600" y="240" textAnchor="end" className="flow-amount">900,000</text>
        <text x="600" y="262" textAnchor="end" className="flow-caption flow-caption-on">Refund pool</text>
      </svg>
      <figcaption>One transaction. Example amounts at a 10% reward.</figcaption>
    </figure>
  );
}

function RewardDecay() {
  const tiers = [
    { label: "15%", until: "first 24 hours", grow: 1, height: 100 },
    { label: "10%", until: "until 72 hours", grow: 2, height: 67 },
    { label: "5%", until: "until 7 days", grow: 4, height: 33 },
  ];
  return (
    <figure className="decay">
      <div className="decay-bars" role="img" aria-label="Example schedule: 15% for the first 24 hours, 10% until 72 hours, 5% until 7 days, then the case closes.">
        {tiers.map((tier, index) => (
          <div key={tier.label} className="decay-col" style={{ flexGrow: tier.grow }}>
            <span className="decay-value">{tier.label}</span>
            <div className="decay-bar" style={{ height: `${tier.height}%`, animationDelay: `${index * 140}ms` }} />
          </div>
        ))}
        <div className="decay-col decay-end"><span className="decay-value">Closed</span></div>
      </div>
      <div className="decay-axis">
        {tiers.map((tier) => <span key={tier.label} style={{ flexGrow: tier.grow }}>{tier.until}</span>)}
        <span className="decay-axis-end" />
      </div>
      <figcaption>An example schedule. Each case publishes its own.</figcaption>
    </figure>
  );
}

export function Landing({ anchor }: { anchor?: string }) {
  const year = 2026;
  // Coming from inside the app through #/faq jumps straight to that section instead of scrolling the whole page.
  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "instant" });
  }, [anchor]);
  return (
    <div className="landing">
      <div className="landing-note" role="note">Testnet demo. Do not send real or stolen funds.</div>
      <header className="landing-header">
        <a className="brand" href="#/" aria-label="Pactum home"><span className="brand-name">Pactum</span></a>
        <nav className="landing-nav" aria-label="Page sections">
          <button type="button" onClick={() => scrollTo("how")}>How it works</button>
          <button type="button" onClick={() => scrollTo("guarantees")}>Guarantees</button>
          <button type="button" onClick={() => scrollTo("limits")}>Limits</button>
          <a href="#/tracker">Hack tracker</a>
          <button type="button" onClick={() => scrollTo("faq")}>FAQ</button>
        </nav>
        <a className="button button-primary" href="#/cases">Open app <Arrow /></a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Testnet prototype, built at NEAR HACKATHON</p>
          <h1>Get stolen funds back without a negotiation.</h1>
          <p className="hero-lead">
            After a hack, a protocol publishes its reward terms. Whoever holds the funds returns them and collects the reward in a single transaction. The rest goes to a public refund list fixed before the money arrives, not to the team&rsquo;s wallet.
          </p>
          <div className="hero-actions">
            <a className="button button-primary button-lg" href="#/cases">Try a simulated case <Arrow /></a>
            <button type="button" className="button button-ghost button-lg" onClick={() => scrollTo("how")}>See how it works</button>
          </div>
        </div>
        <SplitFlow />
      </section>

      <section className="band">
        <Reveal>
          <p className="eyebrow">The problem</p>
          <h2>After a hack, nobody wants to go first.</h2>
          <p className="section-lead">Hackers do sometimes return funds, usually after a tense exchange of on-chain messages. It breaks down at the same three points.</p>
        </Reveal>
        <div className="grid-3">
          {FEARS.map((item, index) => (
            <Reveal key={item.who} delay={index * 90}>
              <article className="card card-fear">
                <h3>{item.who}</h3>
                <p>{item.fear}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="band" id="how">
        <Reveal>
          <p className="eyebrow">How it works</p>
          <h2>From hack to refund in four steps.</h2>
        </Reveal>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 90}>
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section className="band" id="guarantees">
        <div className="split-section">
          <Reveal>
            <p className="eyebrow">What the contract enforces</p>
            <h2>The rules live in code, so nobody has to promise anything.</h2>
            <div className="guarantees">
              {GUARANTEES.map(({ icon: IconComponent, title, body }) => (
                <div key={title} className="guarantee">
                  <span className="guarantee-icon"><IconComponent /></span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="card">
              <h3>The sooner it comes back, the bigger the reward</h3>
              <RewardDecay />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="band">
        <Reveal>
          <p className="eyebrow">Why NEAR</p>
          <h2>One set of rules for every chain, checked before anything is signed.</h2>
          <p className="section-lead">
            The address that opens cases is derived from a NEAR contract through Chain Signatures. Nobody on the team holds its key, and the contract account has none left at all. It can only sign the exact terms its guardians approved, and they read the full offer on NEAR before approving.
          </p>
          <p className="section-lead">
            Stolen funds move between chains, so one offer can cover them all. Guardians approve once on NEAR and the contract gets a signature for each chain, with the same signing address on every one. If the funds move to a new chain, guardians vote it in. This has run on Sepolia, Base Sepolia and Robinhood testnet, and a signature made for one chain is rejected on the others.
          </p>
          <p className="section-lead">
            Anyone can deploy a copy of Pactum, so the official list is the set of operators with NEAR at stake, as in Hyperliquid&rsquo;s HIP-3. Anyone can challenge an operator with evidence, a council decides, and slashed NEAR stays locked for good, so a slash pays nobody.
          </p>
          <p className="section-lead">
            NEAR Intents adds the last step for users: a refund can be swapped for another asset on another chain, without a bridge. The app shows live quotes for this. No swap runs here, because NEAR Intents has no testnet.
          </p>
          <p className="section-lead muted">
            A multisig on each chain could do something similar, but each would be a separate copy of the rules, and it would sign whatever enough signers approve. It usually needs a round of signatures per chain too, though Safe modules such as Safe Unified Account are starting to offer one signature across chains. Here the contract rejects terms that break the rules, even if enough guardians approve them. Guardians still hold their own NEAR keys, and someone must still relay each signature to its chain. This covers EVM chains only. It cannot open a case on Bitcoin, because the split needs a smart contract on the same chain as the funds.
          </p>
        </Reveal>
      </section>

      <section className="band">
        <Reveal>
          <p className="eyebrow">How it compares</p>
          <h2>It adds execution to what exists today.</h2>
          <p className="section-lead">SEAL Safe Harbor is the closest framework, and it has a legal agreement that Pactum does not. Safe Harbor states the terms. Pactum executes the split and the refunds.</p>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr><th scope="col"><span className="sr-only">Question</span></th><th scope="col">Manual negotiation</th><th scope="col">SEAL Safe Harbor</th><th scope="col" className="compare-us">Pactum</th></tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.manual}</td>
                    <td>{row.seal}</td>
                    <td className="compare-us">{row.desk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      <section className="band">
        <Reveal>
          <p className="eyebrow">Check it yourself</p>
          <h2>Measured, not claimed.</h2>
          <p className="section-lead">The full flow has run on Sepolia, Base Sepolia and Robinhood testnet, signed by one contract on NEAR testnet. <code>make verify</code> re-checks it from public data, with no wallet.</p>
        </Reveal>
        <div className="metrics">
          <Reveal delay={0}><div className="metric"><span className="metric-value"><CountUp value={93} format={(v) => Math.round(v).toString()} /></span><span>on-chain checks in <code>make verify</code></span></div></Reveal>
          <Reveal delay={80}><div className="metric"><span className="metric-value"><CountUp value={53} format={(v) => `${Math.round(v)}/53`} /></span><span>bugs injected into the contract and caught by its tests</span></div></Reveal>
          <Reveal delay={160}><div className="metric"><span className="metric-value"><CountUp value={100} format={(v) => `${Math.round(v)}%`} /></span><span>of lines and branches in the contract covered</span></div></Reveal>
          <Reveal delay={240}><div className="metric"><span className="metric-value">9.1s</span><span>for the MPC network to sign for three chains, from one approval on testnet</span></div></Reveal>
        </div>
        <Reveal>
          <ul className="proof-links">
            <li><a href={`https://sepolia.etherscan.io/tx/${proof.txs.returnFunds}`} target="_blank" rel="noreferrer">The one transaction that split the funds <ExternalLink /></a></li>
            <li><a href={`https://sepolia.etherscan.io/address/${proof.contracts.Pactum}`} target="_blank" rel="noreferrer">Pactum on Sepolia <ExternalLink /></a></li>
            <li><a href={`https://sepolia.basescan.org/address/${baseProof.contracts.Pactum}`} target="_blank" rel="noreferrer">Pactum on Base Sepolia <ExternalLink /></a></li>
            <li><a href={`https://explorer.testnet.chain.robinhood.com/address/${robinhoodProof.contracts.Pactum}`} target="_blank" rel="noreferrer">Pactum on Robinhood testnet <ExternalLink /></a></li>
            <li><a href="#/guardians">Every offer the guardians approved or cancelled, read live from NEAR</a></li>
            <li><a href={`https://testnet.nearblocks.io/address/${proof.near.controllerAccount}`} target="_blank" rel="noreferrer">The controller on NEAR testnet <ExternalLink /></a></li>
          </ul>
        </Reveal>
      </section>

      <section className="band" id="limits">
        <Reveal>
          <p className="eyebrow">Limits</p>
          <h2>What it does not do.</h2>
          <p className="section-lead">It does not stop hacks, it only improves the chance of getting money back. It is a prototype with mock tokens and has not been audited.</p>
        </Reveal>
        <div className="grid-2">
          {LIMITS.map((item, index) => (
            <Reveal key={item.title} delay={index * 70}>
              <article className="card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="cta">
        <Reveal>
          <h2>Play every side of a hack.</h2>
          <p>Fictional protocols with mock tokens. Be a hacker, a user who lost funds, the protocol owner writing an offer, or a stranger, and see what each one can do.</p>
          <a className="button button-primary button-lg" href="#/cases">Open app <Arrow /></a>
        </Reveal>
      </section>

      <Faq />

      <footer className="landing-footer">
        <span>&copy; {year} Pactum contributors. MIT License.</span>
        <span>Built at NEAR HACKATHON. Testnet only, not audited.</span>
      </footer>
    </div>
  );
}
