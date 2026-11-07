import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address, type Hash } from "viem";
import { useApp, useToast } from "../appdata";
import {
  deskAbi,
  erc20Abi,
  nearTxUrl,
  publicClientOf,
  txUrl,
  walletFor,
  type CaseInfo,
} from "../chain";
import { ConvertRefund } from "../components/ConvertRefund";
import { Check, ExternalLink } from "../components/icons";
import { Party } from "../components/Party";
import { countdown, shortAddress, tokens } from "../format";
import { acceptsFunds, type CaseState } from "../useDesk";
import { useWallet } from "../wallet";

export interface SessionTx {
  label: string;
  hash: Hash;
}

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message.split("\n")[0]! : fallback);

export function TxLink({ hash, near = false }: { hash: string; near?: boolean }) {
  const { deployment } = useApp();
  const href = near ? nearTxUrl(hash) : txUrl(deployment, hash);
  if (!href) return <code className="tx">{shortAddress(hash)}</code>;
  return <a className="tx" href={href} target="_blank" rel="noreferrer"><code>{shortAddress(hash)}</code> <ExternalLink /></a>;
}

export function RewardSchedule({ info, state }: { info: CaseInfo; state: CaseState | undefined }) {
  const { desk } = useApp();
  const accepting = acceptsFunds(info, state);
  return (
    <section className="card">
      <h2>Reward schedule</h2>
      <ol className="tiers">
        {info.terms.tiers.map((tier) => {
          const until = BigInt(tier.until);
          const current = accepting && state?.until === until;
          const past = Number(until) * 1000 < desk.now;
          return (
            <li key={tier.until} className={current ? "tier is-current" : past ? "tier is-past" : "tier"}>
              <strong>{tier.rewardBps / 100}%</strong>
              <span>
                until {new Date(Number(until) * 1000).toUTCString().replace(" GMT", " UTC").replace(/^\w+, /, "")}
                {current && <span className="tier-left">{countdown(until, desk.now)} left</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="fine-print">The reward can only follow this schedule. No function can lower it after the case opens.</p>
    </section>
  );
}

export function ReturnFunds({ info, state, onTx }: { info: CaseInfo; state: CaseState | undefined; onTx: (label: string, hash: Hash) => void }) {
  const { deployment } = useApp();
  const toast = useToast();
  const { terms, token } = info;
  const { address, persona, connect, readOnly } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const desk = deployment.contracts.Pactum;
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amountText, setAmountText] = useState("");
  const [rewardText, setRewardText] = useState("");
  const [step, setStep] = useState<"idle" | "approve" | "return">("idle");
  const [result, setResult] = useState<{ reward: bigint; refund: bigint; hash: Hash } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sym = token.symbol;
  const fmt = (value: bigint) => tokens(value, token.decimals);
  const busy = step !== "idle";

  const remaining = state ? BigInt(terms.maxReturn) - state.totalReturned : 0n;
  const stateReady = state !== undefined;

  const loadBalance = useCallback(async () => {
    if (!address) return setBalance(null);
    setBalance(await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }));
  }, [address, client, token.address]);

  useEffect(() => {
    setFailure(null);
    setResult(null);
    void loadBalance().catch(() => setBalance(null));
  }, [loadBalance]);

  // Prefills the most this wallet can return. Only refilled when the wallet or balance changes, never while typing.
  useEffect(() => {
    if (balance === null || !stateReady) return;
    const max = balance < remaining ? balance : remaining;
    setAmountText(max > 0n ? formatUnits(max, token.decimals) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, address, stateReady]);

  const amount = useMemo(() => {
    const text = amountText.replace(/,/g, "").trim() || "0";
    // parseUnits rounds off extra decimals, so reject them first and send exactly the number the user sees.
    const match = text.match(/^\d*(?:\.(\d*))?$/);
    if (!match || (match[1]?.length ?? 0) > token.decimals) return null;
    try {
      return parseUnits(text, token.decimals);
    } catch {
      return null;
    }
  }, [amountText, token.decimals]);

  // Calculator using the contract's formula: reward = min(bps × amount, remaining cap).
  const preview = useMemo(() => {
    if (!state || amount === null) return null;
    const accepted = amount < remaining ? amount : remaining;
    const byPercent = (accepted * BigInt(state.rewardBps)) / 10_000n;
    const capLeft = BigInt(terms.rewardCap) - state.totalReward;
    const reward = byPercent < capLeft ? byPercent : capLeft;
    return { accepted, reward, refund: accepted - reward, capped: byPercent > capLeft };
  }, [state, amount, remaining, terms.rewardCap]);

  // Left empty, the reward goes to the returning wallet. Another wallet only if the user wants one.
  const rewardTo = rewardText.trim() || address || "";
  const rewardToValid = isAddress(rewardTo) && rewardTo !== zeroAddress;
  const holdsNothing = balance === 0n;
  const overBalance = preview !== null && balance !== null && preview.accepted > balance;
  const rewardShare = preview && preview.accepted > 0n ? Number((preview.reward * 10_000n) / preview.accepted) / 100 : 0;
  const fullyReturned = stateReady && remaining === 0n;
  const closed = stateReady && !state!.open && !fullyReturned;
  const canSubmit = !readOnly && !closed && !fullyReturned && !!address && !holdsNothing && !overBalance && !!preview && preview.accepted > 0n && rewardToValid && !busy;

  const submit = async () => {
    if (!canSubmit || !preview) return;
    setFailure(null);
    setResult(null);
    try {
      const { client: wallet, account } = await walletFor(deployment, persona);
      const owner = typeof account === "string" ? account : account.address;
      const allowance = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [owner, desk] });
      if (allowance < preview.accepted) {
        setStep("approve");
        const approveHash = await wallet.writeContract({ account, chain: wallet.chain, address: token.address, abi: erc20Abi, functionName: "approve", args: [desk, preview.accepted] });
        await client.waitForTransactionReceipt({ hash: approveHash });
        onTx("Holder approves the token", approveHash);
      }
      setStep("return");
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: desk, abi: deskAbi, functionName: "returnFunds", args: [terms.caseId, preview.accepted, rewardTo as Address] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      onTx("Funds returned, reward paid in the same transaction", hash);
      await loadBalance();
      setResult({ reward: preview.reward, refund: preview.refund, hash });
      toast({ kind: "ok", title: "Funds returned", detail: `${fmt(preview.reward)} ${sym} reward, ${fmt(preview.refund)} ${sym} to refunds.`, href: txUrl(deployment, hash) });
    } catch (reason) {
      const text = errorText(reason, "The transaction failed");
      setFailure(text);
      toast({ kind: "error", title: "Return failed", detail: text });
    } finally {
      setStep("idle");
    }
  };

  const blockReason = closed
    ? "This case no longer accepts funds. The last deadline has passed."
    : fullyReturned
      ? "This case has received everything it accepts."
      : !address
        ? null
        : holdsNothing
          ? `This wallet holds no ${sym}. Only a wallet holding the funds can return them.`
          : overBalance && balance !== null
            ? `This wallet holds only ${fmt(balance)} ${sym}.`
            : null;

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card">
          <div className="card-head">
            <h2>Return funds</h2>
            {address && balance !== null && <span className="balance" data-testid="balance">Wallet holds <span className="mono strong">{fmt(balance)} {sym}</span></span>}
          </div>

          <label className="field">
            <span>Amount, up to {fmt(remaining)} {sym} remaining</span>
            <span className="input-with-unit">
              <input inputMode="decimal" value={amountText} placeholder="0" aria-invalid={amount === null} onChange={(event) => setAmountText(event.target.value)} />
              <span className="input-unit">{sym}</span>
            </span>
          </label>
          {amount === null && <p className="field-error">Enter a valid amount. {sym} has {token.decimals} decimals.</p>}

          {preview && preview.accepted > 0n && (
            <div className="split-preview" aria-label="How this return is split">
              <div className="split-bar" aria-hidden="true">
                {preview.reward > 0n && <div className="bar-reward" style={{ width: `${rewardShare}%` }} />}
                <div className="bar-refund split-grow" />
              </div>
              <dl className="split-legend">
                <div><dt><span className="swatch bar-reward" /> You receive</dt><dd>{fmt(preview.reward)} {sym}</dd></div>
                <div><dt><span className="swatch bar-refund" /> Goes to refunds</dt><dd>{fmt(preview.refund)} {sym}</dd></div>
              </dl>
              {amount !== null && preview.accepted < amount && <p className="fine-print">Only {fmt(preview.accepted)} {sym} will be pulled. That is all this case still accepts.</p>}
              {preview.capped && <p className="fine-print">The reward cap limits this payout. The excess goes to refunds.</p>}
            </div>
          )}

          <label className="field">
            <span>Send my reward to <span className="optional">Optional</span></span>
            <input value={rewardText} spellCheck={false} placeholder={address ? `This wallet, ${shortAddress(address)}` : "0x…"} aria-invalid={rewardText.trim().length > 0 && !rewardToValid} onChange={(event) => setRewardText(event.target.value)} />
          </label>
          {rewardText.trim().length > 0 && !rewardToValid && <p className="field-error">Enter a valid address other than the zero address. Tokens sent to a wrong address cannot be recovered.</p>}
          <p className="field-hint muted">Leave it empty to use this wallet, or enter any wallet you like. No sign-up and no identity check.</p>

          {blockReason && <p className="block-reason" role="status">{blockReason}</p>}

          {busy && (
            <ol className="tx-steps" aria-live="polite">
              <li className={step === "approve" ? "is-active" : "is-done"}>{step === "approve" ? <span className="spinner" /> : <Check />} Approve {sym}</li>
              <li className={step === "return" ? "is-active" : ""}>{step === "return" ? <span className="spinner" /> : <span className="step-dot" />} Return and split</li>
            </ol>
          )}

          {readOnly && <p className="block-reason" role="status">This is a view of a wallet you typed in. It can read, but it cannot send transactions.</p>}
          {address ? (
            <button type="button" className="button button-primary button-block" disabled={!canSubmit} onClick={submit}>
              {step === "approve" ? "Approving…" : step === "return" ? "Returning…" : "Return funds"}
            </button>
          ) : (
            <button type="button" className="button button-primary button-block" onClick={connect}>Connect a wallet to return funds</button>
          )}
          {failure && <p className="field-error" role="alert">{failure}</p>}

          {result && (
            <div className="result" role="status">
              <span className="result-mark" aria-hidden="true"><Check /></span>
              <div>
                <p className="result-title">Done in one transaction</p>
                <p>{fmt(result.reward)} {sym} reward, {fmt(result.refund)} {sym} to refunds.</p>
                <TxLink hash={result.hash} />
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="col-side">
        <RewardSchedule info={info} state={state} />
        <section className="card card-quiet">
          <h2>Do I have to prove I am the hacker?</h2>
          <p>No. The contract never asks who took the funds. Tokens are interchangeable, so it only counts what arrives. A wallet with no link to the hack works, even after mixers.</p>
          <p>Nobody can abuse this to take money. The caller gives up their own tokens, and at most the published reward comes back.</p>
          <p><strong>The one limit:</strong> it must be this exact token on this chain. Funds that were swapped or bridged away must be swapped or bridged back first.</p>
        </section>
        <p className="notice">Paying a reward is all this contract can promise. It does not grant immunity from prosecution, and it does not check sanctions lists.</p>
      </div>
    </div>
  );
}

export function Refund({ info, state, onTx }: { info: CaseInfo; state: CaseState | undefined; onTx: (label: string, hash: Hash) => void }) {
  const { deployment } = useApp();
  const toast = useToast();
  const { terms, allocations, token } = info;
  const { address, persona, connect, readOnly } = useWallet();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const desk = deployment.contracts.Pactum;
  const [rows, setRows] = useState<Record<string, { claimed: bigint; claimable: bigint }>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState<{ amount: bigint; hash: Hash } | null>(null);
  const sym = token.symbol;
  const fmt = (value: bigint) => tokens(value, token.decimals);
  const totalRefund = state?.totalRefund;
  const totalClaimed = state?.totalClaimed;

  const load = useCallback(async () => {
    const entries = await Promise.all(
      allocations.map(async (entry) => {
        const [claimed, claimable] = await Promise.all([
          client.readContract({ address: desk, abi: deskAbi, functionName: "claimed", args: [terms.caseId, entry.account] }),
          client.readContract({ address: desk, abi: deskAbi, functionName: "claimable", args: [terms.caseId, entry.account, BigInt(entry.allocation)] }),
        ]);
        return [entry.account, { claimed, claimable }] as const;
      }),
    );
    setRows(Object.fromEntries(entries));
  }, [allocations, client, desk, terms.caseId]);

  useEffect(() => {
    void load().catch(() => setFailure("Could not read refund balances"));
  }, [load, totalRefund, totalClaimed]);

  useEffect(() => {
    setFailure(null);
    setJustClaimed(null);
  }, [address]);

  // Only wallets on the list see the claim button. The contract still lets others submit on their behalf,
  // but the money always goes to the allocated address.
  const mine = address ? allocations.find((entry) => entry.account.toLowerCase() === address.toLowerCase()) : undefined;
  const myRow = mine ? rows[mine.account] : undefined;

  const claim = async () => {
    if (!mine || !myRow) return;
    setFailure(null);
    setBusy(true);
    try {
      const amount = myRow.claimable;
      const { client: wallet, account } = await walletFor(deployment, persona);
      const hash = await wallet.writeContract({ account, chain: wallet.chain, address: desk, abi: deskAbi, functionName: "claimRefund", args: [terms.caseId, mine.account, BigInt(mine.allocation), mine.proof] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      onTx("Refund claimed", hash);
      await load();
      setJustClaimed({ amount, hash });
      toast({ kind: "ok", title: "Refund received", detail: `${fmt(amount)} ${sym} is now in this wallet.`, href: txUrl(deployment, hash) });
    } catch (reason) {
      const text = errorText(reason, "The claim failed");
      setFailure(text);
      toast({ kind: "error", title: "Claim failed", detail: text });
    } finally {
      setBusy(false);
    }
  };

  const pool = state?.totalRefund ?? 0n;
  const loss = BigInt(terms.totalLoss);

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="card card-claim">
          <h2>Your refund</h2>
          {!address && (
            <>
              <p>Connect the wallet that lost funds to see your refund.</p>
              <button type="button" className="button button-primary" onClick={connect}>Connect wallet</button>
            </>
          )}
          {address && !mine && <p className="block-reason" role="status">This wallet is not on the refund list for this case, so there is nothing to claim.</p>}
          {mine && (
            <>
              <dl className="numbers">
                <div><dt>You lost</dt><dd>{fmt(BigInt(mine.allocation))} {sym}</dd></div>
                <div><dt>Already claimed</dt><dd>{myRow ? fmt(myRow.claimed) : "…"} {sym}</dd></div>
                <div><dt>Available now</dt><dd className="number-strong">{myRow ? fmt(myRow.claimable) : "…"} {sym}</dd></div>
              </dl>
              {readOnly && <p className="block-reason" role="status">This is a view of a wallet you typed in. Connect that wallet to claim.</p>}
              <button type="button" className="button button-primary button-block" disabled={readOnly || !myRow || myRow.claimable === 0n || busy} onClick={claim}>
                {busy ? <><span className="spinner" /> Claiming…</> : myRow && myRow.claimable === 0n ? "Nothing to claim right now" : `Claim ${myRow ? fmt(myRow.claimable) : ""} ${sym}`}
              </button>
            </>
          )}
          {failure && <p className="field-error" role="alert">{failure}</p>}
          {justClaimed && (
            <div className="result" role="status">
              <span className="result-mark" aria-hidden="true"><Check /></span>
              <div>
                <p className="result-title">{fmt(justClaimed.amount)} {sym} is now in this wallet</p>
                <TxLink hash={justClaimed.hash} />
              </div>
            </div>
          )}
        </section>

        {mine && myRow && <ConvertRefund token={token} amount={myRow.claimable > 0n ? myRow.claimable : myRow.claimed} owner={mine.account} />}

        <section className="card">
          <div className="card-head">
            <h2>Everyone on the refund list</h2>
            <span className="muted small">Fixed when the case opened</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th scope="col">Wallet</th><th scope="col" className="num">Lost</th><th scope="col" className="num">Claimed</th><th scope="col" className="num">Available</th></tr>
              </thead>
              <tbody>
                {allocations.map((entry) => {
                  const row = rows[entry.account];
                  return (
                    <tr key={entry.account} className={entry === mine ? "is-mine" : ""}>
                      <td><Party address={entry.account} /></td>
                      <td className="num">{fmt(BigInt(entry.allocation))}</td>
                      <td className="num">{row ? fmt(row.claimed) : "…"}</td>
                      <td className="num">{row ? fmt(row.claimable) : "…"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="col-side">
        <section className="card">
          <h2>Refund pool</h2>
          <p className="big-number">{state ? `${fmt(pool)} ${sym}` : <span className="skeleton" />}</p>
          <p className="muted">{state ? `${fmt(state.totalClaimed)} ${sym} claimed so far` : ""}</p>
          {pool > 0n && pool < loss && <p className="fine-print">Users recover {Number((pool * 10_000n) / loss) / 100}% of their loss so far. The rest paid the reward or has not come back.</p>}
          <p className="formula"><code>allocation × refund pool ÷ total loss</code></p>
          <p className="fine-print">If more funds come back later, the same user can claim again.</p>
        </section>
        <section className="card card-quiet">
          <h2>How does it know who is owed?</h2>
          <p>The list was fixed when the case opened, and the contract stores only its Merkle root. A claim must prove that the wallet and amount are on that list, so nobody can add themselves or raise their amount.</p>
          <p>The contract also accepts a claim sent by someone else, so a user with no gas can get help. The tokens still go only to the listed wallet.</p>
        </section>
        <section className="card card-quiet">
          <h2>The team cannot touch this pool</h2>
          <p>Pactum has no owner, no upgrade path and no withdraw function.</p>
        </section>
      </div>
    </div>
  );
}

function txLabel(key: string): string {
  const fixed: Record<string, string> = {
    deployMockUSD: "Deploy MockUSD",
    deployVulnerableVault: "Deploy the intentionally buggy vault",
    deployPactum: "Deploy Pactum",
    drain: "Protocol drained",
    openCase: "Case opened with the controller signature",
    approveReturn: "Holder approves the token",
    returnFunds: "Funds returned, reward paid in the same transaction",
  };
  if (fixed[key]) return fixed[key];
  const match = key.match(/^(deposit|claim|returnFunds)(\d+)$/);
  if (!match) return key;
  const position = Number(match[2]) + 1;
  if (match[1] === "deposit") return `Deposit into the protocol (${position})`;
  if (match[1] === "claim") return `Refund claim ${position}`;
  return `Return ${position}: reward paid in the same transaction`;
}

const NEAR_LABELS: Record<string, string> = {
  deployController: "Deploy controller contract",
  removeKeys: "Delete every access key of the controller",
  proposeChain: "Guardian proposes adding a chain",
  approveChain1: "Guardian 1 approves the chain",
  approveChain2: "Guardian 2 approves, the chain is added",
  propose: "Guardian proposes the offer",
  approve1: "Guardian 1 approves",
  approve2: "Guardian 2 approves, Chain Signatures signs every chain",
};

export function Ledger({ info, sessionTxs }: { info: CaseInfo; sessionTxs: SessionTx[] }) {
  const { deployment } = useApp();
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [senders, setSenders] = useState<Record<string, Address>>({});
  const near = Object.entries(deployment.near.txs ?? {}).map(([key, hash]) => ({ chain: "NEAR", label: NEAR_LABELS[key] ?? key, hash }));
  const evm = Object.entries(info.txs).map(([key, hash]) => ({ chain: "EVM", label: txLabel(key), hash: hash as string }));
  const session = sessionTxs.map((row) => ({ chain: "EVM", label: row.label, hash: row.hash as string }));
  const evmHashes = [...evm, ...session].map((row) => row.hash).join();

  // The sender of each transaction is read from the chain, so the "Sent by" column is never a guess.
  useEffect(() => {
    let cancelled = false;
    const hashes = evmHashes ? evmHashes.split(",") : [];
    Promise.all(hashes.map(async (hash) => [hash, (await client.getTransaction({ hash: hash as Hash })).from] as const))
      .then((entries) => {
        if (!cancelled) setSenders(Object.fromEntries(entries));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, evmHashes]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Public transactions</h2>
        {deployment.network === "local" && <span className="muted small">On your local Anvil node, so no explorer links</span>}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th scope="col">Chain</th><th scope="col">What happened</th><th scope="col">Sent by</th><th scope="col">Transaction</th></tr>
          </thead>
          <tbody>
            {[...near, ...evm, ...session].map((row) => (
              <tr key={`${row.chain}-${row.hash}-${row.label}`}>
                <td><span className={`chain chain-${row.chain.toLowerCase()}`}>{row.chain}</span></td>
                <td>{row.label}</td>
                <td>{row.chain === "EVM" ? (senders[row.hash] ? <Party address={senders[row.hash]!} compact /> : "…") : <span className="muted">NEAR account</span>}</td>
                <td><TxLink hash={row.hash} near={row.chain === "NEAR"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

