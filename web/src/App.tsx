import { useEffect, useState } from "react";
import { AppProvider, ToastProvider, useApp } from "./appdata";
import { normalizeDeployment, type Deployment } from "./chain";
import { Logo } from "./components/icons";
import { Shell } from "./components/Shell";
import { IncidentPage, TAB_IDS, type Tab } from "./pages/IncidentPage";
import { CasesPage } from "./pages/CasesPage";
import { Faq } from "./pages/Faq";
import { Landing } from "./pages/Landing";
import { ActivityPage, HowItWorks, MyWallet, Tracker } from "./pages/others";
import { WalletProvider } from "./wallet";

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

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // The dev server can start before the seed script finishes, so retry until the file exists.
    const load = async () => {
      try {
        const response = await fetch("./deployment.json", { cache: "no-store" });
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("missing");
        const data = normalizeDeployment((await response.json()) as Record<string, unknown>);
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

  // The landing page needs no chain data, so it shows immediately.
  if (route.page === "") return <Landing />;

  if (!deployment) {
    return (
      <div className="loading-screen">
        <Logo size={40} />
        <p>{loadError ? "Waiting for a deployment. Run: make web-local" : "Loading…"}</p>
        <a href="#/">Back to home</a>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppProvider deployment={deployment}>
        <WalletProvider deployment={deployment}>
          <Routed route={route} />
        </WalletProvider>
      </AppProvider>
    </ToastProvider>
  );
}

function Routed({ route }: { route: Route }) {
  const { desk } = useApp();
  const incident = desk.incidents.find((item) => item.id === route.caseId);
  return (
    <Shell page={route.page} caseId={route.caseId}>
      {route.page === "cases" && <CasesPage />}
      {route.page === "tracker" && <Tracker />}
      {route.page === "activity" && <ActivityPage />}
      {route.page === "wallet" && <MyWallet />}
      {route.page === "how" && <HowItWorks />}
      {route.page === "faq" && <Faq />}
      {route.page === "case" && incident && <IncidentPage key={incident.id} incident={incident} tab={route.tab} symbol={route.symbol} />}
      {route.page === "case" && !incident && (
        <div className="page"><p className="empty">Case not found. <a href="#/cases">Back to all cases</a></p></div>
      )}
      {!["cases", "tracker", "activity", "wallet", "how", "faq", "case"].includes(route.page) && (
        <div className="page"><p className="empty">Page not found. <a href="#/cases">Go to cases</a></p></div>
      )}
    </Shell>
  );
}
