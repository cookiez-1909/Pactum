import { useEffect, useState } from "react";
import { AppProvider, ToastProvider, useApp } from "./appdata";
import { normalizeDeployment, type Deployment } from "./chain";
import { Shell } from "./components/Shell";
import { markTourSeen, Tour, TourEntry, tourSeen, Welcome, type TourRole } from "./components/Tour";
import { IncidentPage, TAB_IDS, type Tab } from "./pages/IncidentPage";
import { CasesPage } from "./pages/CasesPage";
import { Guardians } from "./pages/Guardians";
import { Landing } from "./pages/Landing";
import { StakePage, StatsPage } from "./pages/More";
import { Profile } from "./pages/Profile";
import { ActivityPage, HowItWorks, MyWallet, Tracker } from "./pages/others";
import { useWallet, WalletProvider } from "./wallet";
import { startSandbox, useSandboxStatus } from "./sandbox";
import { Mascot } from "./components/Mascot";

// The hosted demo has two modes: a sandbox in the browser (default) and the real testnet case (add ?live to the address).
const LIVE = new URLSearchParams(window.location.search).has("live");

interface Route {
  page: string;
  caseId: string | null;
  tab: Tab;
  symbol: string | null;
}

// Paths look like #/case/<id>/<tab>, so the static build works without any server configuration.
function parseRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/");
  const tab = (TAB_IDS.includes(parts[2] as Tab) ? parts[2] : "incident") as Tab;
  return { page: parts[0] ?? "", caseId: parts[0] === "case" ? (parts[1] ?? null) : null, tab, symbol: parts[3] ?? null };
}

function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute());
      // Switching assets within the same tab keeps the scroll position.
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loadError, setLoadError] = useState(false);
  const sandbox = useSandboxStatus();
  // Newcomers are asked when they enter the app, not on the landing page, so they read what Pactum is first.
  const [welcome, setWelcome] = useState(() => !tourSeen());
  // Skip the question if a role was already picked on the home page or the tour link was opened directly.
  const choseRole = route.page === "start" || route.page === "tour";
  useEffect(() => {
    if (!choseRole) return;
    markTourSeen();
    setWelcome(false);
  }, [choseRole]);
  const greeting = welcome && !choseRole && route.page !== "" && route.page !== "faq" ? <Welcome onClose={() => setWelcome(false)} /> : null;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // The dev server can start before the seed script finishes, so retry until the file exists.
    const load = async () => {
      try {
        const response = await fetch(LIVE ? "./live.json" : "./deployment.json", { cache: "no-store" });
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("missing");
        const data = normalizeDeployment((await response.json()) as Record<string, unknown>);
        // Start building the sandbox chain at once, even while the visitor is still reading the landing page.
        if (data.sandbox) startSandbox();
        if (!cancelled) setDeployment(data);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          timer = window.setTimeout(load, 2000);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // The landing page needs no chain data, so it shows immediately. The FAQ is the end of this page.
  if (route.page === "" || route.page === "faq") return <Landing anchor={route.page === "faq" ? "faq" : undefined} />;

  if (deployment?.sandbox && !sandbox.ready) {
    const percent = sandbox.total ? Math.round((sandbox.done / sandbox.total) * 100) : 0;
    return (
      <div className="loading-screen sandbox-loading">
        <Mascot action="wait" size={140} />
        <span className="brand-name">Pactum</span>
        <p>{sandbox.error ? `The sandbox could not start: ${sandbox.error}` : "Building your own test chain in this browser…"}</p>
        <div className="sandbox-meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percent}%` }} /></div>
        <p className="muted small">Replaying {sandbox.total || "the"} blocks of demo history. Nothing leaves your browser.</p>
        <a href="?live#/cases">Or see the live testnet case</a>
        {greeting}
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="loading-screen">
        <span className="brand-name">Pactum</span>
        <p>{loadError ? "Waiting for a deployment. Run: make web-local" : "Loading…"}</p>
        <a href="#/">Back to home</a>
        {greeting}
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppProvider deployment={deployment}>
        <WalletProvider deployment={deployment}>
          <Routed route={route} />
          {greeting}
        </WalletProvider>
      </AppProvider>
    </ToastProvider>
  );
}

// An entry point for newcomers: pick the right role and go to the right page, instead of making them search.
function Start({ kind }: { kind: string }) {
  const { desk } = useApp();
  const { personas, select } = useWallet();
  useEffect(() => {
    const name = kind === "lost" ? "User 1" : kind === "holding" ? "Hacker" : kind === "team" ? "Protocol owner" : null;
    const persona = personas.find((item) => item.name === name);
    if (persona) select(persona);
    if (kind === "lost" || kind === "holding") window.location.replace("#/wallet");
    else if (kind === "team") {
      const open = desk.incidents.find((incident) => incident.cases.length === 0);
      window.location.replace(open ? `#/case/${open.id}/offer` : "#/cases");
    } else window.location.replace("#/cases");
    // Runs only once when this page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="page"><p className="empty">Taking you there…</p></div>;
}

function Routed({ route }: { route: Route }) {
  const { desk } = useApp();
  const incident = desk.incidents.find((item) => item.id === route.caseId);
  const [tour, setTour] = useState<TourRole | null>(null);
  return (
    <>
    {/* Outside the Shell, because the Shell's content is rebuilt on every page change. */}
    {tour && desk.loaded && <Tour key={tour} role={tour} onClose={() => setTour(null)} />}
    <Shell page={route.page} caseId={route.caseId}>
      {route.page === "tour" && <TourEntry role={window.location.hash.split("/")[2]} onStart={setTour} />}
      {route.page === "start" && <Start kind={window.location.hash.split("/")[2] ?? "explore"} />}
      {route.page === "cases" && <CasesPage />}
      {route.page === "tracker" && <Tracker />}
      {route.page === "activity" && <ActivityPage />}
      {route.page === "wallet" && <MyWallet />}
      {route.page === "profile" && <Profile />}
      {route.page === "stats" && <StatsPage />}
      {route.page === "stake" && <StakePage />}
      {route.page === "guardians" && <Guardians />}
      {route.page === "how" && <HowItWorks />}
      {route.page === "case" && incident && <IncidentPage key={incident.id} incident={incident} tab={route.tab} symbol={route.symbol} />}
      {route.page === "case" && !incident && (
        <div className="page"><p className="empty">Case not found. <a href="#/cases">Back to all cases</a></p></div>
      )}
      {!["cases", "tracker", "activity", "wallet", "profile", "stats", "stake", "guardians", "how", "case", "start", "tour"].includes(route.page) && (
        <div className="page"><p className="empty">Page not found. <a href="#/cases">Go to cases</a></p></div>
      )}
    </Shell>
    </>
  );
}
