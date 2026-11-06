// Frequently asked questions for three audiences. Answers must match what the contract really does,
// even when that does not favor the product.
import { useMemo, useState } from "react";
import { useApp } from "../appdata";
import { Chevron, Search } from "../components/icons";
import { identify } from "../labels";
import { useWallet } from "../wallet";

type Audience = "holder" | "user" | "protocol";

interface Item {
  q: string;
  a: string;
}

const GROUPS: { id: Audience; label: string; intro: string; items: Item[] }[] = [
  {
    id: "holder",
    label: "Holding the funds",
    intro: "You hold funds from a hack and are thinking about returning them.",
    items: [
      { q: "Do I have to prove I am the hacker?", a: "No. The contract never asks who took the funds. Tokens are interchangeable, so it only counts what arrives. There is no sign-up and no identity check." },
      { q: "The funds moved through many wallets or a mixer. Can I still return them?", a: "Yes. Any wallet holding the token can return it, including a wallet with no visible link to the hack." },
      { q: "The funds were swapped or bridged to another chain. What now?", a: "A case accepts one token on one chain. If they sit on another chain where Pactum runs, the protocol can open a case there, approved by the same guardians. This demo runs on Sepolia, Base Sepolia and Robinhood testnet. Anywhere else, they must be swapped or bridged back first. This is the main practical limit." },
      { q: "How do I get the reward?", a: "It is paid in the same transaction as your return. Without that transaction nothing moves, so neither side has to go first. Leave the reward wallet empty to use the sending wallet, or enter any other wallet." },
      { q: "Can the reward be lowered or taken back?", a: "Not by the protocol or by Pactum. Once a case opens, no function can lower it, and a payment that has been made cannot be reversed by this contract. The issuer of a token may still be able to freeze it, which is outside this contract." },
      { q: "How much will I actually get?", a: "The percentage at that moment, up to the reward cap for that asset. The Return funds page shows the exact split before you send anything." },
      { q: "\"Keep 20%\" sounds like I only send back 80%. Do I?", a: "You send everything to the contract and 20% comes back in the same transaction. The result is the same, but the contract can enforce it." },
      { q: "Can I return only part of it?", a: "Yes. Each return uses the rate at that moment, and the reward cap counts across all your returns." },
      { q: "What happens after the deadline?", a: "The contract rejects the return and your tokens stay with you. There is no reward after the last deadline." },
      { q: "Does returning the funds protect me from prosecution?", a: "No. The contract commits to a payment and nothing else. It gives no immunity, and a protocol's special conditions cannot bind police or courts." },
      { q: "Am I anonymous?", a: "Do not assume so. Pactum asks for nothing about you, but every transaction is public and blockchain analysis can link wallets. Paying a sanctioned party can also be illegal for the people involved." },
      { q: "Are the special conditions in an offer binding?", a: "The contract does not enforce them. It only enforces the reward, deadlines and refunds. The text is public on the chain and fixed by a hash, so it cannot be changed quietly, but keeping those promises is up to the protocol." },
    ],
  },
  {
    id: "user",
    label: "Lost funds",
    intro: "You had funds in a protocol that was hacked.",
    items: [
      { q: "How do I know if I can claim?", a: "Choose your wallet and open the Refund tab of the case, or see My wallet for every case at once. If your wallet is on the refund list, you see your amount. You can also type in any wallet to check it without connecting." },
      { q: "Do I need an account or to verify my identity?", a: "No. A claim only needs a proof that your wallet and amount are on the list, and the app provides that proof." },
      { q: "How much will I get back?", a: "Your share of whatever has come back: your allocation × refund pool ÷ total loss. Usually this is less than you lost, because the reward comes out of the returned funds and not everything may come back." },
      { q: "Will I definitely get my money back?", a: "No. It depends on whether the holder returns the funds. Pactum removes the reasons a return can stall, but it cannot force one." },
      { q: "When can I claim?", a: "As soon as funds come back. If more arrive later, you can claim again for the difference." },
      { q: "Is there a deadline to claim?", a: "No. The deadlines only apply to returning funds. Refunds stay claimable after a case closes." },
      { q: "Can the team take my refund?", a: "No. The contract has no owner, no upgrade path and no withdraw function. Tokens leave only as a reward during a return or as a refund to a listed wallet." },
      { q: "I have no gas. Can someone claim for me?", a: "Yes. Anyone can send the claim transaction for you, and the tokens still go only to your wallet." },
      { q: "My wallet or amount on the list is wrong. Can it be fixed?", a: "Not in that case. The list is fixed when the case opens, so a wrong list can only be handled by the protocol outside this contract. This is one of the things you still have to trust." },
      { q: "Can I receive my refund in another asset?", a: "Your refund arrives in the token that was returned. The Refund tab shows a live NEAR Intents quote for swapping it to another asset on another chain. In this demo the quote is real, but no swap runs." },
    ],
  },
  {
    id: "protocol",
    label: "Running a protocol",
    intro: "Your protocol was hacked and you want the funds back.",
    items: [
      { q: "How do I open a case?", a: "Write an offer with the reward, deadlines and any special conditions. Guardians approve it on NEAR, Chain Signatures signs exactly those terms, and anyone can carry the signature to the EVM chain. In the local demo a test key stands in for the guardians." },
      { q: "What if the stolen funds are on more than one chain?", a: "The same guardians approve one case per chain on NEAR, and the same controller signs them all, so there is one set of rules and no key to manage on any chain. A signature made for one chain is rejected on another. This only covers EVM chains where Pactum is deployed: Sepolia, Base Sepolia and Robinhood testnet in this demo." },
      { q: "What do guardians actually see before approving?", a: "The full offer. Its text is stored in the proposal on NEAR, and the contract rejects any text that does not match the hash in the signed terms. Anyone can read it on the Guardians page." },
      { q: "Do I need a reward fund?", a: "No. The reward comes out of the returned funds, and nothing is paid unless funds come back." },
      { q: "How much should I offer?", a: "That is your decision. SEAL Safe Harbor suggests 10% as a starting point for whitehats. A higher reward for a fast return, falling over time, gives the holder a reason to act soon. This deployment rejects more than 20%." },
      { q: "Can I change the offer later?", a: "No, not even to raise it in this version. A holder only trusts an offer that cannot be pulled back, so the terms are fixed when the case opens. Check them before publishing." },
      { q: "Can my team withdraw the funds?", a: "No. There is no such function. This is the point: users do not have to trust the team with the money." },
      { q: "What if the hack took several tokens?", a: "Each token gets its own case on the contract, and the app groups them into one incident. Opening, returning and claiming take one transaction per token." },
      { q: "Who prepares the refund list?", a: "You do, from your records of who lost what. Check it carefully, because it cannot change after the case opens. A wrong list can misallocate that case's refunds, but it cannot pay out more than that case's pool." },
      { q: "What does a reward cap do?", a: "It sets the most that can be paid as a reward for an asset across all returns. If the percentage would pay more, the excess goes to users." },
      { q: "How do the special conditions work?", a: "Your text is hashed into the signed terms, so anyone can check it was not changed. The contract does not enforce it, so only promise what you will do." },
      { q: "Does this replace legal advice or SEAL Safe Harbor?", a: "No. Safe Harbor gives eligible whitehats a legal agreement, which Pactum does not. Pactum executes the split and the refunds. Paying a sanctioned party can be illegal, and this prototype has no screening, so real use needs legal advice." },
      { q: "Could a team abuse this by hacking itself?", a: "Yes, it could drain its own protocol and collect the reward. A reward cap, several guardians and public evidence reduce this but do not remove it. This is the biggest weakness." },
      { q: "Is this ready for real funds?", a: "No. It is a testnet prototype with mock tokens, and it has not been audited." },
    ],
  },
];

