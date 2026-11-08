// Compares a real hack with how Pactum would handle it. The replay runs for real on the contract, on the local chain.
import { REPLAY } from "../data/replay";
import { ExternalLink } from "./icons";
import { Mascot } from "./Mascot";

export function ReplayCard() {
  return (
    <section className="card replay-card">
      <div className="replay-head">
        <Mascot action="look" size={96} />
        <div>
          <h2>{REPLAY.title}</h2>
          <p className="muted small">{REPLAY.intro}</p>
        </div>
      </div>
      <div className="replay-grid">
        <span className="replay-label">Step</span>
        <span className="replay-label">What happened</span>
        <span className="replay-label">With Pactum</span>
        {REPLAY.rows.map((row) => (
          <div key={row.step} style={{ display: "contents" }}>
            <span className="replay-step">{row.step}</span>
            <span>{row.happened}</span>
            <span className="replay-new">{row.pactum}</span>
          </div>
        ))}
      </div>
      <p className="fine-print">{REPLAY.limits}</p>
      <p className="replay-sources">
        {REPLAY.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink /></a>)}
      </p>
    </section>
  );
}
