// The wallet in use in the interface. Return, Refund and My wallet rely on it to know what the viewer can do.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddress, type Address } from "viem";
import { useApp } from "./appdata";
import { connectInjected, demoPersonas, hasInjectedWallet, type Deployment, type Persona } from "./chain";
import { Chevron } from "./components/icons";
import { RoleTag } from "./components/Party";
import { shortAddress } from "./format";
import { identify, ROLE_LABEL } from "./labels";

const STORAGE_KEY = "pactum-persona";

interface WalletState {
  address: Address | null;
  persona: Persona | null;
  personas: Persona[];
  // Viewing a typed-in address: it can read, but holds no key to send transactions.
  readOnly: boolean;
  connect(): Promise<void>;
  select(persona: Persona): void;
  viewAs(address: Address): void;
  error: string | null;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet needs WalletProvider");
  return value;
}

function savedPersona(personas: Persona[]): Persona | null {
  try {
    const name = localStorage.getItem(STORAGE_KEY);
    return personas.find((item) => item.name === name) ?? personas[0] ?? null;
  } catch {
    return personas[0] ?? null;
  }
}

export function WalletProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const personas = useMemo(() => demoPersonas(deployment), [deployment]);
  const [persona, setPersona] = useState<Persona | null>(() => savedPersona(personas));
  const [injectedAddress, setInjectedAddress] = useState<Address | null>(null);
  const [custom, setCustom] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    try {
      setCustom(null);
      setInjectedAddress(await connectInjected());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.split("\n")[0]! : "Could not connect a wallet.");
    }
  }, []);

  const select = useCallback((next: Persona) => {
    setCustom(null);
    setPersona(next);
    try {
      localStorage.setItem(STORAGE_KEY, next.name);
    } catch {
      // If it cannot be saved, the choice is only lost on reload.
    }
  }, []);

  const viewAs = useCallback((next: Address) => setCustom(next), []);

  const value = useMemo<WalletState>(
    () => ({ address: custom ?? persona?.address ?? injectedAddress, persona: custom ? null : persona, personas, readOnly: custom !== null, connect, select, viewAs, error }),
    [custom, persona, injectedAddress, personas, connect, select, viewAs, error],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// "Who are you?" in the top right: pick a test role, connect a wallet, or type an address to view.
export function WalletMenu() {
  const { address, persona, personas, connect, select, viewAs, readOnly, error } = useWallet();
  const { directory } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const me = address ? identify(directory, address) : null;
  const draftValid = isAddress(draft.trim());

  return (
    <div className="wallet-menu" ref={root}>
      <span className="who-label">Who are you?</span>
      <button type="button" className="wallet-button" aria-haspopup="dialog" aria-expanded={open} aria-label="Who are you? Choose a wallet" onClick={() => setOpen((value) => !value)}>
        {me ? (
          <>
            {me.name !== ROLE_LABEL[me.role] && <span className="wallet-name">{me.name}</span>}
            <RoleTag role={me.role} />
            <code className="wallet-address">{shortAddress(address!)}</code>
            {readOnly && <span className="view-only">View only</span>}
          </>
        ) : (
          <span className="wallet-name">Choose a wallet</span>
        )}
        <Chevron className={open ? "chevron is-open" : "chevron"} />
      </button>
      {open && (
        <div className="wallet-popover" role="dialog" aria-label="Who are you?">
          {personas.length > 0 && <p className="wallet-popover-head">Test accounts. Switch to see what each person can do.</p>}
          {personas.map((item) => {
            const who = identify(directory, item.address);
            const active = !readOnly && item.name === persona?.name;
            return (
              <button
                key={item.name}
                type="button"
                className={active ? "wallet-option is-active" : "wallet-option"}
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  select(item);
                  setOpen(false);
                }}
              >
                <span className="wallet-option-name">{item.name}</span>
                {who.name !== ROLE_LABEL[who.role] && <RoleTag role={who.role} />}
                <code>{shortAddress(item.address)}</code>
              </button>
            );
          })}
          {personas.length === 0 && (
            <div className="wallet-connect-row">
              <button type="button" className="button button-primary button-block-plain" onClick={() => void connect().then(() => setOpen(false))} disabled={!hasInjectedWallet()}>Connect wallet</button>
              {!hasInjectedWallet() && <p className="fine-print">No browser wallet found.</p>}
              {error && <p className="field-error">{error}</p>}
            </div>
          )}
          <form
            className="wallet-custom"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draftValid) return;
              viewAs(draft.trim() as Address);
              setDraft("");
              setOpen(false);
            }}
          >
            <label htmlFor="custom-wallet">Enter a wallet <span className="optional">Optional</span></label>
            <div className="wallet-custom-row">
              <input id="custom-wallet" value={draft} spellCheck={false} placeholder="0x…" aria-invalid={draft.length > 0 && !draftValid} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="button" disabled={!draftValid}>View</button>
            </div>
            <p className="fine-print">No sign-up and no identity check. Pactum respects your privacy. This view can read but not send transactions. The address is not saved, and it is only used to read public data.</p>
          </form>
        </div>
      )}
    </div>
  );
}
