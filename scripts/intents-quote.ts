// Fetches a real NEAR Intents quote, the same way the Refund page does. Read only: dry mode creates no
// deposit address and moves no money, so no wallet or key is needed.
const API = "https://1click.chaindefuser.com/v0";

// Example: a victim receives 1,000 USDC on Base and wants native BTC.
// The address below only lets the API check the format; dry mode sends nothing to it.
const request = {
  dry: true,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  depositType: "ORIGIN_CHAIN",
  destinationAsset: "nep141:btc.omft.near",
  amount: "1000000000",
  refundTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  refundType: "ORIGIN_CHAIN",
  recipient: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(Date.now() + 3_600_000).toISOString(),
};

const response = await fetch(`${API}/quote`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
});
const body = await response.json();
if (!response.ok || !body.quote) {
  console.error(`NEAR Intents returned ${response.status}: ${body.message ?? "no quote"}`);
  process.exit(1);
}
const { amountInFormatted, amountOutFormatted, amountOutUsd, timeEstimate, depositAddress } = body.quote;
const grouped = (value: string) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 });
console.log(`Live NEAR Intents quote: ${grouped(amountInFormatted)} USDC on Base to ${grouped(amountOutFormatted)} BTC on Bitcoin`);
console.log(`Worth about $${Number(amountOutUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}, in about ${Math.round(timeEstimate / 60)} minutes`);
console.log(`Deposit address created: ${depositAddress ? "yes" : "no"} (dry quote, nothing was swapped)`);