// Opens the group for the viewer's selected role, so they see their own questions first.
function defaultAudience(role: string | undefined, name: string | undefined): Audience {
  if (name === "Protocol owner") return "protocol";
  if (role === "user") return "user";
  if (role === "hacker" || name === "New wallet") return "holder";
  return "holder";
}

export function Faq() {
  const { directory } = useApp();
  const { address } = useWallet();
  const me = address ? identify(directory, address) : undefined;
  const [audience, setAudience] = useState<Audience>(() => defaultAudience(me?.role, me?.name));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    return GROUPS.flatMap((group) => group.items.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle)).map((item) => ({ ...item, group: group.label })));
  }, [needle]);
  const group = GROUPS.find((item) => item.id === audience)!;
  const items = results ?? group.items.map((item) => ({ ...item, group: group.label }));

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>FAQ</h1>
          <p>Plain answers, including the ones that do not favor Pactum.</p>
        </div>
      </header>

      <label className="faq-search">
        <Search />
        <span className="sr-only">Search questions</span>
        <input value={query} placeholder="Search all questions" onChange={(event) => setQuery(event.target.value)} />
      </label>

      {!results && (
        <>
          <div className="faq-tabs" role="tablist" aria-label="Who is asking">
            {GROUPS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={audience === item.id} className={audience === item.id ? "faq-tab is-active" : "faq-tab"} onClick={() => { setAudience(item.id); setOpen(null); }}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="faq-intro">{group.intro}</p>
        </>
      )}
      {results && results.length === 0 && <p className="empty">No question matches that search.</p>}

      <ul className="faq-list" key={results ? "search" : audience}>
        {items.map((item, index) => {
          const isOpen = open === item.q;
          return (
            <li key={item.q} className={isOpen ? "faq-item is-open" : "faq-item"} style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}>
              <button type="button" className="faq-question" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.q)}>
                <span>
                  {results && <span className="faq-group">{item.group}</span>}
                  {item.q}
                </span>
                <Chevron className="chevron" />
              </button>
              <div className="faq-answer"><div><p>{item.a}</p></div></div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
