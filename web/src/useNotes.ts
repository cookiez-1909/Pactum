// Reads public notes from PublicNotes events. No server: everyone who opens the page reads the same data.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hash, Hex, PublicClient } from "viem";
import { notesAbi, publicClientOf, type Deployment } from "./chain";

export interface PublicNote {
  key: string;
  author: Address;
  text: string;
  hash: Hash;
  block: bigint;
  time: number;
}

// Public RPC limits the block range per read, so read in chunks.
const BLOCKS_PER_REQUEST = 40_000n;

export async function readNotes(client: PublicClient, address: Address, fromBlock: bigint, topic: Hex) {
  // Do not use a cached block number, or a note just posted would not be read yet.
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const logs = [];
  for (let start = fromBlock; start <= latest; start += BLOCKS_PER_REQUEST) {
    const end = start + BLOCKS_PER_REQUEST - 1n < latest ? start + BLOCKS_PER_REQUEST - 1n : latest;
    logs.push(...(await client.getContractEvents({ address, abi: notesAbi, eventName: "Note", args: { topic }, fromBlock: start, toBlock: end })));
  }
  return logs;
}

export function useNotes(deployment: Deployment, topic: Hex): { notes: PublicNote[]; failed: boolean; loaded: boolean; reload(): Promise<void> } {
  const client = useMemo(() => publicClientOf(deployment), [deployment]);
  const [notes, setNotes] = useState<PublicNote[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const address = deployment.contracts.PublicNotes;
  const fromBlock = BigInt(deployment.notesBlock ?? "0");

  const reload = useCallback(async () => {
    if (!address) {
      setLoaded(true);
      return;
    }
    try {
      const logs = await readNotes(client, address, fromBlock, topic);
      const blocks = [...new Set(logs.map((log) => log.blockNumber))];
      const times = new Map(await Promise.all(blocks.map(async (number) => [number, Number((await client.getBlock({ blockNumber: number })).timestamp)] as const)));
      setNotes(logs.map((log) => ({ key: `${log.transactionHash}-${log.logIndex}`, author: log.args.author!, text: log.args.text!, hash: log.transactionHash, block: log.blockNumber, time: times.get(log.blockNumber)! })));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [address, client, fromBlock, topic]);

  useEffect(() => {
    void reload();
    const poll = window.setInterval(reload, 8000);
    return () => window.clearInterval(poll);
  }, [reload]);

  return { notes, failed, loaded, reload };
}
