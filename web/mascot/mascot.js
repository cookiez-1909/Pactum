// Pactum's mascot: a chibi character drawn in SVG. render(name, t) returns the frame at time t in [0, 1).
// Every motion is periodic in t, so the GIF loops without a jump.
const C = {
  line: "#241f55", hair: "#5d57ea", hairHi: "#938eff", hairDk: "#3f39bd",
  skin: "#ffe6d8", skinDk: "#f6c7b3", blush: "#ff9db5",
  hood: "#ffc940", hoodDk: "#eba21a", trim: "#fff3c9",
  pants: "#2c2a66", shoe: "#ffffff", shoeDk: "#c9c8e8",
  gold: "#ffc53d", goldDk: "#d98f0e", green: "#2fd39a", greenDk: "#12926a",
  red: "#ff5468", redDk: "#c92a40", white: "#ffffff", ice: "#8fd8ff", iceDk: "#4aa8e8", dark: "#17143d",
};

const TAU = Math.PI * 2;
const wave = (t, cycles = 1, phase = 0) => Math.sin(TAU * (cycles * t + phase));
const up = (t, cycles = 1, phase = 0) => Math.abs(Math.sin(Math.PI * (cycles * t + phase)));
const frac = (x) => x - Math.floor(x);
const pulse = (t, at, width = 0.04) => Math.max(0, 1 - Math.abs(t - at) / width);
const ring = (r, n) => Array.from({ length: n }, (_, i) => i);

