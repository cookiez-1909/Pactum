// A tour for newcomers: pick a role, then the mascot leads through a few short steps. It can always be skipped.
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../appdata";
import { celebrate } from "../fun";
import { useWallet } from "../wallet";
import { Mascot, type MascotAction } from "./Mascot";

export type TourRole = "user" | "hacker" | "protocol";

const SEEN_KEY = "pactum-tour";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "done");
  } catch {
    // The browser blocks storage: they will be asked again next time, which is fine.
  }
}

const ROLES: { id: TourRole; title: string; body: string; mascot: MascotAction }[] = [
  { id: "user", title: "User", body: "I lost money in a hack.", mascot: "sad" },
  { id: "hacker", title: "Hacker", body: "I have the funds and might return them.", mascot: "sneak" },
  { id: "protocol", title: "Protocol", body: "My project got hacked.", mascot: "alarm" },
];

// The welcome screen, shown only once. It needs no chain data, so it can show even on the home page.
export function Welcome({ onClose }: { onClose(): void }) {
  const skip = () => {
    markTourSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      markTourSeen();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop welcome" role="presentation">
      <div className="modal welcome-box" role="dialog" aria-modal="true" aria-label="Welcome to Pactum">
        <h2>Welcome! Who are you?</h2>
        <p className="muted">Pick one and we&rsquo;ll show you around. It takes a minute.</p>
        <div className="welcome-roles">
          {ROLES.map((role) => (
            <a
              key={role.id}
              className="welcome-role"
              href={`#/tour/${role.id}`}
              onClick={() => {
                markTourSeen();
                onClose();
              }}
            >
              <Mascot action={role.mascot} size={136} />
              <strong>{role.title}</strong>
              <span className="muted small">{role.body}</span>
            </a>
          ))}
        </div>
        <button type="button" className="button welcome-skip" onClick={skip}>Skip</button>
      </div>
    </div>,
    document.body,
  );
}

interface Step {
  href: string;
  target: string;
  mascot: MascotAction;
  title: string;
  body: string;
}

const PERSONA: Record<TourRole, string> = { user: "User 3", hacker: "Hacker", protocol: "Protocol owner" };

// The wording stays very short and avoids jargon. Builds without the sample cases use the first case.
function stepsFor(role: TourRole, ids: string[]): Step[] {
  const pick = (id: string) => (ids.includes(id) ? id : (ids[0] ?? id));
  if (role === "user") {
    const refund = pick("northgate");
    return [
      { href: "#/cases", target: ".case-row", mascot: "look", title: "Find your hack", body: "Each row is one hack. Open the one that hit you." },
      { href: `#/case/${refund}`, target: ".next-step", mascot: "wait", title: "We tell you what to do", body: "This box always shows your next step." },
      { href: `#/case/${refund}/refund`, target: ".tab-panel", mascot: "cheer", title: "Claim your money", body: "Your share is here. One click and it's yours." },
      { href: "#/profile", target: ".intent-card", mascot: "travel", title: "Get paid your way", body: "Pick any coin on any chain. We'll remember it." },
    ];
  }
  if (role === "hacker") {
    const open = pick("tidewater");
    return [
      { href: `#/case/${open}/offer`, target: ".tab-panel", mascot: "look", title: "Read the deal", body: "What you keep, and until when. A contract enforces it." },
      { href: `#/case/${open}/return`, target: ".split-preview", mascot: "split", title: "See your cut", body: "Gold is yours. Green goes back to the people who lost money." },
      { href: `#/case/${open}/return`, target: ".tab-panel .button-block", mascot: "redeem", title: "Send it back", body: "One click. No sign-up. We warn you first." },
    ];
  }
  return [
    { href: `#/case/${pick("marlin")}/offer`, target: ".tab-panel", mascot: "write", title: "Make your offer", body: "Say what the holder keeps, and for how long." },
    { href: "#/guardians", target: ".proposal", mascot: "stamp", title: "Guardians check it", body: "Independent people approve your offer before it goes live." },
    { href: `#/case/${pick("northgate")}`, target: ".quest", mascot: "cheer", title: "Watch money come back", body: "This fills up by itself. Users claim on their own." },
  ];
}

// Opening #/tour/<role> picks the matching test wallet and starts. Without a role, ask again.
export function TourEntry({ role, onStart }: { role: string | undefined; onStart(role: TourRole): void }) {
  const { personas, select } = useWallet();
  const known = role === "user" || role === "hacker" || role === "protocol";

  useEffect(() => {
    if (!known) return;
    const persona = personas.find((item) => item.name === PERSONA[role]);
    if (persona) select(persona);
    onStart(role);
    // Runs only once when this link opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (known) return null;
  return <Welcome onClose={() => window.location.replace("#/cases")} />;
}

export function Tour({ role, onClose }: { role: TourRole; onClose(): void }) {
  const { desk } = useApp();
  const [steps] = useState(() => stepsFor(role, desk.incidents.map((incident) => incident.id)));
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = steps[index]!;

  useEffect(() => {
    window.location.hash = step.href;
  }, [step.href]);

  // Waits for the element, scrolls to it once, then follows its position as the page changes.
  useLayoutEffect(() => {
    let frame = 0;
    let scrolled = false;
    let last = "";
    setBox(null);
    const follow = () => {
      const element = document.querySelector(step.target);
      if (element) {
        if (!scrolled) {
          element.scrollIntoView({ block: "center" });
          scrolled = true;
        }
        const rect = element.getBoundingClientRect();
        const key = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
        if (key !== last) {
          last = key;
          setBox(rect);
        }
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [step.target, step.href]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const last = index === steps.length - 1;
  // The tour card stays clear of the highlighted spot.
  const onTop = !!box && box.top + box.height / 2 > window.innerHeight * 0.55 && box.height < window.innerHeight * 0.6;

  return createPortal(
    <>
      {box && <div className="tour-spot" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} aria-hidden="true" />}
      <section className={onTop ? "tour-card is-top" : "tour-card"} role="dialog" aria-label="Tour">
        <Mascot key={step.mascot} action={step.mascot} size={92} />
        <div className="tour-text">
          <h3>{step.title}</h3>
          <p>{step.body}</p>
          <div className="tour-actions">
            <span className="tour-dots" aria-label={`Step ${index + 1} of ${steps.length}`}>
              {steps.map((item, position) => <i key={item.title} className={position === index ? "is-on" : ""} />)}
            </span>
            <button type="button" className="tour-skip" onClick={onClose}>Skip</button>
            {index > 0 && <button type="button" className="button tour-back" onClick={() => setIndex(index - 1)}>Back</button>}
            <button
              type="button"
              className="button button-primary tour-next"
              onClick={() => {
                if (!last) {
                  setIndex(index + 1);
                  return;
                }
                celebrate();
                onClose();
              }}
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </>,
    document.body,
  );
}
