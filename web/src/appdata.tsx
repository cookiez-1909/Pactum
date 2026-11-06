// Shared app data: the deployment record, contract state, the address book and notifications.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Deployment } from "./chain";
import { buildDirectory, type Directory } from "./labels";
import { useActivity, useDesk, type ActivityRow, type DeskData } from "./useDesk";

interface Toast {
  id: number;
  kind: "ok" | "error";
  title: string;
  detail?: string;
  href?: string | null;
}

interface AppData {
  deployment: Deployment;
  desk: DeskData;
  directory: Directory;
  activity: { rows: ActivityRow[]; failed: boolean };
}

const AppContext = createContext<AppData | null>(null);
const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => {});

export function useApp(): AppData {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp needs AppProvider");
  return value;
}

export function useToast() {
  return useContext(ToastContext);
}

export function AppProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const desk = useDesk(deployment);
  const activity = useActivity(deployment, desk);
  const directory = useMemo(() => buildDirectory(deployment), [deployment]);
  const value = useMemo(() => ({ deployment, desk, directory, activity }), [deployment, desk, directory, activity]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const add = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((items) => [...items, { ...toast, id }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), toast.kind === "error" ? 9000 : 6000);
  }, []);

  return (
    <ToastContext.Provider value={add}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
            <span className="toast-mark" aria-hidden="true">{toast.kind === "ok" ? "✓" : "!"}</span>
            <div>
              <p className="toast-title">{toast.title}</p>
              {toast.detail && <p className="toast-detail">{toast.detail}</p>}
              {toast.href && <a href={toast.href} target="_blank" rel="noreferrer">View transaction</a>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
