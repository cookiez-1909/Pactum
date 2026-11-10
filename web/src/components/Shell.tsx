// The app frame: a left sidebar with the product name and stacked sections, and a top bar with the wallet and the testnet notice.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../appdata";
import { timeLeft } from "../format";
import { currentOffer, incidentStatus, rankIncidents } from "../useDesk";
import { identify, nearName, roleHint } from "../labels";
import { useWallet, WalletMenu } from "../wallet";
import { AssetIcon } from "./case-bits";
import { Party, RoleTag } from "./Party";
import { ThemeToggle } from "./ThemeToggle";
import { Bars, Book, Cases, Chevron, Close, Coins, Dots, Help, Menu, Panel, Pulse, Radar, Search, Shield, User, Wallet } from "./icons";

const NAV = [
  { href: "#/cases", label: "Cases", icon: Cases, match: ["cases", "case"] },
  { href: "#/tracker", label: "Hack tracker", icon: Radar, match: ["tracker"] },
  { href: "#/activity", label: "Activity", icon: Pulse, match: ["activity"] },
  { href: "#/wallet", label: "My wallet", icon: Wallet, match: ["wallet"] },
  { href: "#/profile", label: "Profile", icon: User, match: ["profile"] },
  { href: "#/guardians", label: "Guardians", icon: Shield, match: ["guardians"] },
];

const MORE = [
  { href: "#/stats", label: "Stats", icon: Bars, page: "stats" },
  { href: "#/stake", label: "Stake", icon: Coins, page: "stake" },
];

