// An incident's discussion. The author is the connected wallet, and people on the refund list get their own label.
// The demo has no server, so new comments are only saved in this browser.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appdata";
import { Party } from "../components/Party";
import { SEED_COMMENTS, type Speaker } from "../data/discussions";
import { timeAgo } from "../format";
import type { Incident } from "../useDesk";
import { useWallet } from "../wallet";

const MAX_LENGTH = 500;

interface Comment {
  id: string;
  author: string;
  time: number;
  text: string;
  sample: boolean;
}

const storageKey = (incidentId: string) => `pactum-discussion:${incidentId}`;

function loadSaved(incidentId: string): Comment[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(incidentId)) ?? "[]") as Comment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function discussionCount(incidentId: string): number {
  return (SEED_COMMENTS[incidentId]?.length ?? 0) + loadSaved(incidentId).length;
}

export function Discussion({ incident }: { incident: Incident }) {
  const { deployment, desk } = useApp();
  const { address, connect, readOnly } = useWallet();
  const [saved, setSaved] = useState<Comment[]>(() => loadSaved(incident.id));
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => setSaved(loadSaved(incident.id)), [incident.id]);

  const victims = useMemo(() => {
    const list = [...incident.cases.flatMap((info) => info.allocations), ...incident.pending.flatMap((asset) => asset.allocations)];
    return new Set(list.map((entry) => entry.account.toLowerCase()));
  }, [incident]);

  const addressOf = (speaker: Speaker): string | undefined => {
    const { actors } = deployment;
    if (speaker === "owner") return actors.owner;
    if (speaker === "attacker") return actors.attacker;
    if (speaker === "stranger") return actors.stranger;
    return actors.users[speaker.user - 1];
  };

  // Sample comments are written as minutes ago, so they stay right even if the chain clock differs from the viewer's.
  const nowSeconds = Math.floor(desk.now / 1000);
  const samples: Comment[] = (SEED_COMMENTS[incident.id] ?? []).flatMap((item) => {
    const author = addressOf(item.speaker);
    return author ? [{ id: item.id, author, time: nowSeconds - item.ageMinutes * 60, text: item.text, sample: true }] : [];
  });
  const comments = [...samples, ...saved].sort((a, b) => (sort === "new" ? b.time - a.time : a.time - b.time));

  const trimmed = text.trim();
  const canPost = !readOnly && !!address && trimmed.length > 0 && trimmed.length <= MAX_LENGTH;

  const post = () => {
    if (!canPost || !address) return;
    const next: Comment = { id: crypto.randomUUID(), author: address, time: Math.floor(desk.now / 1000), text: trimmed, sample: false };
    const updated = [...saved, next];
    setSaved(updated);
    setText("");
    try {
      localStorage.setItem(storageKey(incident.id), JSON.stringify(updated));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  };

  const remove = (id: string) => {
    const updated = saved.filter((item) => item.id !== id);
    setSaved(updated);
    try {
      localStorage.setItem(storageKey(incident.id), JSON.stringify(updated));
    } catch {
      setStorageFailed(true);
    }
  };

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card">
          <h2>Join the discussion</h2>
          {address ? (
            <>
              <p className="composer-author">Posting as <Party address={address} compact />{victims.has(address.toLowerCase()) && <span className="lost-funds">Lost funds</span>}</p>
              <textarea rows={3} value={text} maxLength={MAX_LENGTH} aria-label="Your comment" placeholder={`What do you think about the ${incident.name} hack?`} onChange={(event) => setText(event.target.value)} />
              <div className="composer-foot">
                <span className="fine-print">{text.length} of {MAX_LENGTH}</span>
                <button type="button" className="button button-primary" disabled={!canPost} onClick={post}>Post comment</button>
              </div>
              {storageFailed && <p className="field-error">This browser would not save your comment. It will disappear when you reload.</p>}
            </>
          ) : (
            <>
              <p className="muted">Connect a wallet to post. Your comments appear under that wallet.</p>
              <button type="button" className="button button-primary" onClick={connect}>Connect wallet</button>
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
          {comments.length === 0 && <p className="muted">No comments yet. Be the first to say something.</p>}
          <ol className="comments">
            {comments.map((comment) => (
              <li key={comment.id} className="comment">
                <div className="comment-head">
                  <Party address={comment.author} compact />
                  {victims.has(comment.author.toLowerCase()) && <span className="lost-funds" title="This wallet is on the refund list for this incident">Lost funds</span>}
                  {comment.sample && <span className="tag">Sample</span>}
                  <span className="comment-time">{timeAgo(comment.time, desk.now)}</span>
                </div>
                <p className="comment-text">{comment.text}</p>
                {!comment.sample && address?.toLowerCase() === comment.author.toLowerCase() && (
                  <button type="button" className="link-button" onClick={() => remove(comment.id)}>Delete</button>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="col-side">
        <section className="card card-quiet">
          <h2>About this discussion</h2>
          <p><strong>Lost funds</strong> means the wallet is on the refund list for this incident.</p>
          <p>Comments marked Sample are written for this demo. New comments are saved only in this browser, so nobody else can see them. A live version needs shared storage and moderation.</p>
          <p>Do not share anything here that could identify the holder or a victim.</p>
        </section>
      </div>
    </div>
  );
}
