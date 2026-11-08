// Small rewards for users: confetti when money arrives and badges for trying each step.
// Badges are saved only in this browser and are worth nothing.
import type { MascotAction } from "./components/Mascot";

export interface Badge {
  id: string;
  name: string;
  how: string;
  mascot: MascotAction;
}

export const BADGES: Badge[] = [
  { id: "explorer", name: "First look", how: "Open a case", mascot: "wave" },
  { id: "detective", name: "Detective", how: "Read the guardians' page", mascot: "look" },
  { id: "returner", name: "Redemption", how: "Return funds to a case", mascot: "redeem" },
  { id: "claimer", name: "Made whole", how: "Claim a refund", mascot: "cheer" },
];

const KEY = "pactum-badges";
let memory: string[] = [];

export function earnedBadges(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return memory;
  }
}

// Returns the badge if this is the first time it is earned.
export function earn(id: string): Badge | null {
  const earned = earnedBadges();
  if (earned.includes(id)) return null;
  const next = [...earned, id];
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Still kept in memory until the page reloads.
  }
  return BADGES.find((badge) => badge.id === id) ?? null;
}

const COLORS = ["#5b5bf7", "#f5a524", "#12b886", "#ff4d8d", "#36c5f0"];

export function celebrate(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 80; i += 1) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length]!;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 240}px`);
    piece.style.setProperty("--spin", `${(Math.random() - 0.5) * 900}deg`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 2800);
}
