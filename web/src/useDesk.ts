// Polls the contract's state. Time follows the chain's latest block.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BaseError, ContractFunctionRevertedError, keccak256, stringToHex, type Address, type Hash, type Hex } from "viem";
import { deskAbi, offerCaseId, publicClientOf, type CaseInfo, type Deployment, type Evidence, type IncidentInfo, type PendingAsset } from "./chain";
import { readNotes } from "./useNotes";

export interface CaseState {
  totalReturned: bigint;
  totalReward: bigint;
  totalRefund: bigint;
  totalClaimed: bigint;
  open: boolean;
  rewardBps: number;
  until: bigint;
  // Terms exist but nobody has submitted the signature on chain yet, so the contract does not know this case.
  notOpened?: boolean;
}

export type CaseStatus = "Open" | "Partly returned" | "Fully returned" | "Closed";
export type IncidentStatus = CaseStatus | "Awaiting offer" | "Completed";

export function statusOf(info: CaseInfo, state: CaseState | undefined): CaseStatus | null {
  if (!state) return null;
  if (state.totalReturned >= BigInt(info.terms.maxReturn)) return "Fully returned";
  if (!state.open) return "Closed";
  return state.totalReturned > 0n ? "Partly returned" : "Open";
}

export function acceptsFunds(info: CaseInfo, state: CaseState | undefined): boolean {
  const status = statusOf(info, state);
  return status === "Open" || status === "Partly returned";
}

export interface Incident extends IncidentInfo {
  cases: CaseInfo[];
  pending: PendingAsset[];
}

export function incidentsOf(deployment: Deployment, cases: CaseInfo[], pending: PendingAsset[]): Incident[] {
  return deployment.incidents.map((incident) => ({
    ...incident,
    cases: cases.filter((item) => item.incidentId === incident.id),
    pending: pending.filter((item) => item.incidentId === incident.id),
  }));
}

export function incidentStatus(incident: Incident, states: Record<string, CaseState>): IncidentStatus | null {
  if (incident.cases.length === 0 || incident.cases.every((info) => states[info.id]?.notOpened)) return "Awaiting offer";
  const statuses = incident.cases.map((info) => statusOf(info, states[info.id]));
  if (statuses.some((item) => item === null)) return null;
  if (statuses.every((item) => item === "Fully returned")) {
    // Each person is rounded down by at most 1 unit, so a few units can remain even after everyone has claimed.
    const everyonePaid = incident.cases.every((info) => states[info.id]!.totalRefund - states[info.id]!.totalClaimed <= BigInt(info.allocations.length));
    return everyonePaid ? "Completed" : "Fully returned";
  }
  if (statuses.some((item) => item === "Open" || item === "Partly returned")) {
    const anyReturned = incident.cases.some((info) => (states[info.id]?.totalReturned ?? 0n) > 0n);
    return anyReturned ? "Partly returned" : "Open";
  }
  return "Closed";
}

// The incident's current reward rate: taken from the asset that still accepts funds and expires soonest.
export function currentOffer(incident: Incident, states: Record<string, CaseState>): CaseState | null {
  const live = incident.cases.filter((info) => acceptsFunds(info, states[info.id])).map((info) => states[info.id]!);
  if (live.length === 0) return null;
  return live.reduce((best, state) => (state.until < best.until ? state : best));
}

// Cases accepting funds come first, soonest deadline first. Then cases awaiting an offer, then fully returned ones. Closed cases are always last.
export function rankIncidents(incidents: Incident[], states: Record<string, CaseState>): Incident[] {
  const group = (incident: Incident) => {
    const status = incidentStatus(incident, states);
    if (status === "Closed") return 4;
    if (status === "Fully returned" || status === "Completed") return 3;
    if (status === "Awaiting offer") return 2;
    return status === null ? 1 : 0;
  };
  const deadline = (incident: Incident) => currentOffer(incident, states)?.until ?? 0n;
  return [...incidents].sort((a, b) => group(a) - group(b) || Number(deadline(a) - deadline(b)));
}

// Value at made-up prices, only for adding and comparing different assets in the interface.
export function usdOf(amount: bigint, token: { decimals: number; priceUsd: number }): number {
  return (Number(amount) / 10 ** token.decimals) * token.priceUsd;
}

