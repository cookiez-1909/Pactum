// A warning before returning funds, so an ordinary person does not send their own tokens by mistake.
import { Mascot } from "./Mascot";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ReturnWarning({ send, reward, lose, symbol, onCancel, onConfirm }: { send: string; reward: string; lose: string; symbol: string; onCancel(): void; onConfirm(): void }) {
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="modal return-warning" role="alertdialog" aria-modal="true" aria-labelledby="warn-title" onMouseDown={(event) => event.stopPropagation()}>
        <p className="warn-icon" aria-hidden="true"><Mascot action="stop" size={104} /></p>
        <h2 id="warn-title">Stop and read this first</h2>
        <p className="warn-lead">This is for someone <strong>holding stolen funds from this hack</strong>. If these tokens are your own money, do not continue. You would lose most of them.</p>
        <dl className="warn-numbers">
          <div><dt>Leaves your wallet</dt><dd>{send} {symbol}</dd></div>
          <div><dt>You get back</dt><dd className="is-good">{reward} {symbol}</dd></div>
          <div><dt>Gone for good</dt><dd className="is-bad">{lose} {symbol}</dd></div>
        </dl>
        <ul className="warn-list">
          <li>This cannot be undone. Nobody can send the tokens back to you.</li>
          <li>Returning funds gives no legal protection.</li>
          <li>Check the "Verify this offer" box first. A fake site can look just like this one.</li>
        </ul>
        <label className="check-field warn-check">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          <span>I understand, and these tokens are not my own money</span>
        </label>
        <div className="warn-actions">
          <button type="button" className="button" onClick={onCancel}>Go back</button>
          <button type="button" className="button button-danger warn-confirm" disabled={!understood} onClick={onConfirm}>Yes, return {send} {symbol}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
