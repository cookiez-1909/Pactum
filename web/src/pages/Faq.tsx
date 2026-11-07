// Frequently asked questions for three audiences, at the end of the landing page. Answers must match
// what the contract really does, even when that does not favor the product.
// The landing page runs outside the wallet and chain providers, so this section does not read the viewer's role.
import { useMemo, useState } from "react";
import { Chevron, Search } from "../components/icons";
import { Reveal } from "../components/motion";

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
      { q: "So can anyone collect the reward?", a: "Only by returning tokens of their own. Someone who sends in 100 gets back 10 at a 10% reward, so they lose 90. There is nothing to gain unless the tokens were never theirs." },
      { q: "The funds were swapped or bridged to another chain. What now?", a: "A case accepts one token on one chain. If they sit on another chain where Pactum runs, the protocol can open a case there, approved by the same guardians. This demo runs on Sepolia, Base Sepolia and Robinhood testnet. Anywhere else, they must be swapped or bridged back first. This is the main practical limit." },
      { q: "How do I get the reward?", a: "It is paid in the same transaction as your return. Without that transaction nothing moves, so neither side has to go first. Leave the reward wallet empty to use the sending wallet, or enter any other wallet." },
      { q: "Can the reward be lowered or taken back?", a: "Not by the protocol or by Pactum. Once a case opens, no function can lower it, and a payment that has been made cannot be reversed by this contract. The issuer of a token may still be able to freeze it, which is outside this contract." },
      { q: "How much will I actually get?", a: "The percentage at that moment, up to the reward cap for that asset. The Return funds page shows the exact split before you send anything. If the reward would be lower when the transaction lands, for example after a deadline or another return, it reverts and your tokens stay with you." },
      { q: "\"Keep 20%\" sounds like I only send back 80%. Do I?", a: "You send everything to the contract and 20% comes back in the same transaction. The result is the same, but the contract can enforce it." },
      { q: "Can I return only part of it?", a: "Yes. Each return uses the rate at that moment. The reward cap for an asset counts across all returns from anyone, so someone else can use it up first." },
      { q: "What happens after the deadline?", a: "The contract rejects the return and your tokens stay with you. There is no reward after the last deadline." },
      { q: "Does returning the funds protect me from prosecution?", a: "No. The contract commits to a payment and nothing else. It gives no immunity, and a protocol's special conditions cannot bind police or courts." },
      { q: "Am I anonymous?", a: "Do not assume so. Pactum asks for nothing about you, but every transaction is public and blockchain analysis can link wallets. Paying a sanctioned party can also be illegal for the people involved." },
      { q: "How do I know an offer is from the real protocol?", a: "Open the protocol's official account yourself and look for a post with this contract address and the offer's code. Then compare the address with Pactum's published list. Guardians verify the team, but anyone can deploy their own copy of Pactum with their own guardians, call it official and put their own wallet on the refund list. The contract would run correctly. A fake site can also show the same checks as this one, so nothing on chain can do this for you." },
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
      { q: "Is there a deadline to claim?", a: "No. The deadlines only apply to returning funds. Refunds stay claimable after a case closes. Money nobody claims stays in the contract forever, because no function can sweep it." },
      { q: "Can the team take my refund?", a: "Not by withdrawing it. The contract has no owner, no upgrade path and no withdraw function. But the team prepares the refund list, so a dishonest team could add its own wallets to it. The list is fixed and public before any money arrives, and guardians should check it, so anyone can spot this in time. Check the list when a case opens." },
      { q: "Where is the refund list kept?", a: "The contract stores only its Merkle root, so the full list must be published somewhere. Your proof comes from that file. If every copy disappeared, claims could not be made, although anyone holding a copy can publish it again, and the root proves it is genuine." },
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
      { q: "How do I open a case?", a: "First register with the guardians: after a hack, contact them off chain and show that you control the protocol. Then write an offer with the reward, deadlines and any special conditions. Guardians approve it on NEAR, Chain Signatures signs exactly those terms, and anyone can carry the signature to the EVM chain. In the local demo, registration is simulated and a test key stands in for the guardians." },
      { q: "How does anyone know I am the team?", a: "Nothing on chain says who runs a protocol, so anyone can ask. Guardians need at least two of these from before the hack: a signature from the owner or multisig of the hacked contract, a post from the known official account, or a known auditor or security group vouching for you. If they are not convinced, they do not propose an offer. An anonymous team with no admin key may not be able to pass." },
      { q: "Why do I have to register after a hack?", a: "Because the contract cannot tell who really runs a protocol. Only guardians can propose an offer, so they check off chain who is asking. They give you a new code, and you publish it with the contract address from your official account or sign it with your admin wallet. A copied link would prove nothing. This depends on the guardians checking properly, and on those accounts not being hacked as well." },
      { q: "What if the stolen funds are on more than one chain?", a: "You write one offer that covers them all. Guardians read it and approve once on NEAR, and the contract gets a separate signature for each chain. Someone still has to send each signature to its own chain to open the case there. A signature made for one chain is rejected on another. This only covers EVM chains where Pactum is deployed: Sepolia, Base Sepolia and Robinhood testnet in this demo." },
      { q: "What if the funds move to a chain Pactum does not serve yet?", a: "Deploy Pactum on that chain, and guardians vote to add it on NEAR. The signing address stays the same, and chains already served cannot be replaced by a vote. It works only for EVM chains." },
      { q: "What do guardians actually see before approving?", a: "The full offer. Its text is stored in the proposal on NEAR, and the contract rejects any text that does not match the hash in the signed terms. Anyone can read it on the Guardians page." },
      { q: "Do I need a reward fund?", a: "No. The reward comes out of the returned funds, and nothing is paid unless funds come back." },
      { q: "How much should I offer?", a: "That is your decision. SEAL Safe Harbor suggests 10% as a starting point for whitehats. A higher reward for a fast return, falling over time, gives the holder a reason to act soon. This deployment rejects more than 20%." },
      { q: "Can I change the offer later?", a: "Not the case you opened. A holder only trusts an offer that cannot be pulled back, so its terms are fixed when it opens. To offer more, guardians can open a new case for the same token, with its own refund list. The holder can then choose either one." },
      { q: "What if the guardians signed something wrong?", a: "Until the case opens, they can vote to cancel by the same threshold. Unsigned cases are dropped, and signed ones get a revocation that anyone can send to the chain, which stops the old signature from opening the case. Someone could still open it first, because the signature is already public. Once a case is open, nothing can undo it." },
      { q: "What if a guardian loses their key?", a: "The others can vote in a replacement by the same threshold. The signing address and the reward limit stay the same. If more keys are lost than the threshold allows, the contracts must be deployed again on every chain." },
      { q: "Can my team withdraw the funds?", a: "No. There is no such function. This is the point: users do not have to trust the team with the money." },
      { q: "What if the hack took several tokens?", a: "Each token gets its own case on the contract, and the app groups them into one incident. Opening, returning and claiming take one transaction per token." },
      { q: "Who prepares the refund list?", a: "You do. The refund-list tool builds it from your records or from Transfer events into your protocol, and it stops if the total does not match the loss. Check it carefully, because it cannot change after the case opens. A wrong list can misallocate that case's refunds, but it cannot pay out more than that case's pool. You must publish the list, because the contract stores only its root." },
      { q: "Why must the list exist before the case opens?", a: "Because a list added later would let whoever signs it point the money at themselves after it arrives. Fixing it first is what keeps the team away from the funds. The cost is that a binding offer can only go out once the list is ready." },
      { q: "The hacker swapped the stolen token. What now?", a: "A case only accepts its own token, so you open a case in the token they hold. The refund-list tool can rescale the same shares to a new total, so each user keeps their share of the loss. The price of the swap is your decision, and there is no oracle in the contract." },
      { q: "What does a reward cap do?", a: "It sets the most that can be paid as a reward for an asset across all returns. If the percentage would pay more, the excess goes to users." },
      { q: "How do the special conditions work?", a: "Your text is hashed into the signed terms, so anyone can check it was not changed. The contract does not enforce it, so only promise what you will do." },
      { q: "Does this replace legal advice or SEAL Safe Harbor?", a: "No. Safe Harbor gives eligible whitehats a legal agreement, which Pactum does not. Pactum executes the split and the refunds. Paying a sanctioned party can be illegal, and this prototype has no screening, so real use needs legal advice." },
      { q: "Could a team abuse this by hacking itself?", a: "Yes, it could drain its own protocol and collect the reward. A reward cap, several guardians and public evidence reduce this but do not remove it. This is the biggest weakness." },
      { q: "Is this ready for real funds?", a: "No. It is a testnet prototype with mock tokens, and it has not been audited." },
    ],
  },
];

export function Faq() {
  const [audience, setAudience] = useState<Audience>("holder");
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
    <section className="band" id="faq">
      <Reveal>
        <p className="eyebrow">FAQ</p>
        <h2>Plain answers, including the ones that do not favor Pactum.</h2>
      </Reveal>

      <div className="faq-body">
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
    </section>
  );
}
