// Pactum's mascot: an animated GIF, and a still image for people who turned off motion in their system.
// The drawing source lives in web/mascot.
const FILES = import.meta.glob<string>("../assets/mascot/*.{gif,png}", { eager: true, import: "default" });

export type MascotAction = "idle" | "wave" | "sad" | "sneak" | "alarm" | "look" | "write" | "stamp" | "split" | "cheer" | "wait" | "stop" | "travel" | "redeem";

export function Mascot({ action, size = 96 }: { action: MascotAction; size?: number }) {
  return (
    <picture className="mascot">
      <source media="(prefers-reduced-motion: reduce)" srcSet={FILES[`../assets/mascot/${action}.png`]} />
      <img src={FILES[`../assets/mascot/${action}.gif`]} width={size} height={size} alt="" loading="lazy" decoding="async" data-action={action} />
    </picture>
  );
}