// --- Props and anime-style expressions ---
const sparkle = (x, y, r, color = C.gold) => `<path transform="translate(${x} ${y}) scale(${r})" d="M0-1Q.12-.12 1 0Q.12.12 0 1Q-.12.12-1 0Q-.12-.12 0-1Z" fill="${color}"/>`;
const sweat = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-10C5-3 8 0 8 4A8 8 0 0 1-8 4C-8 0-5-3 0-10Z" fill="${C.ice}" stroke="${C.iceDk}" stroke-width="2"/>`;
const vein = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${C.red}" stroke-width="3.6" stroke-linecap="round"><path d="M-10-3Q-3-3-3-10"/><path d="M10-3Q3-3 3-10"/><path d="M-10 3Q-3 3-3 10"/><path d="M10 3Q3 3 3 10"/></g>`;
const exclaim = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-6-22H6L3 4H-3Z" fill="${C.red}" stroke="${C.line}" stroke-width="2.5" stroke-linejoin="round"/><circle cy="14" r="5.5" fill="${C.red}" stroke="${C.line}" stroke-width="2.5"/></g>`;
const heart = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 9C-14-1-10-11-4-10C-2-10 0-8 0-6C0-8 2-10 4-10C10-11 14-1 0 9Z" fill="#ff7aa8" stroke="${C.line}" stroke-width="2"/>`;
const coin = (x, y, r, flip = 1) => `<g transform="translate(${x} ${y}) scale(${Math.max(0.16, Math.abs(flip))} 1)"><circle r="${r}" fill="${C.gold}" stroke="${C.goldDk}" stroke-width="3"/><circle r="${r * 0.68}" fill="none" stroke="${C.goldDk}" stroke-width="1.6"/><text y="${r * 0.36}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${r}" fill="${C.goldDk}">$</text></g>`;
const bill = (x, y, rot = 0, s = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><rect x="-22" y="-12" width="44" height="24" rx="3.5" fill="${C.green}" stroke="${C.greenDk}" stroke-width="2.6"/><circle r="7" fill="${C.greenDk}"/><text y="4.4" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="#fff">$</text></g>`;
const sack = (x, y, s = 1, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M-10-26C-34-8-38 26-20 30H20C38 26 34-8 10-26Z" fill="#c98a4b" stroke="${C.line}" stroke-width="3.5" stroke-linejoin="round"/><path d="M-13-28L-6-20L0-27L6-20L13-28L8-36H-8Z" fill="#a86e33" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/><rect x="-12" y="-25" width="24" height="5" rx="2" fill="${C.gold}" stroke="${C.line}" stroke-width="1.8"/><circle cy="8" r="13" fill="${C.gold}" stroke="${C.goldDk}" stroke-width="2.4"/><text y="14" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="17" fill="${C.goldDk}">$</text></g>`;
const gloom = (x, y) => [0, 1, 2, 3].map((i) => `<path d="M${x + i * 9} ${y}v${16 - i * 3}" stroke="#7a78c9" stroke-width="2.6" stroke-linecap="round"/>`).join("");

function wheelClip(angle) {
  const spokes = [0, 60, 120].map((a) => `<path d="M-8 0H8" transform="rotate(${a})" stroke="${C.goldDk}" stroke-width="2.4" stroke-linecap="round"/>`).join("");
  return `<g transform="translate(-45 -141) rotate(${angle})"><circle r="10" fill="${C.gold}" stroke="${C.line}" stroke-width="2.6"/>${spokes}<circle r="3" fill="${C.trim}" stroke="${C.goldDk}" stroke-width="1.4"/></g>`;
}

// --- Face ---
const EYES = [-24, 24];
const EYE_Y = -96;

function openEye(x, lx, ly, blink, tiny) {
  const open = 1 - blink * 0.92;
  const lash = `<path d="M-17-11Q0-25 17-11" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/><path d="${x < 0 ? "M-17-11L-22-5" : "M17-11L22-5"}" stroke="${C.line}" stroke-width="3.6" stroke-linecap="round"/>`;
  if (blink > 0.72) return `<path d="M${x - 16} ${EYE_Y + 3}Q${x} ${EYE_Y + 12} ${x + 16} ${EYE_Y + 3}" fill="none" stroke="${C.line}" stroke-width="4.6" stroke-linecap="round"/>`;
  const iris = tiny
    ? `<circle cx="${lx}" cy="${ly}" r="5" fill="${C.line}"/>`
    : `<ellipse cx="${lx}" cy="${ly}" rx="12" ry="15.5" fill="url(#iris)" stroke="${C.line}" stroke-width="1.8"/><ellipse cx="${lx}" cy="${ly + 1}" rx="6.2" ry="9" fill="${C.dark}"/><circle cx="${lx - 4.6}" cy="${ly - 7}" r="5" fill="#fff"/><circle cx="${lx + 5}" cy="${ly + 6}" r="2.6" fill="#fff"/><circle cx="${lx - 5}" cy="${ly + 8}" r="1.5" fill="#fff"/>`;
  return `<g transform="translate(${x} ${EYE_Y}) scale(1 ${open})"><ellipse rx="15" ry="18" fill="#fff"/>${iris}${lash}</g>`;
}

function eyes(o) {
  const mode = o.eyes ?? "normal";
  const lx = o.lx ?? 0;
  const ly = o.ly ?? 0;
  if (mode === "happy") return EYES.map((x) => `<path d="M${x - 15} ${EYE_Y + 6}Q${x} ${EYE_Y - 15} ${x + 15} ${EYE_Y + 6}" fill="none" stroke="${C.line}" stroke-width="5.4" stroke-linecap="round"/>`).join("");
  if (mode === "shock") return EYES.map((x) => openEye(x, 0, 0, 0, true)).join("");
  let out = EYES.map((x) => openEye(x, lx, ly, o.blink ?? 0, false)).join("");
  if (mode === "sad") {
    out += EYES.map((x) => `<ellipse cx="${x}" cy="${EYE_Y + 15}" rx="12" ry="4.4" fill="${C.ice}"/>`).join("");
  }
  if (mode === "stern" || mode === "shifty") {
    // Eyelids half closed, for a sideways or stern look.
    out += EYES.map((x) => `<path d="M${x - 18} ${EYE_Y - 20}H${x + 18}V${EYE_Y - 4}H${x - 18}Z" fill="${C.skin}"/><path d="M${x - 18} ${EYE_Y - 4}H${x + 18}" stroke="${C.line}" stroke-width="4.4" stroke-linecap="round"/>`).join("");
  }
  return out;
}

function brows(o) {
  const mode = o.eyes ?? "normal";
  const tilt = mode === "stern" ? 16 : mode === "sad" || mode === "shock" ? -16 : 0;
  if (!tilt) return "";
  return EYES.map((x) => `<path transform="translate(${x} ${EYE_Y - 25}) rotate(${x < 0 ? tilt : -tilt})" d="M-12 0H12" stroke="${C.line}" stroke-width="4.4" stroke-linecap="round"/>`).join("");
}

function mouth(kind) {
  const y = -72;
  const stroke = `fill="none" stroke="${C.line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "open") return `<path d="M-9 ${y - 3}H9Q8 ${y + 10} 0 ${y + 10}Q-8 ${y + 10} -9 ${y - 3}Z" fill="#b5304a" stroke="${C.line}" stroke-width="2.6" stroke-linejoin="round"/><ellipse cx="0" cy="${y + 6.6}" rx="5" ry="3" fill="#ff8aa0"/>`;
  if (kind === "scream") return `<ellipse cy="${y + 2}" rx="11" ry="10" fill="#b5304a" stroke="${C.line}" stroke-width="2.6"/><path d="M-8 ${y - 4}H8" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>`;
  if (kind === "o") return `<ellipse cy="${y}" rx="4.4" ry="5" fill="#b5304a" stroke="${C.line}" stroke-width="2.6"/>`;
  if (kind === "cat") return `<path d="M-10 ${y - 2}Q-5 ${y + 6} 0 ${y - 2}Q5 ${y + 6} 10 ${y - 2}" ${stroke}/>`;
  if (kind === "sad") return `<path d="M-7 ${y + 4}Q0 ${y - 5} 7 ${y + 4}" ${stroke}/>`;
  if (kind === "wavy") return `<path d="M-12 ${y + 1}L-7 ${y - 3}L-2 ${y + 2}L3 ${y - 3}L8 ${y + 2}L12 ${y - 2}" ${stroke}/>`;
  if (kind === "grit") return `<rect x="-11" y="${y - 5}" width="22" height="10" rx="3" fill="#fff" stroke="${C.line}" stroke-width="2.6"/><path d="M-4 ${y - 5}v10M4 ${y - 5}v10" stroke="${C.line}" stroke-width="1.8"/>`;
  return `<path d="M-7 ${y - 2}Q0 ${y + 6} 7 ${y - 2}" ${stroke}/>`;
}

// --- Body ---
function limb(side, tx, ty) {
  const sx = side * 26;
  const sy = -60;
  const midX = (sx + tx) / 2 + side * 6;
  const midY = (sy + ty) / 2 + 4;
  const d = `M${sx} ${sy}Q${midX} ${midY} ${tx} ${ty}`;
  return `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="17" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${C.hood}" stroke-width="11" stroke-linecap="round"/><circle cx="${tx}" cy="${ty}" r="8" fill="${C.skin}" stroke="${C.line}" stroke-width="3"/>`;
}

function leg(side, lift) {
  const x = side * 13;
  return `<path d="M${x} -26V${-6 - lift}" stroke="${C.line}" stroke-width="16" stroke-linecap="round"/><path d="M${x} -26V${-6 - lift}" stroke="${C.pants}" stroke-width="10" stroke-linecap="round"/><ellipse cx="${x + side * 2}" cy="${-5 - lift}" rx="14" ry="8" fill="${C.shoe}" stroke="${C.line}" stroke-width="3"/><path d="M${x - 10 + side * 2} ${-3 - lift}H${x + 10 + side * 2}" stroke="${C.shoeDk}" stroke-width="2.4" stroke-linecap="round"/>`;
}

function torso() {
  return `<path d="M-29-67Q-36-42-33-20H33Q36-42 29-67Q0-76-29-67Z" fill="${C.hood}" stroke="${C.line}" stroke-width="3.6" stroke-linejoin="round"/><path d="M-32-28H32" stroke="${C.hoodDk}" stroke-width="4"/><circle cy="-44" r="12" fill="${C.trim}" stroke="${C.line}" stroke-width="2.6"/><path d="M0-52V-36M-8-44H8" stroke="${C.hoodDk}" stroke-width="2.6" stroke-linecap="round"/><circle cy="-44" r="3.2" fill="${C.hoodDk}"/>`;
}

const HAIR_BACK = "M-62-118C-66-178 66-178 62-118C66-92 62-70 54-56L42-72L34-58H-34L-42-72L-54-56C-62-70-66-92-62-118Z";
const HEAD = "M-54-118C-54-160 54-160 54-118C54-90 32-66 0-63C-32-66-54-90-54-118Z";
const BANGS = "M-58-110C-62-172 62-172 58-110L53-86L46-119L33-106L27-130L10-110L1-134L-11-110L-27-130L-33-106L-46-119L-53-86Z";
const MASK = "M-53-116Q0-126 53-116L51-86Q30-74 0-90Q-30-74-51-86ZM-41-96A17 15 0 0 0-7-96A17 15 0 0 0-41-96ZM7-96A17 15 0 0 0 41-96A17 15 0 0 0 7-96Z";

function character(o) {
  const lift = o.legs ?? [0, 0];
  const sway = o.ahoge ?? 0;
  const ahoge = o.spring
    ? "M2-160L12-172L-4-180L12-190L0-199"
    : `M2-160Q${9 + sway} -190 ${28 + sway * 2} -186`;
  const left = limb(-1, o.handL?.[0] ?? -36, o.handL?.[1] ?? -28);
  const right = limb(1, o.handR?.[0] ?? 36, o.handR?.[1] ?? -28);
  const blush = o.noBlush ? "" : [-37, 37].map((x) => `<ellipse cx="${x}" cy="-81" rx="10" ry="5" fill="${C.blush}" opacity="0.75"/>`).join("");
  return `
    ${o.behind ?? ""}
    <path d="${HAIR_BACK}" fill="${C.hairDk}" stroke="${C.line}" stroke-width="3.6" stroke-linejoin="round"/>
    ${leg(-1, lift[0])}${leg(1, lift[1])}
    ${o.armsFront ? "" : left + right}
    ${torso()}
    <g transform="translate(0 -66) rotate(${o.headTilt ?? 0}) translate(0 66)">
      <path d="${HEAD}" fill="${C.skin}" stroke="${C.line}" stroke-width="3.6" stroke-linejoin="round"/>
      <path d="M-46-96C-42-76-20-68 0-66C20-68 42-76 46-96C40-84 20-76 0-75C-20-76-40-84-46-96Z" fill="${C.skinDk}" opacity="0.55"/>
      ${blush}
      ${eyes(o)}
      ${mouth(o.mouth ?? "smile")}
      ${o.mask ? `<path d="${MASK}" fill="${C.dark}" fill-rule="evenodd" stroke="${C.line}" stroke-width="2"/>` : ""}
      <path d="${ahoge}" fill="none" stroke="${C.line}" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${ahoge}" fill="none" stroke="${C.hair}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${BANGS}" fill="${C.hair}" stroke="${C.line}" stroke-width="3.6" stroke-linejoin="round"/>
      <path d="M-40-143Q-20-158 0-156M12-156Q30-154 40-142" fill="none" stroke="${C.hairHi}" stroke-width="6" stroke-linecap="round"/>
      ${brows(o)}
      ${wheelClip(o.wheel ?? 0)}
      ${o.head ?? ""}
    </g>
    ${o.armsFront ? left + right : ""}
    ${o.front ?? ""}`;
}

function scene(o) {
  const k = o.k ?? 1;
  const inner = character(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <defs><linearGradient id="iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b30c4"/><stop offset="0.55" stop-color="#6a5cff"/><stop offset="1" stop-color="#46e0cf"/></linearGradient></defs>
    ${o.back ?? ""}
    <g transform="translate(${120 + (o.x ?? 0)} ${224 + (o.y ?? 0)}) rotate(${o.rot ?? 0}) scale(${k * (o.sx ?? 1)} ${k * (o.sy ?? 1)})">${inner}</g>
    ${o.over ?? ""}
  </svg>`;
}

// --- Each action ---
const STATES = {
  idle: { seconds: 2, draw: (t) => scene({ sy: 1 + 0.014 * wave(t), sx: 1 - 0.014 * wave(t), blink: Math.max(pulse(t, 0.35), pulse(t, 0.47)), ahoge: 4 * wave(t), wheel: 360 * t, handL: [-37, -29 + 1.5 * wave(t)], handR: [37, -29 + 1.5 * wave(t)] }) },

  wave: { seconds: 1.2, draw: (t) => {
    const a = wave(t, 2);
    return scene({ k: 0.94, y: -5 * up(t, 2), rot: 2 * wave(t), headTilt: 4 * a, ahoge: 8 * a, wheel: 360 * t, mouth: "open", blink: pulse(t, 0.8), handL: [-37, -30], handR: [68 + 15 * a, -128 - 6 * Math.abs(a)], over: sparkle(214, 58 + 5 * a, 8 + 4 * up(t, 2)) + sparkle(30, 84, 5 * up(t, 2, 0.5)) });
  } },

  sad: { seconds: 1.6, draw: (t) => {
    const drops = [-68, -36, 6, 44, 74].map((x, i) => `<path d="M${120 + x} ${40 + frac(t * 2 + i * 0.37) * 170}v12" stroke="${C.iceDk}" stroke-width="3.4" stroke-linecap="round"/>`).join("");
    const cloud = `<g transform="translate(${120 + 5 * wave(t)} 26)"><path d="M-54 14C-70 14-72-8-52-10C-52-30-20-32-12-16C0-34 34-30 34-10C60-14 66 14 46 14Z" fill="#b9b8dc" stroke="${C.line}" stroke-width="3.4" stroke-linejoin="round"/></g>`;
    const tears = [-24, 24].map((x) => {
      const p = frac(t * 3);
      return `<path d="M${x - 5} -82V${-72 + p * 24}M${x + 3} -82V${-76 + frac(t * 3 + 0.5) * 24}" stroke="${C.ice}" stroke-width="6" stroke-linecap="round"/>`;
    }).join("");
    return scene({ k: 0.8, y: 1.6 * wave(t, 4), eyes: "sad", mouth: "wavy", ahoge: -9, handL: [-30, -26 + 2 * wave(t, 4)], handR: [30, -26 + 2 * wave(t, 4)], head: tears + gloom(-16, -152), back: drops, over: cloud });
  } },

  sneak: { seconds: 1.6, draw: (t) => {
    const s = wave(t);
    return scene({ k: 0.9, x: 13 * s, y: -5 * up(t, 2), rot: 4 * Math.cos(TAU * t), legs: [Math.max(0, wave(t, 2)) * 11, Math.max(0, -wave(t, 2)) * 11], mask: true, eyes: "shifty", lx: 7 * Math.sign(s) * Math.min(1, Math.abs(s) * 3), mouth: "cat", ahoge: 6 * s, handL: [-36, -30], handR: [62, -100], behind: sack(74, -130, 1.3, 14), head: sweat(58, -128 - 6 * frac(t * 2), 0.8) });
  } },

  alarm: { seconds: 0.8, draw: (t) => {
    const on = frac(t * 2) < 0.5;
    const flail = wave(t, 2);
    const rays = (on ? [-1] : [1]).map((d) => `<path d="M${d * 26} -196L${d * 52} -212M${d * 28} -180L${d * 56} -180M${d * 26} -166L${d * 50} -152" stroke="#ffd34d" stroke-width="5" stroke-linecap="round"/>`).join("");
    const siren = `<rect x="-22" y="-168" width="44" height="10" rx="3" fill="${C.shoeDk}" stroke="${C.line}" stroke-width="3"/><path d="M-17-168V-182A17 17 0 0 1 17-182V-168Z" fill="${on ? C.red : "#ffb3bc"}" stroke="${C.line}" stroke-width="3.4" stroke-linejoin="round"/>${rays}`;
    return scene({ k: 0.82, x: 3.5 * wave(t, 4), eyes: "shock", mouth: "scream", spring: true, handL: [-58 - 8 * flail, -118 + 18 * flail], handR: [58 + 8 * flail, -118 - 18 * flail], legs: [up(t, 2) * 8, up(t, 2, 0.5) * 8], noBlush: true, head: siren + gloom(-16, -146) + sweat(-58, -118 - 10 * frac(t * 2), 0.9), over: exclaim(on ? 26 : 214, 92, 1.1 + 0.25 * up(t, 2)) });
  } },

  look: { seconds: 2, draw: (t) => {
    const s = wave(t);
    const cx = 22 + 26 * s;
    const lens = `<path d="M${cx + 16} -74L${cx + 30} -48" stroke="${C.line}" stroke-width="12" stroke-linecap="round"/><path d="M${cx + 16} -74L${cx + 30} -48" stroke="#b8763a" stroke-width="6.5" stroke-linecap="round"/><circle cx="${cx}" cy="-98" r="30" fill="#bfeaff" fill-opacity="0.32" stroke="${C.line}" stroke-width="8.5"/><circle cx="${cx}" cy="-98" r="30" fill="none" stroke="${C.gold}" stroke-width="4"/><path d="M${cx - 17} -108Q${cx - 13} -119 ${cx - 2} -122" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
    return scene({ k: 0.92, lx: 6 * s, ly: -1, blink: pulse(t, 0.62), mouth: "o", headTilt: 5 * s, ahoge: 6 * s, wheel: 180 * t, handL: [-37, -30], handR: [cx + 30, -46], armsFront: true, front: lens, over: `<text x="${200}" y="${62 + 4 * wave(t, 2)}" font-family="Arial, sans-serif" font-weight="700" font-size="34" fill="${C.gold}" stroke="${C.line}" stroke-width="2" paint-order="stroke">?</text>` });
  } },

  write: { seconds: 2, draw: (t) => {
    const lines = [0, 1, 2, 3];
    const y = (i) => -112 + i * 18;
    const progress = t * 4;
    const current = Math.min(3, Math.floor(progress));
    const part = progress - current;
    const scribble = lines.map((i) => (i > current ? "" : `<path d="M58 ${y(i)}h${(i === current ? part : 1) * 58}" stroke="#7b78b8" stroke-width="4" stroke-linecap="round"/>`)).join("");
    const tipX = 58 + part * 58;
    const tipY = y(current) + 2 * wave(t, 12);
    const paper = `<g transform="rotate(-3 87 -80)"><rect x="46" y="-132" width="82" height="112" rx="5" fill="#fff" stroke="${C.line}" stroke-width="3.6"/><path d="M46-124H128" stroke="${C.red}" stroke-width="3" opacity="0.5"/>${scribble}</g>`;
    const quill = `<path d="M${tipX} ${tipY}L${tipX + 32} ${tipY - 44}" stroke="${C.line}" stroke-width="3"/><path d="M${tipX + 10} ${tipY - 14}C${tipX + 6} ${tipY - 42} ${tipX + 28} ${tipY - 58} ${tipX + 46} ${tipY - 64}C${tipX + 46} ${tipY - 40} ${tipX + 34} ${tipY - 16} ${tipX + 10} ${tipY - 14}Z" fill="${C.ice}" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/>`;
    return scene({ k: 0.82, x: -38, lx: 8, ly: 5, mouth: "cat", blink: pulse(t, 0.45), headTilt: 4, ahoge: 5 * wave(t), handL: [-37, -30], handR: [tipX + 8, tipY - 6], armsFront: true, back: "", behind: "", front: paper + limbFront(tipX + 8, tipY - 6) + quill });
  } },

  stamp: { seconds: 1.4, draw: (t) => {
    const lifted = t < 0.5 ? 48 * Math.sin((t / 0.5) * (Math.PI / 2)) : t < 0.58 ? 48 * (1 - (t - 0.5) / 0.08) : t < 0.72 ? 0 : 34 * Math.sin(((t - 0.72) / 0.28) * (Math.PI / 2)) * (1 - 0.0);
    const hit = pulse(t, 0.6, 0.08);
    const done = t >= 0.56;
    const px = 86;
    const py = -36;
    const seal = done ? `<circle cx="${px}" cy="${py}" r="20" fill="${C.green}" stroke="${C.greenDk}" stroke-width="3"/><path d="M${px - 9} ${py}l7 8 13-15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${px - 22} ${py - 8}h44M${px - 22} ${py + 6}h30" stroke="#b5b3d6" stroke-width="4" stroke-linecap="round"/>`;
    const paper = `<rect x="44" y="-66" width="84" height="60" rx="5" fill="#fff" stroke="${C.line}" stroke-width="3.6"/>${seal}`;
    const y = py - 34 - lifted;
    const stampArt = `<g><rect x="${px - 24}" y="${y + 18}" width="48" height="13" rx="3" fill="${C.red}" stroke="${C.line}" stroke-width="3.4"/><path d="M${px - 8} ${y + 18}V${y}H${px + 8}V${y + 18}Z" fill="#b8763a" stroke="${C.line}" stroke-width="3.2"/><circle cx="${px}" cy="${y - 7}" r="11" fill="#b8763a" stroke="${C.line}" stroke-width="3.2"/></g>`;
    const burst = hit > 0 ? [-1, 1].map((d) => `<path d="M${px + d * 36} -22l${d * 14} -8M${px + d * 38} -8h${d * 15}" stroke="${C.gold}" stroke-width="4.4" stroke-linecap="round"/>`).join("") : "";
    return scene({ k: 0.82, x: -38, sy: 1 - hit * 0.04, eyes: done ? "happy" : "normal", lx: 8, ly: 4, mouth: done ? "open" : "cat", ahoge: 10 * hit - 3, wheel: done ? 360 * t : 0, handL: [-37, -30], handR: [px - 2, y + 8], armsFront: true, front: paper + stampArt + burst + limbFront(px - 2, y + 8) });
  } },

  split: { seconds: 1.6, draw: (t) => {
    const path = (p, d) => {
      const a = (1 - p) * (1 - p);
      const b = 2 * (1 - p) * p;
      const c = p * p;
      return [a * 0 + b * d * 104 + c * d * 108, a * -216 + b * -262 + c * -20];
    };
    const items = ring(0, 3).map((i) => {
      const p = frac(t * 1 + i / 3);
      const [gx, gy] = path(p, -1);
      const [bx, by] = path(frac(p + 0.17), 1);
      return coin(gx, gy, 13, Math.cos(TAU * p * 2)) + bill(bx, by, 25 * wave(p), 0.82);
    }).join("");
    const coins = [0, 1, 2].map((i) => `<ellipse cx="-104" cy="${-8 - i * 10}" rx="24" ry="9" fill="${C.gold}" stroke="${C.goldDk}" stroke-width="3"/>`).join("");
    const bills = [0, 1, 2].map((i) => bill(104, -12 - i * 11, i % 2 ? 3 : -3, 1.05)).join("");
    const look = wave(t, 2);
    return scene({ k: 0.78, y: -3 * up(t, 2), lx: 9 * look, mouth: "open", headTilt: 5 * look, ahoge: 7 * look, wheel: 360 * t, handL: [-38 - 4 * look, -122 + 6 * look], handR: [38 - 4 * look, -122 - 6 * look], behind: coins + bills, front: items });
  } },

  cheer: { seconds: 1, draw: (t) => {
    const jump = up(t);
    const land = Math.max(0, 1 - jump * 3.5);
    const a = wave(t, 2);
    const rain = [18, 58, 96, 140, 180, 222].map((x, i) => {
      const p = frac(t + i * 0.27);
      const y = -14 + p * 262;
      return i % 2 ? coin(x, y, 10, Math.cos(TAU * (p * 2 + i * 0.2))) : bill(x, y, 180 * p + i * 30, 0.62);
    }).join("");
    return scene({ k: 0.86, y: -24 * jump, sy: 1 - land * 0.07, sx: 1 + land * 0.06, eyes: "happy", mouth: "open", ahoge: 12 * a, wheel: 1080 * t, handL: [-60 - 7 * a, -126 + 8 * a], handR: [60 + 7 * a, -126 - 8 * a], legs: [jump * 9, jump * 9], back: rain, over: sparkle(204, 104, 10 * up(t, 2)) + sparkle(36, 72, 10 * up(t, 2, 0.5)) });
  } },

  wait: { seconds: 2, draw: (t) => {
    const stack = [0, 1, 2, 3].map((i) => `<g transform="translate(0 ${-11 - i * 13})"><rect x="-66" y="-7" width="132" height="14" rx="3" fill="${i % 2 ? "#26c28c" : C.green}" stroke="${C.greenDk}" stroke-width="2.8"/><circle r="4.4" fill="${C.greenDk}"/></g>`).join("");
    const angle = 360 * t;
    const bubble = `<circle cx="204" cy="42" r="28" fill="#fff" stroke="${C.line}" stroke-width="3.2"/><path d="M204 42V24" stroke="${C.line}" stroke-width="4" stroke-linecap="round" transform="rotate(${angle} 204 42)"/><path d="M204 42H217" stroke="${C.red}" stroke-width="4" stroke-linecap="round"/><circle cx="204" cy="42" r="3.4" fill="${C.line}"/><circle cx="172" cy="82" r="6.5" fill="#fff" stroke="${C.line}" stroke-width="2.8"/><circle cx="160" cy="98" r="3.8" fill="#fff" stroke="${C.line}" stroke-width="2.4"/>`;
    const swing = wave(t, 2);
    const scale = 0.76;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
      <defs><linearGradient id="iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b30c4"/><stop offset="0.55" stop-color="#6a5cff"/><stop offset="1" stop-color="#46e0cf"/></linearGradient></defs>
      <g transform="translate(108 232) scale(1.02)">${stack}</g>
      <g transform="translate(108 ${197 + 1.2 * wave(t)}) scale(${scale})">${character({ lx: 7, ly: -7, blink: pulse(t, 0.3), mouth: "cat", ahoge: 5 * wave(t), wheel: 90 * t, handL: [-34, -24], handR: [34, -24], legs: [Math.max(0, swing) * 8, Math.max(0, -swing) * 8] })}</g>
      ${bubble}
    </svg>`;
  } },

  stop: { seconds: 1.2, draw: (t) => {
    const a = wave(t, 2);
    const sign = `<g transform="translate(112 -86) rotate(${5 * a})"><path d="M-5 -30V76" stroke="${C.line}" stroke-width="11"/><path d="M-5 -30V76" stroke="#d8d7ee" stroke-width="5.4"/><path d="M-18-74H12L34-52V-22L12 0H-18L-40-22V-52Z" fill="${C.red}" stroke="${C.line}" stroke-width="4" stroke-linejoin="round"/><path d="M-15-67H9L27-49V-25L9-7H-15L-33-25V-49Z" fill="none" stroke="#fff" stroke-width="3"/><text x="-3" y="-30" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="21" fill="#fff">STOP</text></g>`;
    return scene({ k: 0.78, x: -40, eyes: "stern", mouth: "grit", headTilt: 3 * a, ahoge: 6 * a, handL: [-58, -80 + 3 * a], handR: [106, -32], armsFront: true, behind: sign, head: vein(46, -150, 0.9 + 0.3 * up(t, 2)) });
  } },

  travel: { seconds: 1.2, draw: (t) => {
    const a = wave(t, 2);
    const flame = (x) => `<path d="M${x - 10} -2Q${x} ${28 + 12 * up(t, 3)} ${x + 10} -2Z" fill="#ff8a3d" stroke="${C.line}" stroke-width="2.6" stroke-linejoin="round"/><path d="M${x - 5} -2Q${x} ${13 + 7 * up(t, 3, 0.3)} ${x + 5} -2Z" fill="#ffe27a"/>`;
    const lines = [40, 86, 132, 178].map((y, i) => {
      const p = frac(t * 2 + i * 0.3);
      const x = 230 - p * 260;
      return `<path d="M${x} ${y}h${34 + i * 5}" stroke="#8d8ad6" stroke-width="3.6" stroke-linecap="round"/>`;
    }).join("");
    const trail = [0, 1, 2].map((i) => {
      const p = frac(t + i / 3);
      return sparkle(70 - p * 66, 54 + i * 26 + 5 * wave(p), 7 * (1 - p), C.gold);
    }).join("");
    return scene({ k: 0.74, x: 12, y: -22 + 8 * a, rot: 15, eyes: "happy", mouth: "open", ahoge: -14 + 4 * a, wheel: 720 * t, legs: [5, 5], handL: [-52, -46], handR: [34, -196], behind: flame(-13) + flame(13), front: coin(40, -222, 22, Math.cos(TAU * t)), back: lines + trail });
  } },

  redeem: { seconds: 1.6, draw: (t) => {
    const a = wave(t);
    const halo = `<ellipse cx="0" cy="${-212 + 4 * a}" rx="36" ry="10" fill="none" stroke="${C.line}" stroke-width="9"/><ellipse cx="0" cy="${-212 + 4 * a}" rx="36" ry="10" fill="none" stroke="${C.gold}" stroke-width="5"/>`;
    const lifted = `<g transform="translate(0 -76) scale(0.62)"><path d="${MASK}" fill="${C.dark}" fill-rule="evenodd" stroke="${C.line}" stroke-width="2.4"/></g>`;
    const hearts = [0, 1].map((i) => {
      const p = frac(t + i / 2);
      return heart(i ? 208 : 34, 150 - p * 100, 1.1 * Math.sin(Math.PI * p));
    }).join("");
    return scene({ k: 0.82, y: -3 * up(t), eyes: "happy", mouth: "smile", ahoge: 5 * a, wheel: 120 * t, handL: [-30, -36 + 3 * a], handR: [30, -36 + 3 * a], head: lifted, armsFront: true, front: halo + sack(0, -22 + 3 * a, 1.05) + limbsOver(-30, -36 + 3 * a) + limbsOver(30, -36 + 3 * a), over: hearts });
  } },
};

// The hand drawn over the prop it holds.
function limbFront(x, y) {
  return `<circle cx="${x}" cy="${y}" r="8" fill="${C.skin}" stroke="${C.line}" stroke-width="3"/>`;
}
const limbsOver = limbFront;

// This runs in the browser; render.mjs calls it through window.
window.PAX = { STATES, render: (name, t) => STATES[name].draw(t) };
