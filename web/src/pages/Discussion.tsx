// An incident's discussion. Comments live on chain, so anyone who opens the page sees them with no server.
// The author is the wallet that sent the transaction, so the "Lost funds" label cannot be faked.
import { useMemo, useState } from "react";
import { useApp, useToast } from "../appdata";
import { discussionTopic, notesAbi, publicClientOf, txUrl, walletFor } from "../chain";
import { Party } from "../components/Party";
import { shortAddress, timeAgo } from "../format";
import type { Incident } from "../useDesk";
import type { PublicNote } from "../useNotes";
import { useWallet } from "../wallet";

const MAX_LENGTH = 500;

export function Discussion({ incident, notes, failed, reload }: { incident: Incident; notes: PublicNote[]; failed: boolean; reload(): Promise<void> }) {
  const { deployment, desk } = useApp();
  const toast = useToast();
  const { address, persona, connect, readOnly } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const victims = useMemo(() => {
    const list = [...incident.cases.flatMap((info) => info.allocations), ...incident.pending.flatMap((asset) => asset.allocations)];
    return new Set(list.map((entry) => entry.account.toLowerCase()));
  }, [incident]);

  const comments = [...notes].sort((a, b) => {
    const order = a.block === b.block ? a.key.localeCompare(b.key) : a.block < b.block ? -1 : 1;
    return sort === "new" ? -order : order;
  });

  const trimmed = text.trim();
  const noContract = !deployment.contracts.PublicNotes;
  const canPost = !noContract && !readOnly && !!address && trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !busy;

  const post = async () => {
    if (!canPost) return;
    setBusy(true);
    setFailure(null);
    try {
      const { client: wallet, account } = await walletFor(deployment, persona);
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: deployment.contracts.PublicNotes!, abi: notesAbi, functionName: "post", args: [discussionTopic(incident.id), trimmed] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      setText("");
      await reload();
      toast({ kind: "ok", title: "Comment posted", detail: "It is now public on the chain.", href: txUrl(deployment, hash) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.split("\n")[0]! : "Posting failed";
      setFailure(message);
      toast({ kind: "error", title: "Could not post", detail: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card">
          <h2>Join the discussion</h2>
          {noContract && <p className="notice">Comments are not available on this deployment.</p>}
          {!noContract && !address && (
            <>
              <p className="muted">Everyone can read this. Connect a wallet to post.</p>
              <button type="button" className="button button-primary" onClick={connect}>Connect wallet</button>
            </>
          )}
          {!noContract && address && (
            <>
              <p className="composer-author">Posting as <Party address={address} compact />{victims.has(address.toLowerCase()) && <span className="lost-funds">Lost funds</span>}</p>
              {readOnly && <p className="block-reason" role="status">This is a view of a wallet you typed in. Connect that wallet to post.</p>}
              <textarea rows={3} value={text} maxLength={MAX_LENGTH} aria-label="Your comment" placeholder={`What do you think about the ${incident.name} hack?`} onChange={(event) => setText(event.target.value)} />
              <div className="composer-foot">
                <span className="fine-print">{text.length} of {MAX_LENGTH}. Public and permanent, it cannot be deleted.</span>
                <button type="button" className="button button-primary" disabled={!canPost} onClick={post}>{busy ? <><span className="spinner" /> Posting…</> : "Post comment"}</button>
              </div>
              {failure && <p className="field-error" role="alert">{failure}</p>}
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{comments.length} {comments.length === 1 ? "comment" : "comments"}</h2>
            <div className="pills" role="group" aria-label="Sort comments">
              <button type="button" className={sort === "new" ? "pill is-active" : "pill"} aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
              <button type="button" className={sort === "old" ? "pill is-active" : "pill"} aria-pressed={sort === "old"} onClick={() => setSort("old")}>Oldest</button>
            </div>
          </div>
          {failed && <p className="notice">Could not read comments from this RPC node.</p>}
          {!failed && comments.length === 0 && <p className="muted">No comments yet. Be the first to say something.</p>}
          <ol className="comments">
            {comments.map((comment) => {
              const href = txUrl(deployment, comment.hash);
              return (
                <li key={comment.key} className="comment">
                  <div className="comment-head">
                    <Party address={comment.author} compact />
                    {victims.has(comment.author.toLowerCase()) && <span className="lost-funds" title="This wallet is on the refund list for this incident">Lost funds</span>}
                    <span className="comment-time">
                      {timeAgo(comment.time, desk.now)} · {href ? <a href={href} target="_blank" rel="noreferrer"><code>{shortAddress(comment.hash)}</code></a> : <code>{shortAddress(comment.hash)}</code>}
                    </span>
                  </div>
                  <p className="comment-text">{comment.text}</p>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <div className="col-side">
        <section className="card card-quiet">
          <h2>About this discussion</h2>
          <p>Comments live on the chain with no server, so everyone sees the same thing and nobody can quietly edit them.</p>
          <p><strong>Lost funds</strong> means the wallet is on the refund list for this incident. The author is the wallet that sent the comment, so this label cannot be faked.</p>
          <p>Posting costs a little gas. A comment cannot be deleted, and there is no moderation yet. Do not share anything that could identify someone.</p>
          {deployment.network === "local" && <p>The comments here are written for this demo by test accounts.</p>}
        </section>
      </div>
    </div>
  );
}
