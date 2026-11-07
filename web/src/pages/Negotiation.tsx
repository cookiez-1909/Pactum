// Two-way talks between the fund holder and the protocol team. Messages live on chain, so no server is needed,
// but they move no money: an open case keeps its terms, and changing them means opening a new case.
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useApp, useToast } from "../appdata";
import { counterTopic, erc20Abi, notesAbi, publicClientOf, txUrl, walletFor } from "../chain";
import { Party } from "../components/Party";
import { shortAddress, timeAgo, tokens } from "../format";
import type { Incident } from "../useDesk";
import { useNotes, type PublicNote } from "../useNotes";
import { useWallet } from "../wallet";

const MAX_MESSAGE = 500;
// The controller's limit on NEAR. Anyone can ask for more, but the guardians cannot sign it.
const REWARD_LIMIT = 20;

interface Parsed {
  note: PublicNote;
  keepBps: number | null;
  message: string;
}

// A note is any string sent by anyone, so read it carefully and skip anything malformed.
function parse(note: PublicNote): Parsed | null {
  try {
    const body = JSON.parse(note.text) as { keepBps?: unknown; message?: unknown };
    if (typeof body.message !== "string" || body.message.length === 0 || body.message.length > MAX_MESSAGE) return null;
    const keepBps = typeof body.keepBps === "number" && Number.isInteger(body.keepBps) && body.keepBps >= 0 && body.keepBps <= 10_000 ? body.keepBps : null;
    return { note, keepBps, message: body.message };
  } catch {
    return null;
  }
}

