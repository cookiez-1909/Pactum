// Shared NEAR Intents helpers: the real asset list, sample quotes, and each wallet's payout choice.
// Every quote is in dry mode: no deposit address is created and no money moves.
const API = "https://1click.chaindefuser.com/v0";

export interface IntentsToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
}

let tokenList: Promise<IntentsToken[]> | null = null;

// Several screens need this list, so it loads once. On failure it loads again next time.
export function loadIntentsTokens(): Promise<IntentsToken[]> {
  tokenList ??= fetch(`${API}/tokens`)
    .then((response) => {
      if (!response.ok) throw new Error("tokens");
      return response.json() as Promise<IntentsToken[]>;
    })
    .catch((reason) => {
      tokenList = null;
      throw reason;
    });
  return tokenList;
}

const CHAIN_NAME: Record<string, string> = {
  abs: "Abstract", aptos: "Aptos", arb: "Arbitrum", avax: "Avalanche", base: "Base", bch: "Bitcoin Cash", bera: "Berachain", bsc: "BNB Chain",
  btc: "Bitcoin", cardano: "Cardano", dash: "Dash", doge: "Dogecoin", eth: "Ethereum", gnosis: "Gnosis", hood: "Robinhood Chain", hypercore: "HyperCore",
  ltc: "Litecoin", monad: "Monad", near: "NEAR", op: "Optimism", plasma: "Plasma", pol: "Polygon", scroll: "Scroll", sol: "Solana", starknet: "Starknet",
  stellar: "Stellar", sui: "Sui", ton: "TON", tron: "Tron", xlayer: "X Layer", xrp: "XRP Ledger", zec: "Zcash",
};

export const chainName = (id: string) => CHAIN_NAME[id] ?? id.toUpperCase();

const EVM = new Set(["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "scroll"]);

// EVM chains share the connected wallet's address, so it can be filled in.
export const isEvmChain = (id: string) => EVM.has(id);

export interface Quote {
  amountOut: string;
  usdOut: string;
  seconds: number;
}

export async function dryQuote(input: { originAsset: string; destinationAsset: string; amount: string; refundTo: string; recipient: string }): Promise<Quote> {
  const response = await fetch(`${API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: input.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: input.destinationAsset,
      amount: input.amount,
      refundTo: input.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: input.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.quote) throw new Error(body.message ?? "No quote is available for this route.");
  return { amountOut: body.quote.amountOutFormatted, usdOut: body.quote.amountOutUsd, seconds: body.quote.timeEstimate };
}

// Where the user wants to receive funds. Saved only in this browser, per wallet.
export interface PayoutChoice {
  assetId: string;
  symbol: string;
  blockchain: string;
  recipient: string;
}

const payoutKey = (owner: string) => `pactum-payout:${owner.toLowerCase()}`;

export function savedPayout(owner: string): PayoutChoice | null {
  try {
    const text = localStorage.getItem(payoutKey(owner));
    return text ? (JSON.parse(text) as PayoutChoice) : null;
  } catch {
    return null;
  }
}

export function savePayout(owner: string, choice: PayoutChoice | null): void {
  try {
    if (choice) localStorage.setItem(payoutKey(owner), JSON.stringify(choice));
    else localStorage.removeItem(payoutKey(owner));
  } catch {
    // The browser blocks storage: the choice only lasts for this session.
  }
}
