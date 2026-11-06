import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address, type Hash } from "viem";
import {
  addressUrl,
  demoPersonas,
  deskAbi,
  erc20Abi,
  fetchNearProposal,
  hasInjectedWallet,
  nearTxUrl,
  publicClientOf,
  txUrl,
  walletFor,
  type Deployment,
  type NearProposal,
  type Persona,
} from "./chain";

type Tab = "incident" | "return" | "refund" | "ledger";

interface CaseState {
  totalReturned: bigint;
  totalReward: bigint;
  totalRefund: bigint;
  totalClaimed: bigint;
  open: boolean;
  rewardBps: number;
  until: bigint;
}

interface LedgerRow {
  label: string;
  hash: string;
  chain: "EVM" | "NEAR";
  block?: bigint;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "incident", label: "Incident" },
  { id: "return", label: "Return" },
  { id: "refund", label: "Refund" },
  { id: "ledger", label: "Ledger" },
];

function tokens(value: bigint): string {
  const [whole = "0", fraction = ""] = formatUnits(value, 18).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : grouped;
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function countdown(until: bigint, now: number): string {
  const left = Number(until) - Math.floor(now / 1000);
  if (left <= 0) return "ended";
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

function ExternalLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return <code>{children}</code>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <code>{children}</code>
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function App() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("incident");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // The dev server can start before the deploy script, so retry until the file exists.
    const load = async () => {
      try {
        const response = await fetch("./deployment.json", { cache: "no-store" });
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("missing");
        const data = (await response.json()) as Deployment;
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

  return (
    <>
      <div className="warning" role="note">
        Testnet demo. Do not send real or stolen funds.
      </div>
      <div className="page">
        <header className="masthead">
          <h1>Return Desk</h1>
          <p>Return exploited funds and get the published reward in one transaction. The rest goes back to users.</p>
        </header>
        {deployment ? (
          <Desk deployment={deployment} tab={tab} setTab={setTab} />
        ) : (
          <p className="empty">{loadError ? "Waiting for a deployment. Run: make web-local" : "Loading…"}</p>
        )}
      </div>
    </>
  );
}

function Desk({ deployment, tab, setTab }: { deployment: Deployment; tab: Tab; setTab: (tab: Tab) => void }) {
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const personas = useMemo(() => demoPersonas(deployment), [deployment]);
  const [state, setState] = useState<CaseState | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [clockSkew, setClockSkew] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const now = tick + clockSkew;
  const [sessionTxs, setSessionTxs] = useState<LedgerRow[]>([]);
  const desk = deployment.contracts.ReturnDesk;
  const caseId = deployment.terms.caseId;

  const refresh = useCallback(async () => {
    try {
      const [result, tier, block] = await Promise.all([
        client.readContract({ address: desk, abi: deskAbi, functionName: "getCase", args: [caseId] }),
        client.readContract({ address: desk, abi: deskAbi, functionName: "currentTier", args: [caseId] }),
        client.getBlock(),
      ]);
      setClockSkew(Number(block.timestamp) * 1000 - Date.now());
      setState({
        totalReturned: result.totalReturned,
        totalReward: result.totalReward,
        totalRefund: result.totalRefund,
        totalClaimed: result.totalClaimed,
        open: tier[0],
        rewardBps: tier[1],
        until: tier[2],
      });
      setReadError(null);
    } catch (error) {
      setReadError(error instanceof Error ? error.message.split("\n")[0]! : "Could not read the contract");
    }
  }, [client, desk, caseId]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(refresh, 6000);
    const clock = window.setInterval(() => setTick(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const recordTx = useCallback(
    (label: string, hash: Hash) => {
      setSessionTxs((rows) => [...rows, { label, hash, chain: "EVM" }]);
      void refresh();
    },
    [refresh],
  );

  return (
    <>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {readError && <p className="error">Chain read failed: {readError}</p>}
      {tab === "incident" && <Incident deployment={deployment} state={state} />}
      {tab === "return" && <ReturnFunds deployment={deployment} state={state} now={now} personas={personas} onTx={recordTx} />}
      {tab === "refund" && <Refund deployment={deployment} state={state} personas={personas} onTx={recordTx} />}
      {tab === "ledger" && <Ledger deployment={deployment} sessionTxs={sessionTxs} />}
    </>
  );
}

function Incident({ deployment, state }: { deployment: Deployment; state: CaseState | null }) {
  const [proposal, setProposal] = useState<NearProposal | null>(null);
  const [nearFailed, setNearFailed] = useState(false);
  const { terms, near, contracts, controllerAddress } = deployment;

  useEffect(() => {
    if (near.simulated) return;
    fetchNearProposal(deployment)
      .then((result) => {
        setProposal(result);
        setNearFailed(result === null);
      })
      .catch(() => setNearFailed(true));
  }, [deployment, near.simulated]);

  const loss = BigInt(terms.totalLoss);
  const returned = state?.totalReturned ?? 0n;

  return (
    <section>
      <div className="headline">
        <span className="headline-label">Lost</span>
        <span className="headline-value stolen">{tokens(loss)} mUSD</span>
        <span className="headline-note">
          {state ? `${tokens(returned)} mUSD returned so far` : "Reading the contract…"}
        </span>
      </div>

      {near.simulated && (
        <p className="notice">
          Local mode. The controller is <strong>simulated</strong> with a test key. No NEAR contract or Chain Signatures are involved in this run.
        </p>
      )}

      <h2>Who decided to open this case</h2>
      <dl className="facts">
        {!near.simulated && (
          <>
            <Fact label="NEAR contract">
              <ExternalLink href={`https://testnet.nearblocks.io/address/${near.controllerAccount}`}>{near.controllerAccount ?? ""}</ExternalLink>
            </Fact>
            <Fact label="Proposal status">
              {proposal ? <strong>{proposal.status}</strong> : nearFailed ? "NEAR read failed" : "Reading NEAR…"}
            </Fact>
            <Fact label="Approvals">
              {proposal ? `${proposal.approvals.length} of ${near.guardians?.length} guardians, ${near.threshold} needed` : "…"}
            </Fact>
            <Fact label="Approved by">
              {proposal ? proposal.approvals.join(", ") : "…"}
            </Fact>
          </>
        )}
        <Fact label="Controller on EVM">
          <ExternalLink href={addressUrl(deployment, controllerAddress)}>{short(controllerAddress)}</ExternalLink>
          {!near.simulated && <span className="hint"> Derived from the NEAR account. Nobody holds this key.</span>}
        </Fact>
      </dl>

      <h2>Terms, fixed once opened</h2>
      <dl className="facts">
        <Fact label="Reward cap">{tokens(BigInt(terms.rewardCap))} mUSD for the whole case</Fact>
        <Fact label="Accepts up to">{tokens(BigInt(terms.maxReturn))} mUSD</Fact>
        <Fact label="Evidence hash"><code>{short(terms.evidenceHash)}</code></Fact>
        <Fact label="Refund root"><code>{short(terms.refundRoot)}</code></Fact>
        <Fact label="ReturnDesk"><ExternalLink href={addressUrl(deployment, contracts.ReturnDesk)}>{short(contracts.ReturnDesk)}</ExternalLink></Fact>
        <Fact label="Token"><ExternalLink href={addressUrl(deployment, contracts.MockUSD)}>{short(contracts.MockUSD)}</ExternalLink></Fact>
      </dl>
    </section>
  );
}

function PersonaPicker({ personas, selected, onChange, allowed }: { personas: Persona[]; selected: Persona | null; onChange: (persona: Persona | null) => void; allowed: string[] }) {
  const usable = personas.filter((persona) => allowed.includes(persona.name));
  if (usable.length === 0) {
    return <p className="hint">{hasInjectedWallet() ? "Transactions use your browser wallet on Sepolia." : "Connect a browser wallet on Sepolia to send transactions."}</p>;
  }
  return (
    <label className="field">
      <span>Act as (test account)</span>
      <select value={selected?.name ?? ""} onChange={(event) => onChange(usable.find((persona) => persona.name === event.target.value) ?? null)}>
        {usable.map((persona) => (
          <option key={persona.name} value={persona.name}>
            {persona.name} {short(persona.address)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReturnFunds({ deployment, state, now, personas, onTx }: { deployment: Deployment; state: CaseState | null; now: number; personas: Persona[]; onTx: (label: string, hash: Hash) => void }) {
  const { terms, contracts, actors } = deployment;
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const attacker = personas.find((persona) => persona.name === "Attacker") ?? null;
  const [persona, setPersona] = useState<Persona | null>(attacker);
  const [amountText, setAmountText] = useState("1000000");
  const [rewardTo, setRewardTo] = useState<string>(actors.rewardWallet);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const amount = useMemo(() => {
    try {
      const parsed = parseUnits(amountText.replace(/,/g, "").trim() || "0", 18);
      return parsed >= 0n ? parsed : null;
    } catch {
      return null;
    }
  }, [amountText]);

  // Calculator using the contract's formula: reward = min(bps × amount, remaining cap).
  const preview = useMemo(() => {
    if (!state || amount === null) return null;
    const accepted = amount < BigInt(terms.maxReturn) - state.totalReturned ? amount : BigInt(terms.maxReturn) - state.totalReturned;
    const byPercent = (accepted * BigInt(state.rewardBps)) / 10_000n;
    const capLeft = BigInt(terms.rewardCap) - state.totalReward;
    const reward = byPercent < capLeft ? byPercent : capLeft;
    return { accepted, reward, refund: accepted - reward };
  }, [state, amount, terms.maxReturn, terms.rewardCap]);

  const rewardToValid = isAddress(rewardTo) && rewardTo !== zeroAddress;
  const remaining = state ? BigInt(terms.maxReturn) - state.totalReturned : 0n;
  const rewardShare = preview && preview.accepted > 0n ? Number((preview.reward * 10_000n) / preview.accepted) / 100 : 0;

  const submit = async () => {
    if (!preview || preview.accepted === 0n || !rewardToValid) return;
    setMessage(null);
    try {
      const { client: wallet, account } = await walletFor(deployment, persona);
      const owner = typeof account === "string" ? account : account.address;
      const allowance = await client.readContract({ address: contracts.MockUSD, abi: erc20Abi, functionName: "allowance", args: [owner, contracts.ReturnDesk] });
      if (allowance < preview.accepted) {
        setBusy("Approving token…");
        const approveHash = await wallet.writeContract({ account, chain: wallet.chain, address: contracts.MockUSD, abi: erc20Abi, functionName: "approve", args: [contracts.ReturnDesk, preview.accepted] });
        await client.waitForTransactionReceipt({ hash: approveHash });
        onTx("Approve token", approveHash);
      }
      setBusy("Returning funds…");
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: contracts.ReturnDesk, abi: deskAbi, functionName: "returnFunds", args: [terms.caseId, preview.accepted, rewardTo as Address] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      onTx("Funds returned, reward paid", hash);
      setMessage({ kind: "ok", text: `Done in one transaction: ${tokens(preview.reward)} mUSD reward, ${tokens(preview.refund)} mUSD to refunds.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message.split("\n")[0]! : "The transaction failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="headline">
        <span className="headline-label">Reward now</span>
        <span className="headline-value">{state ? (state.open ? `${state.rewardBps / 100}%` : "Closed") : "…"}</span>
        <span className="headline-note">{state?.open ? `${countdown(state.until, now)} left at this rate` : state ? "This case no longer accepts funds" : ""}</span>
      </div>

      <ol className="tiers">
        {terms.tiers.map((tier) => {
          const until = BigInt(tier.until);
          const current = state?.open && state.until === until;
          const past = Number(until) * 1000 < now;
          return (
            <li key={tier.until} className={current ? "current" : past ? "past" : ""}>
              <strong>{tier.rewardBps / 100}%</strong>
              <span>until {new Date(Number(until) * 1000).toUTCString().replace("GMT", "UTC")}</span>
            </li>
          );
        })}
      </ol>
      <p className="hint">The reward can only follow this schedule. No function can lower it after the case opens.</p>

      <h2>If you return</h2>
      <label className="field">
        <span>Amount (mUSD), up to {tokens(remaining)} remaining</span>
        <input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} aria-invalid={amount === null} />
      </label>

      {preview && preview.accepted > 0n ? (
        <div className="split" aria-label="How this return is split">
          <div className="split-bar" aria-hidden="true">
            <div className="split-reward" style={{ width: `${rewardShare}%` }} />
            <div className="split-refund" />
          </div>
          <dl className="split-legend">
            <div><dt>You receive</dt><dd className="reward">{tokens(preview.reward)} mUSD</dd></div>
            <div><dt>Goes to refunds</dt><dd className="refund">{tokens(preview.refund)} mUSD</dd></div>
          </dl>
          {preview.accepted < (amount ?? 0n) && <p className="hint">Only {tokens(preview.accepted)} mUSD will be pulled. That is all this case still accepts.</p>}
        </div>
      ) : (
        <p className="hint">{amount === null ? "Enter a valid amount." : remaining === 0n ? "This case has received everything it accepts." : "Enter an amount to see the split."}</p>
      )}

      <label className="field">
        <span>Send my reward to</span>
        <input value={rewardTo} spellCheck={false} aria-invalid={!rewardToValid} onChange={(event) => setRewardTo(event.target.value)} />
      </label>
      {!rewardToValid && <p className="error">Enter a valid address other than the zero address. Tokens sent to a wrong address cannot be recovered.</p>}
      <PersonaPicker personas={personas} selected={persona} onChange={setPersona} allowed={["Attacker"]} />
      <button type="button" className="primary" disabled={!state?.open || !preview || preview.accepted === 0n || !rewardToValid || busy !== null} onClick={submit}>
        {busy ?? "Return funds"}
      </button>
      {message && <p className={message.kind === "ok" ? "success" : "error"}>{message.text}</p>}

      <p className="notice">
        Paying a reward is all this contract can promise. It does not grant immunity from prosecution, and it does not check sanctions lists.
      </p>
    </section>
  );
}

function Refund({ deployment, state, personas, onTx }: { deployment: Deployment; state: CaseState | null; personas: Persona[]; onTx: (label: string, hash: Hash) => void }) {
  const { terms, allocations, contracts } = deployment;
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [rows, setRows] = useState<Record<string, { claimed: bigint; claimable: bigint }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const totalReward = state?.totalReward;
  const totalClaimed = state?.totalClaimed;

  const load = useCallback(async () => {
    const entries = await Promise.all(
      allocations.map(async (entry) => {
        const [claimed, claimable] = await Promise.all([
          client.readContract({ address: contracts.ReturnDesk, abi: deskAbi, functionName: "claimed", args: [terms.caseId, entry.account] }),
          client.readContract({ address: contracts.ReturnDesk, abi: deskAbi, functionName: "claimable", args: [terms.caseId, entry.account, BigInt(entry.allocation)] }),
        ]);
        return [entry.account, { claimed, claimable }] as const;
      }),
    );
    setRows(Object.fromEntries(entries));
  }, [allocations, client, contracts.ReturnDesk, terms.caseId]);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: "Could not read refund balances" }));
  }, [load, totalReward, totalClaimed]);

  // Anyone can call claimRefund and the money only goes to the right address, so any account can safely pay the gas.
  const claim = async (entry: Deployment["allocations"][number], index: number) => {
    setMessage(null);
    setBusy(entry.account);
    try {
      const persona = personas.find((item) => item.address.toLowerCase() === entry.account.toLowerCase()) ?? personas[index + 1] ?? null;
      const { client: wallet, account } = await walletFor(deployment, persona);
      const hash = await wallet.writeContract({
        account,
        chain: wallet.chain,
        address: contracts.ReturnDesk,
        abi: deskAbi,
        functionName: "claimRefund",
        args: [terms.caseId, entry.account, BigInt(entry.allocation), entry.proof],
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      onTx(`Refund claimed by user ${index + 1}`, hash);
      await load();
      setMessage({ kind: "ok", text: `User ${index + 1} received their refund.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message.split("\n")[0]! : "The claim failed" });
    } finally {
      setBusy(null);
    }
  };

  const pool = state?.totalRefund ?? 0n;
  const loss = BigInt(terms.totalLoss);

  return (
    <section>
      <div className="headline">
        <span className="headline-label">Refund pool</span>
        <span className="headline-value refund">{state ? `${tokens(pool)} mUSD` : "…"}</span>
        <span className="headline-note">{state ? `${tokens(state.totalClaimed)} mUSD claimed` : ""}</span>
      </div>
      <p>
        Each user can claim <code>allocation × refund pool ÷ total loss</code>. If more funds come back later, the same user can claim again.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col" className="num">Lost</th>
              <th scope="col" className="num">Claimed</th>
              <th scope="col" className="num">Available</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((entry, index) => {
              const row = rows[entry.account];
              return (
                <tr key={entry.account}>
                  <td><ExternalLink href={addressUrl(deployment, entry.account)}>{short(entry.account)}</ExternalLink></td>
                  <td className="num">{tokens(BigInt(entry.allocation))}</td>
                  <td className="num">{row ? tokens(row.claimed) : "…"}</td>
                  <td className="num">{row ? tokens(row.claimable) : "…"}</td>
                  <td className="action">
                    <button type="button" disabled={!row || row.claimable === 0n || busy !== null} onClick={() => claim(entry, index)}>
                      {busy === entry.account ? "Claiming…" : "Claim"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && <p className={message.kind === "ok" ? "success" : "error"}>{message.text}</p>}
      {pool > 0n && pool < loss && <p className="hint">Users recover {Number((pool * 10_000n) / loss) / 100}% of their loss so far. The rest paid the reward or has not come back.</p>}
      <h2>The team cannot touch this pool</h2>
      <p>
        ReturnDesk has no owner, no upgrade path and no withdraw function. Tokens leave only as a reward during <code>returnFunds</code> or as a refund through <code>claimRefund</code>.
      </p>
    </section>
  );
}

const TX_LABELS: Record<string, string> = {
  deployMockUSD: "Deploy MockUSD",
  deployVulnerableVault: "Deploy VulnerableVault (intentionally buggy)",
  deployReturnDesk: "Deploy ReturnDesk",
  deposit0: "User 1 deposits",
  deposit1: "User 2 deposits",
  deposit2: "User 3 deposits",
  drain: "Attacker drains the vault",
  openCase: "Case opened with the controller signature",
  approveReturn: "Attacker approves the token",
  returnFunds: "Funds returned, reward paid in the same transaction",
  claim0: "Refund claimed by user 1",
  claim1: "Refund claimed by user 2",
  claim2: "Refund claimed by user 3",
};

const NEAR_LABELS: Record<string, string> = {
  deployController: "Deploy controller contract",
  removeKeys: "Delete every access key of the controller",
  propose: "Guardian proposes the case",
  approve1: "Guardian 1 approves",
  approve2: "Guardian 2 approves, Chain Signatures signs",
};

function Ledger({ deployment, sessionTxs }: { deployment: Deployment; sessionTxs: LedgerRow[] }) {
  const near: LedgerRow[] = Object.entries(deployment.near.txs ?? {}).map(([key, hash]) => ({ label: NEAR_LABELS[key] ?? key, hash, chain: "NEAR" }));
  const evm: LedgerRow[] = Object.entries(deployment.txs).map(([key, hash]) => ({ label: TX_LABELS[key] ?? key, hash, chain: "EVM" }));

  return (
    <section>
      <h2>Public transactions</h2>
      {deployment.network === "local" && <p className="notice">Local mode. These transactions exist only on your Anvil node, so there are no explorer links.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">Chain</th><th scope="col">What happened</th><th scope="col">Transaction</th></tr>
          </thead>
          <tbody>
            {[...near, ...evm, ...sessionTxs].map((row) => (
              <tr key={`${row.chain}-${row.hash}-${row.label}`}>
                <td><span className={`chain chain-${row.chain.toLowerCase()}`}>{row.chain}</span></td>
                <td>{row.label}</td>
                <td><ExternalLink href={row.chain === "NEAR" ? nearTxUrl(row.hash) : txUrl(deployment, row.hash)}>{short(row.hash)}</ExternalLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
