// A hand-drawn icon set with one stroke style, inlined so no extra library loads.
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const Bars = (p: P) => <Icon {...p}><path d="M5 20v-7M12 20V5M19 20v-10" /></Icon>;
export const Coins = (p: P) => <Icon {...p}><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></Icon>;
export const Dots = (p: P) => <Icon {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>;
export const User = (p: P) => <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-4.2 4.2-6 8-6s6.8 1.8 8 6" /></Icon>;
export const Search = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const Cases = (p: P) => <Icon {...p}><path d="M4 7h6l2 2h8v10H4z" /></Icon>;
export const Radar = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 12 18 6" /></Icon>;
export const Pulse = (p: P) => <Icon {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6h5" /></Icon>;
export const Wallet = (p: P) => <Icon {...p}><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H18v3" /><path d="M4 7.5V18h16V9H5.5A1.5 1.5 0 0 1 4 7.5Z" /><circle cx="16" cy="13.5" r="1" /></Icon>;
export const Book = (p: P) => <Icon {...p}><path d="M6 4h12v16H7.5A1.5 1.5 0 0 1 6 18.5z" /><path d="M6 17.5A1.5 1.5 0 0 1 7.5 16H18" /></Icon>;
export const Help = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8" /><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4 1c0 1.6-2.2 1.9-2.2 3.2" /><path d="M12 16.8v.01" /></Icon>;
export const Menu = (p: P) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const Close = (p: P) => <Icon {...p}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const Copy = (p: P) => <Icon width="14" height="14" {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></Icon>;
export const Check = (p: P) => <Icon width="14" height="14" {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Icon>;
export const Chevron = (p: P) => <Icon width="14" height="14" {...p}><path d="m7 10 5 5 5-5" /></Icon>;
export const Arrow = (p: P) => <Icon width="16" height="16" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const ExternalLink = (p: P) => <Icon width="13" height="13" {...p}><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 14v5H5V6h5" /></Icon>;
export const Panel = (p: P) => <Icon {...p}><rect x="4" y="5" width="16" height="14" rx="2.5" /><path d="M10 5v14" /></Icon>;
export const Shield = (p: P) => <Icon {...p}><path d="M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" /></Icon>;
export const Clock = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></Icon>;
export const Split = (p: P) => <Icon {...p}><path d="M3 12h7" /><path d="M10 12c3 0 3-6 7-6h4" /><path d="M10 12c3 0 3 6 7 6h4" /></Icon>;
export const Lock = (p: P) => <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