export function Shell({ page, caseId, children }: { page: string; caseId: string | null; children: ReactNode }) {
  const { deployment, desk } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inMore = MORE.some((item) => item.page === page);
  const [moreOpen, setMoreOpen] = useState(inMore);
  // Opening a page under More expands it, so users see where they are.
  useEffect(() => {
    if (inMore) setMoreOpen(true);
  }, [inMore]);
  const ranked = useMemo(() => rankIncidents(desk.incidents, desk.states), [desk.incidents, desk.states]);

  useEffect(() => setDrawer(false), [page, caseId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const network = deployment.network === "local" ? "Local Anvil, simulated controller" : "Three EVM testnets and NEAR testnet";

  return (
    <div className={collapsed ? "shell is-collapsed" : "shell"}>
      <aside className={drawer ? "sidebar is-open" : "sidebar"} aria-label="Main">
        <div className="sidebar-top">
          <a className="brand" href="#/" aria-label="Pactum home">
            <span className="brand-name">Pactum</span>
            <span className="brand-initial" aria-hidden="true">P</span>
          </a>
          <button type="button" className="icon-button sidebar-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>
            <Panel />
          </button>
          <button type="button" className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setDrawer(false)}>
            <Close />
          </button>
        </div>

        <nav className="side-nav" aria-label="Sections">
          <button type="button" className="side-link" onClick={() => setPaletteOpen(true)}>
            <Search /><span className="side-label">Search</span><kbd className="side-kbd">⌘K</kbd>
          </button>
          {NAV.map(({ href, label, icon: IconComponent, match }) => (
            <a key={href} href={href} className={match.includes(page) ? "side-link is-active" : "side-link"} aria-current={match.includes(page) ? "page" : undefined}>
              <IconComponent /><span className="side-label">{label}</span>
            </a>
          ))}
          <button type="button" className="side-link side-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
            <Dots /><span className="side-label">More</span><Chevron className={moreOpen ? "side-chevron is-open" : "side-chevron"} />
          </button>
          {moreOpen && MORE.map(({ href, label, icon: IconComponent, page: target }) => (
            <a key={href} href={href} className={page === target ? "side-link side-sub is-active" : "side-link side-sub"} aria-current={page === target ? "page" : undefined}>
              <IconComponent /><span className="side-label">{label}</span>
            </a>
          ))}
        </nav>

        <div className="side-section">
          <p className="side-heading">Cases</p>
          <ul className="side-cases">
            {ranked.map((incident) => {
              const status = incidentStatus(incident, desk.states);
              const offer = currentOffer(incident, desk.states);
              const urgent = offer && Number(offer.until) - desk.now / 1000 < 3600;
              const firstSymbol = incident.cases[0]?.token.symbol ?? incident.pending[0]?.token.symbol ?? "m?";
              const label = status === "Fully returned" ? "Returned" : status === "Awaiting offer" ? "No offer" : status ?? "…";
              return (
                <li key={incident.id}>
                  <a href={`#/case/${incident.id}`} className={`${caseId === incident.id ? "side-case is-active" : "side-case"} ${status === "Closed" ? "is-closed" : ""}`} title={incident.name}>
                    <AssetIcon symbol={firstSymbol} size="sm" />
                    <span className="side-case-name">{incident.name}</span>
                    {offer ? (
                      <span className={urgent ? "side-badge is-urgent" : "side-badge is-live"}>{timeLeft(offer.until, desk.now)}</span>
                    ) : (
                      <span className="side-badge">{label}</span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="sidebar-bottom">
          <a href="#/tour" className="side-link side-tour"><Radar /><span className="side-label">Take the tour</span></a>
          <a href="#/how" className={page === "how" ? "side-link is-active" : "side-link"}><Book /><span className="side-label">How it works</span></a>
          <a href="#/faq" className="side-link"><Help /><span className="side-label">FAQ</span></a>
          <p className="side-network"><span className="live-dot" aria-hidden="true" /><span className="side-label">{network}</span></p>
        </div>
      </aside>
      {drawer && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu /></button>
          <p className="testnet-note" role="note">Testnet demo. Do not send real or stolen funds.</p>
          <WalletMenu />
          <ThemeToggle />
        </header>
        {desk.error && <p className="banner-error" role="alert">Chain read failed: {desk.error}</p>}
        <ViewingStrip />
        <main className="content" key={`${page}-${caseId ?? ""}`}>{children}</main>
      </div>
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

// Always reminds the viewer which role they are in, since the same page differs by role.
function ViewingStrip() {
  const { directory } = useApp();
  const { address, readOnly, guardian } = useWallet();
  if (guardian) return <p className="viewing-strip"><strong>Viewing as</strong> {nearName(guardian.accountId)} <RoleTag role="guardian" /> You can approve or cancel offers on the Guardians page. Guardians never hold the funds.</p>;
  if (!address) return <p className="viewing-strip"><strong>You are not connected.</strong> Everything here is public, so you can read without a wallet. A wallet is only needed to send a transaction.</p>;
  return (
    <p className="viewing-strip">
      <strong>Viewing as</strong> <Party address={address} compact /> {roleHint(identify(directory, address))}
      {readOnly && <span className="viewing-readonly"> This is a view of a wallet you typed in, so it cannot send transactions.</span>}
    </p>
  );
}

function Palette({ onClose }: { onClose(): void }) {
  const { desk } = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const items = useMemo(() => {
    const pages = [
      { label: "Cases", hint: "Page", href: "#/cases" },
      { label: "Hack tracker", hint: "Page", href: "#/tracker" },
      { label: "Activity", hint: "Page", href: "#/activity" },
      { label: "My wallet", hint: "Page", href: "#/wallet" },
      { label: "Profile", hint: "Page", href: "#/profile" },
      { label: "Guardians", hint: "Page", href: "#/guardians" },
      { label: "Stats", hint: "Page", href: "#/stats" },
      { label: "Stake", hint: "Page", href: "#/stake" },
      { label: "How it works", hint: "Page", href: "#/how" },
      { label: "FAQ", hint: "Home", href: "#/faq" },
      { label: "Pactum home", hint: "Page", href: "#/" },
    ];
    const cases = desk.incidents.map((incident) => ({
      label: incident.name,
      search: [incident.name, ...incident.cases.map((info) => info.token.symbol), ...incident.pending.map((asset) => asset.token.symbol)].join(" "),
      hint: "Case",
      href: `#/case/${incident.id}`,
    }));
    const needle = query.trim().toLowerCase();
    return [...cases, ...pages.map((page) => ({ ...page, search: page.label }))].filter((item) => item.search.toLowerCase().includes(needle));
  }, [desk.incidents, query]);

  const go = (href: string) => {
    window.location.hash = href;
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search />
          <input
            ref={input}
            value={query}
            placeholder="Search protocols, assets and pages"
            aria-label="Search protocols, assets and pages"
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, items.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && items[index]) go(items[index].href);
            }}
          />
        </div>
        <ul className="palette-list">
          {items.map((item, position) => (
            <li key={item.href}>
              <button type="button" className={position === index ? "palette-item is-active" : "palette-item"} onMouseEnter={() => setIndex(position)} onClick={() => go(item.href)}>
                <span>{item.label}</span>
                <span className="palette-hint">{item.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty">Nothing matches that search.</li>}
        </ul>
      </div>
    </div>
  );
}