export function incidentTotals(incident: Incident, states: Record<string, CaseState>) {
  let lost = 0;
  let reward = 0;
  let refund = 0;
  let returned = 0;
  for (const info of incident.cases) {
    lost += usdOf(BigInt(info.terms.totalLoss), info.token);
    const state = states[info.id];
    if (!state) continue;
    reward += usdOf(state.totalReward, info.token);
    refund += usdOf(state.totalRefund, info.token);
    returned += usdOf(state.totalReturned, info.token);
  }
  for (const asset of incident.pending) lost += usdOf(BigInt(asset.totalLoss), asset.token);
  return { lost, reward, refund, returned };
}

export interface DeskData {
  cases: CaseInfo[];
  pending: PendingAsset[];
  incidents: Incident[];
  states: Record<string, CaseState>;
  loaded: boolean;
  now: number;
  error: string | null;
  refresh(): Promise<void>;
}

export function useDesk(deployment: Deployment): DeskData {
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [states, setStates] = useState<Record<string, CaseState>>({});
  const [madeOffers, setMadeOffers] = useState<CaseInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const desk = deployment.contracts.Pactum;
  const notes = deployment.contracts.PublicNotes;

  const refresh = useCallback(async () => {
    try {
      // The local chain only makes a block when a transaction arrives, so "latest" stays in the past while new transactions
      // run on real time. Reading "pending" keeps the reward rate and clock in line with when a transaction would land.
      const blockTag = deployment.network === "local" ? ("pending" as const) : ("latest" as const);
      const readState = async (caseId: Hex): Promise<CaseState> => {
        const known = await client.readContract({ address: desk, abi: deskAbi, functionName: "getCase", args: [caseId] }).then(() => true, (reason: unknown) => {
          const revert = reason instanceof BaseError ? reason.walk((item) => item instanceof ContractFunctionRevertedError) : null;
          if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "CaseNotFound") return false;
          throw reason;
        });
        if (!known) return { totalReturned: 0n, totalReward: 0n, totalRefund: 0n, totalClaimed: 0n, open: false, rewardBps: 0, until: 0n, notOpened: true };
        const [state, tier] = await Promise.all([
          client.readContract({ address: desk, abi: deskAbi, functionName: "getCase", args: [caseId] }),
          client.readContract({ address: desk, abi: deskAbi, functionName: "currentTier", args: [caseId], blockTag }),
        ]);
        return { totalReturned: state.totalReturned, totalReward: state.totalReward, totalRefund: state.totalRefund, totalClaimed: state.totalClaimed, open: tier[0], rewardBps: tier[1], until: tier[2] };
      };

      // A pending asset may already have an offer: read it back from the contract, so a reload is still right.
      const offers = await Promise.all(
        deployment.pending.map(async (asset): Promise<CaseInfo | null> => {
          const caseId = offerCaseId(asset.incidentId, asset.token.symbol);
          try {
            const [stored, tiers] = await Promise.all([
              client.readContract({ address: desk, abi: deskAbi, functionName: "getCase", args: [caseId] }),
              client.readContract({ address: desk, abi: deskAbi, functionName: "getTiers", args: [caseId] }),
            ]);
            // Anyone can post a note, so only accept one whose hash matches the signed terms on the contract.
            let evidence: Evidence | undefined;
            if (notes) {
              const logs = await readNotes(client, notes, BigInt(deployment.notesBlock ?? "0"), caseId);
              const match = logs.find((log) => keccak256(stringToHex(log.args.text ?? "")) === stored.evidenceHash);
              if (match) evidence = JSON.parse(match.args.text!) as Evidence;
            }
            const opened = await client.getContractEvents({ address: desk, abi: deskAbi, eventName: "CaseOpened", args: { caseId }, fromBlock: BigInt(deployment.notesBlock ?? "0") });
            const openTx = opened[0]?.transactionHash;
            return {
              id: asset.id,
              incidentId: asset.incidentId,
              incident: asset.incident,
              token: asset.token,
              vault: asset.vault,
              allocations: asset.allocations,
              evidence,
              txs: openTx ? { ...asset.txs, openCase: openTx } : asset.txs,
              openBlock: opened[0]?.blockNumber.toString() ?? deployment.notesBlock ?? "0",
              terms: {
                caseId,
                token: stored.token,
                totalLoss: stored.totalLoss.toString(),
                maxReturn: stored.maxReturn.toString(),
                rewardCap: stored.rewardCap.toString(),
                refundRoot: stored.refundRoot,
                evidenceHash: stored.evidenceHash,
                tiers: tiers.map((tier) => ({ until: tier.until.toString(), rewardBps: tier.rewardBps })),
                nonce: "0",
                chainId: deployment.chainId.toString(),
              },
            };
          } catch {
            return null;
          }
        }),
      );
      const made = offers.filter((item): item is CaseInfo => item !== null);
      const all = [...deployment.cases, ...made];
      const [block, ...entries] = await Promise.all([client.getBlock({ blockTag }), ...all.map(async (info) => [info.id, await readState(info.terms.caseId)] as const)]);
      setMadeOffers(made);
      setStates(Object.fromEntries(entries as (readonly [string, CaseState])[]));
      setClockSkew(Number(block.timestamp) * 1000 - Date.now());
      setLoaded(true);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.split("\n")[0]! : "Could not read the contract");
    }
  }, [client, desk, notes, deployment]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(refresh, 6000);
    const clock = window.setInterval(() => setTick(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  // Recomputes when there is a new offer, and when the text of an existing offer is read.
  const madeKey = madeOffers.map((item) => `${item.id}:${item.evidence ? 1 : 0}`).join();
  const { cases, pending, incidents } = useMemo(() => {
    const allCases = [...deployment.cases, ...madeOffers];
    const stillPending = deployment.pending.filter((asset) => !madeOffers.some((item) => item.id === asset.id));
    return { cases: allCases, pending: stillPending, incidents: incidentsOf(deployment, allCases, stillPending) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment, madeKey]);

  return { cases, pending, incidents, states, loaded, now: tick + clockSkew, error, refresh };
}

export type ActivityRow =
  | { kind: "returned"; key: string; block: bigint; hash: Hash; time: number; info: CaseInfo; from: Address; rewardTo: Address; received: bigint; reward: bigint; refund: bigint; rewardBps: number }
  | { kind: "claimed"; key: string; block: bigint; hash: Hash; time: number; info: CaseInfo; account: Address; amount: bigint }
  | { kind: "opened"; key: string; block: bigint; hash: Hash; time: number; info: CaseInfo };

// History read straight from the contract's events, through no server.
export function useActivity(deployment: Deployment, desk: DeskData): { rows: ActivityRow[]; failed: boolean } {
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [failed, setFailed] = useState(false);
  const version = Object.values(desk.states).reduce((sum, state) => sum + state.totalReturned + state.totalClaimed, 0n).toString() + desk.cases.length;
  const { cases } = desk;

  useEffect(() => {
    if (cases.length === 0) return;
    let cancelled = false;
    const byCaseId = new Map(cases.map((item) => [item.terms.caseId, item]));
    const fromBlock = cases.reduce((low, item) => (BigInt(item.openBlock) < low ? BigInt(item.openBlock) : low), BigInt(cases[0]!.openBlock));
    const address = deployment.contracts.Pactum;
    (async () => {
      const [opened, returned, claimed] = await Promise.all([
        client.getContractEvents({ address, abi: deskAbi, eventName: "CaseOpened", fromBlock }),
        client.getContractEvents({ address, abi: deskAbi, eventName: "FundsReturned", fromBlock }),
        client.getContractEvents({ address, abi: deskAbi, eventName: "RefundClaimed", fromBlock }),
      ]);
      const blocks = new Set([...opened, ...returned, ...claimed].map((log) => log.blockNumber));
      const times = new Map(await Promise.all([...blocks].map(async (number) => [number, Number((await client.getBlock({ blockNumber: number })).timestamp)] as const)));
      const next: ActivityRow[] = [];
      for (const log of opened) {
        const info = byCaseId.get(log.args.caseId!);
        if (info) next.push({ kind: "opened", key: `${log.transactionHash}-${log.logIndex}`, block: log.blockNumber, hash: log.transactionHash, time: times.get(log.blockNumber)!, info });
      }
      for (const log of returned) {
        const info = byCaseId.get(log.args.caseId!);
        if (info) next.push({ kind: "returned", key: `${log.transactionHash}-${log.logIndex}`, block: log.blockNumber, hash: log.transactionHash, time: times.get(log.blockNumber)!, info, from: log.args.from!, rewardTo: log.args.rewardTo!, received: log.args.received!, reward: log.args.reward!, refund: log.args.refund!, rewardBps: log.args.rewardBps! });
      }
      for (const log of claimed) {
        const info = byCaseId.get(log.args.caseId!);
        if (info) next.push({ kind: "claimed", key: `${log.transactionHash}-${log.logIndex}`, block: log.blockNumber, hash: log.transactionHash, time: times.get(log.blockNumber)!, info, account: log.args.account!, amount: log.args.amount! });
      }
      next.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
      if (!cancelled) {
        setRows(next);
        setFailed(false);
      }
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [client, deployment, cases, version]);

  return { rows, failed };
}