export function Negotiation({ incident }: { incident: Incident }) {
  const { deployment, desk } = useApp();
  const toast = useToast();
  const { address, persona, readOnly } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const { notes, failed, reload } = useNotes(deployment, counterTopic(incident.id));
  const [holdings, setHoldings] = useState<Record<string, string>>({});
  const [keepText, setKeepText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const assets = useMemo(() => [...incident.cases.map((info) => info.token), ...incident.pending.map((asset) => asset.token)], [incident]);
  const thread = useMemo(() => notes.map(parse).filter((item): item is Parsed => item !== null).sort((a, b) => (a.note.block === b.note.block ? a.note.key.localeCompare(b.note.key) : a.note.block < b.note.block ? -1 : 1)), [notes]);
  const owner = deployment.actors.owner?.toLowerCase();
  const authorKey = thread.map((item) => item.note.author).join();
  const sameMessages = thread.length;

  // The "Holds the funds" label is read from the real balance on chain, so nobody can claim it.
  useEffect(() => {
    let cancelled = false;
    const wallets = [...new Set([...thread.map((item) => item.note.author.toLowerCase()), ...(address ? [address.toLowerCase()] : [])])];
    (async () => {
      const entries = await Promise.all(
        wallets.map(async (wallet) => {
          const balances = await Promise.all(assets.map(async (token) => ({ token, balance: await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] }) })));
          const held = balances.filter((item) => item.balance > 0n).map((item) => `${tokens(item.balance, item.token.decimals, 2)} ${item.token.symbol}`);
          return [wallet, held.join(", ")] as const;
        }),
      );
      if (!cancelled) setHoldings(Object.fromEntries(entries));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorKey, sameMessages, address, assets, client]);

  const me = address?.toLowerCase();
  const isHolder = !!me && !!holdings[me];
  const isTeam = !!me && me === owner;
  const canWrite = !readOnly && !!address && !!deployment.contracts.PublicNotes && (isHolder || isTeam);
  const percent = keepText.trim() === "" ? null : /^\d+(\.\d{1,2})?$/.test(keepText.trim()) ? Number(keepText.trim()) : NaN;
  const percentValid = percent === null || (!Number.isNaN(percent) && percent >= 0 && percent <= 100);
  const needsPercent = isHolder && !isTeam;
  const ready = canWrite && percentValid && message.trim().length > 0 && message.trim().length <= MAX_MESSAGE && (!needsPercent || percent !== null) && !busy;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    try {
      const body = JSON.stringify({ ...(percent !== null && !isTeam ? { keepBps: Math.round(percent * 100) } : {}), message: message.trim() });
      const { client: wallet, account } = await walletFor(deployment, persona);
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: deployment.contracts.PublicNotes!, abi: notesAbi, functionName: "post", args: [counterTopic(incident.id), body] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      setKeepText("");
      setMessage("");
      await reload();
      toast({ kind: "ok", title: isTeam ? "Reply sent" : "Counter-offer sent", detail: "It is now public on the chain.", href: txUrl(deployment, hash) });
    } catch (reason) {
      const text = reason instanceof Error ? reason.message.split("\n")[0]! : "Sending failed";
      setFailure(text);
      toast({ kind: "error", title: "Could not send", detail: text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card negotiation">
      <h2>Talk to the other side</h2>
      <p className="muted">Whoever holds the funds can answer the protocol with their own terms, and the team can reply. Everything here is public.</p>
      <p className="notice"><strong>A message moves no money and changes no offer.</strong> Only an open case binds anyone. To accept a counter-offer, the team asks the guardians to open a new case with those terms.</p>

      {failed && <p className="notice">Could not read messages from this RPC node.</p>}
      {!failed && thread.length === 0 && <p className="muted">No messages yet.</p>}
      <ol className="comments negotiation-thread">
        {thread.map(({ note, keepBps, message: text }) => {
          const author = note.author.toLowerCase();
          const holds = holdings[author];
          const href = txUrl(deployment, note.hash);
          return (
            <li key={note.key} className="comment negotiation-message">
              <div className="comment-head">
                <Party address={note.author} compact />
                {author === owner && <span className="tag">Team, simulated</span>}
                {holds ? <span className="holds-funds" title="Read from this wallet's balance on the chain right now">Holds {holds}</span> : author !== owner && <span className="tag">Holds none of these tokens now</span>}
                <span className="comment-time">{timeAgo(note.time, desk.now)} · {href ? <a href={href} target="_blank" rel="noreferrer"><code>{shortAddress(note.hash)}</code></a> : <code>{shortAddress(note.hash)}</code>}</span>
              </div>
              {keepBps !== null && (
                <p className="counter-ask">
                  Asks to keep <strong>{keepBps / 100}%</strong>
                  {keepBps / 100 > REWARD_LIMIT && <span className="counter-limit"> Above the {REWARD_LIMIT}% limit, so guardians could not sign it.</span>}
                </p>
              )}
              <p className="comment-text">{text}</p>
            </li>
          );
        })}
      </ol>

      {address && !canWrite && !readOnly && <p className="block-reason" role="status">Only a wallet holding these tokens, or the team, writes here. Everyone else can use the Discussion tab.</p>}
      {readOnly && <p className="block-reason" role="status">This is a view of a wallet you typed in. It can read, but it cannot send anything.</p>}
      {canWrite && (
        <div className="negotiation-composer">
          {!isTeam && (
            <label className="field">
              <span>I would return the funds if I keep</span>
              <span className="input-with-unit custom-input">
                <input inputMode="decimal" value={keepText} placeholder="15" aria-invalid={!percentValid} aria-label="Percent you would keep" onChange={(event) => setKeepText(event.target.value)} />
                <span className="input-unit">%</span>
              </span>
            </label>
          )}
          {!percentValid && <p className="field-error">Enter a percent from 0 to 100, with at most 2 decimals.</p>}
          {percent !== null && percentValid && percent > REWARD_LIMIT && !isTeam && <p className="fine-print">The controller rejects more than {REWARD_LIMIT}%, so guardians could not sign this. You can still ask.</p>}
          <label className="field">
            <span>{isTeam ? "Your reply" : "Your message"}</span>
            <textarea rows={3} value={message} maxLength={MAX_MESSAGE} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <button type="button" className="button button-primary negotiation-send" disabled={!ready} onClick={send}>{busy ? <><span className="spinner" /> Sending…</> : isTeam ? "Send reply" : "Send counter-offer"}</button>
          {failure && <p className="field-error" role="alert">{failure}</p>}
          <p className="fine-print">Public and permanent, and it costs a little gas. {!isTeam && "It links this wallet to the funds in public, and it gives no immunity. Do not share anything that could identify you."}</p>
        </div>
      )}
      <p className="fine-print">"Holds" is read from each wallet's balance right now, so it cannot be claimed falsely. It does not prove who took the funds. "Team" is a test account in this demo. In real use, a team would name its wallet in its official post.</p>
    </section>
  );
}
