// Tests the new interface: landing, sidebar, sorting, tooltips, address labels, offers and discussion.
import { chromium } from "playwright";

const out = process.argv[2];
const base = "http://localhost:5173/";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let failed = 0;
function check(name, ok, note = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
  if (!ok) failed += 1;
}
async function fresh(viewport = { width: 1360, height: 900 }) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 220)); });
  page.on("pageerror", (e) => errors.push(`PAGE: ${e}`));
  return page;
}
const as = async (page, name) => {
  await page.locator(".wallet-button").click();
  await page.locator(".wallet-option", { hasText: new RegExp(`^${name}(?![ 0-9]*[0-9] )`) }).first().click();
  await page.waitForTimeout(350);
};
const go = async (page, hash) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(450);
};
const panel = (page) => page.innerText(".tab-panel");
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const page = await fresh();

// Landing
await page.goto(base);
await page.waitForSelector(".hero h1");
let text = await page.innerText("body");
check("landing opens with the product, not hack numbers", text.includes("Get stolen funds back without a negotiation") && !text.includes("Total lost"));
check("the new name is used everywhere on the landing", text.includes("Pactum") && !/return desk/i.test(text));
check("landing answers the proof question", text.includes("How does a hacker prove they are the hacker"));
check("landing shows the testnet warning", text.includes("Do not send real or stolen funds"));
check("logo sits top left on the landing", await page.locator(".landing-header .brand").evaluate((el) => { const r = el.getBoundingClientRect(); return r.left < 60 && r.top < 90; }));
check("the flow animation is running", await page.locator(".stream").first().evaluate((el) => getComputedStyle(el).animationName !== "none"));
await page.waitForTimeout(1700);
await page.screenshot({ path: `${out}/p1-landing.png` });
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
});
await page.waitForTimeout(1200);
check("sections reveal while scrolling", (await page.locator(".reveal:not(.is-visible)").count()) === 0, `${await page.locator(".reveal").count()} blocks`);
check("metric count-up reaches the measured values", (await page.innerText(".metrics")).includes("45/45") && (await page.innerText(".metrics")).includes("100%"));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p1b-landing-full.png`, fullPage: true });
await page.locator(".landing-header .button-primary").click();

// Sidebar and sorting
await page.waitForSelector(".case-row", { timeout: 40000 });
await page.waitForFunction(() => /\d of 5/.test(document.querySelector(".stat dd")?.textContent ?? ""), null, { timeout: 15000 });
const logo = await page.locator(".sidebar .brand").boundingBox();
check("logo sits top left in the app", logo.x < 40 && logo.y < 40);
const navLabels = await page.locator(".side-nav .side-label").allInnerTexts();
check("sections are stacked in the sidebar", navLabels.join() === "Search,Cases,Hack tracker,Activity,My wallet,Guardians", navLabels.join());
const order = await page.locator(".case-name").allInnerTexts();
check("the case closing soonest comes first", order[0] === "Tidewater Perps", order.join(" > "));
check("the closed case is last", order[order.length - 1] === "Quillon DEX");
const sideOrder = await page.locator(".side-case-name").allInnerTexts();
check("sidebar list also has the closed case last", sideOrder[sideOrder.length - 1] === "Quillon DEX");
const urgent = await page.locator(".side-badge.is-urgent").count();
check("the urgent case has a warning badge", urgent === 1);
await page.waitForTimeout(1100);
await page.screenshot({ path: `${out}/p2-cases.png`, fullPage: true });

// Several assets and the tooltip
const rows = page.locator(".case-row");
const kestrel = rows.filter({ hasText: "Kestrel" });
const kestrelText = await kestrel.innerText();
check("one incident lists several assets", kestrelText.includes("20 mBTC") && kestrelText.includes("15 mETH") && kestrelText.includes("40,000 mHYPE"), kestrelText.replace(/\s+/g, " ").slice(0, 110));
check("a short list has no ! mark", (await kestrel.locator(".more-assets").count()) === 0);
const tide = rows.filter({ hasText: "Tidewater" });
check("a long list shows +4 and !", (await tide.locator(".more-count").innerText()) === "+4" && (await tide.locator(".more-mark").innerText()) === "!");
check("tooltip is hidden before hovering", !(await tide.locator(".asset-tooltip").isVisible()));
await tide.locator(".more-assets").hover();
await page.waitForTimeout(250);
const tip = await tide.locator(".asset-tooltip").innerText();
check("hovering ! shows all 7 assets", tip.includes("All 7 assets") && ["mBTC", "mETH", "mHYPE", "mADA", "mUSDC", "mSOL", "mLINK"].every((s) => tip.includes(s)));
const box = await tide.locator(".asset-tooltip").boundingBox();
check("the tooltip is fully on screen", box.y + box.height < 900 && box.x + box.width < 1360);
await page.screenshot({ path: `${out}/p3-tooltip.png` });
const urlBefore = page.url();
check("hovering does not navigate", urlBefore === page.url());
await page.mouse.move(5, 500);

await page.selectOption(".select-field select", "mSOL");
await page.waitForTimeout(150);
check("asset filter keeps only incidents with that asset", (await page.locator(".case-row").count()) === 1);
await page.selectOption(".select-field select", "All");
await page.locator(".pill", { hasText: "Awaiting offer" }).click();
check("status filter finds the incident with no offer", (await page.locator(".case-name").allInnerTexts()).join() === "Marlin Vaults");
await page.locator(".pill", { hasText: "All" }).first().click();

// Address labels
await go(page, "#/case/kestrel/refund/mBTC");
text = await panel(page);
check("refund list labels wallets as users", /User 1\s+User/.test(text) && /User 3\s+User/.test(text), text.match(/User 1[^\n]*/)?.[0]);
check("no bare long address on the page", !/0x[0-9a-fA-F]{20,}/.test(await page.innerText("main")));
await go(page, "#/case/kestrel/incident");
text = await panel(page);
check("the timeline names the hacker and the protocol", text.includes("Hacker") && text.includes("Protocol") && !/Hacker\s*Hacker/.test(text));
check("sidebar badges are not cut off", await page.locator(".side-badge").evaluateAll((items) => items.every((el) => el.getBoundingClientRect().right <= document.querySelector(".sidebar").getBoundingClientRect().right - 8)));
check("the brand name has no negative tracking", await page.locator(".brand-name").evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing || "0") >= 0 || getComputedStyle(el).letterSpacing === "normal"));
await page.screenshot({ path: `${out}/p4-overview.png`, fullPage: true });
await go(page, "#/case/kestrel/ledger/mBTC");
await page.waitForFunction(() => document.querySelector(".tab-panel table")?.innerText.includes("Hacker"), null, { timeout: 10000 });
text = await panel(page);
check("ledger says who sent each transaction", text.includes("Hacker") && text.includes("Relayer") && text.includes("User"));

// An existing offer with special conditions
await go(page, "#/case/kestrel/offer");
text = await panel(page);
check("offer reads as keep 20%, return 80%", /Hacker keeps\s*20%/.test(text.replace(/\n/g, " ")) && /users get back\s*80%/.test(text.replace(/\n/g, " ")));
check("special conditions are shown", text.includes("Keep 20% and return 80% within 48 hours"));
check("the page says the contract does not enforce the text", text.includes("The contract does not enforce this text"));
check("the text matches its on-chain hash", text.includes("Matches this text"));
await page.screenshot({ path: `${out}/p5-offer.png`, fullPage: true });
await go(page, "#/case/kestrel/return/mBTC");
text = await page.innerText(".tab-panel");
check("return page shows the conditions too", text.includes("Special conditions from the protocol"));

// The protocol owner creates an offer
await go(page, "#/case/marlin/offer");
await as(page, "Hacker");
text = await panel(page);
check("non-owner cannot write an offer", text.includes("Only the protocol owner can write an offer") && (await page.locator(".tab-panel textarea").count()) === 0);
await go(page, "#/case/marlin/return");
check("no offer means nothing can be returned", (await panel(page)).includes("has not published an offer yet"));
await go(page, "#/case/marlin/offer");
await as(page, "Protocol owner");
check("owner sees the offer form", (await page.locator(".tab-panel textarea").count()) === 1);
const publishButton = page.locator(".tab-panel .button-block");
const keepGroup = page.getByRole("group", { name: "The hacker keeps" });
await keepGroup.getByRole("button", { name: "Custom" }).click();
const keepInput = keepGroup.locator("input");
check("keep has a custom field", await keepInput.isVisible());
await keepInput.fill("25");
await page.waitForTimeout(100);
check("25% is refused because of the controller limit", (await publishButton.isDisabled()) && (await panel(page)).includes("up to 20"));
await keepInput.fill("12.5");
await page.waitForTimeout(100);
check("a custom 12.5% is accepted", !(await publishButton.isDisabled()));
check("the preview follows the custom percent", /keeps 1\s+returns 7/.test(await panel(page)));
await keepInput.fill("12.555");
await page.waitForTimeout(80);
check("more than 2 decimals is refused", await publishButton.isDisabled());
await keepGroup.getByRole("button", { name: "20%" }).click();
const timeGroup = page.getByRole("group", { name: "If everything comes back within" });
await timeGroup.getByRole("button", { name: "Custom" }).click();
check("time has a custom field", await timeGroup.locator("input").isVisible());
await page.waitForTimeout(80);
check("an empty custom time is refused", await publishButton.isDisabled());
await timeGroup.locator("input").fill("0");
await page.waitForTimeout(80);
check("zero time is refused", await publishButton.isDisabled());
await timeGroup.locator("input").fill("36");
await timeGroup.getByRole("button", { name: "hours", exact: true }).click();
await page.waitForTimeout(80);
const laterTime = page.getByRole("group", { name: "Until" });
await laterTime.getByRole("button", { name: "Custom" }).click();
await laterTime.locator("input").fill("1");
await laterTime.getByRole("button", { name: "hours", exact: true }).click();
await page.waitForTimeout(80);
check("a later deadline before the first is refused", await publishButton.isDisabled());
await laterTime.locator("input").fill("10");
await laterTime.getByRole("button", { name: "days", exact: true }).click();
const laterGroup = page.getByRole("group", { name: "Later reward" });
await laterGroup.getByRole("button", { name: "Custom" }).click();
await laterGroup.locator("input").fill("30");
await page.waitForTimeout(100);
check("a later reward above the first is refused", await publishButton.isDisabled());
await laterGroup.locator("input").fill("7.5");
await page.waitForTimeout(100);
check("custom values make the form valid", !(await publishButton.isDisabled()));
await page.locator(".tab-panel textarea").fill("Keep 20% and we will not pursue contact. Test conditions from the owner.");
await page.waitForTimeout(150);
text = await panel(page);
check("the preview shows what the hacker keeps per asset", /mBTC\s+keeps 1\.6\s+returns 6\.4/.test(text), text.match(/mBTC[^\n]*\n?[^\n]*\n?[^\n]*/)?.[0]?.replace(/\n/g, " "));
await page.screenshot({ path: `${out}/p6-offer-form.png`, fullPage: true });
await publishButton.click();
await page.locator(".toast", { hasText: "case opened" }).first().waitFor({ timeout: 30000 });
await page.reload();
await page.waitForSelector(".tab-panel", { timeout: 15000 });
await page.waitForFunction(() => /Finish publishing|Evidence hash/.test(document.querySelector(".tab-panel")?.innerText ?? ""), null, { timeout: 15000 });
const interrupted = (await panel(page)).includes("Finish publishing your offer");
console.log("      interrupted after the first asset:", interrupted);
if (interrupted) {
  check("an interrupted publish can be finished with the same terms", (await panel(page)).includes("the holder keeps 20%") && (await page.locator(".tab-panel textarea").count()) === 0);
  await page.locator(".tab-panel .button-block").click();
}
await page.waitForFunction(() => document.querySelector(".tab-panel")?.innerText.includes("Evidence hash"), null, { timeout: 30000 });
await page.waitForTimeout(500);
text = await panel(page);
check("publishing opens the offer on every asset", /Hacker keeps\s*20%/.test(text.replace(/\n/g, " ")) && text.includes("Test conditions from the owner") && text.includes("Matches this text"), text.replace(/\n+/g, " | ").slice(0, 620));
check("every asset of the incident was opened", (await page.locator(".limit-list li").count()) === 3);
check("the incident no longer says awaiting offer", !(await page.innerText(".case-header")).includes("Awaiting offer"));
await page.reload();
await page.waitForSelector(".tab-panel", { timeout: 15000 });
await page.waitForFunction(() => document.querySelector(".tab-panel")?.innerText.includes("Test conditions"), null, { timeout: 15000 });
await page.waitForTimeout(800);
const reloaded = await panel(page);
check("the offer survives a reload, read back from the contract", reloaded.includes("Matches this text"), reloaded.match(/Evidence hash[\s\S]{0,90}/)?.[0]?.replace(/\n/g, " "));
// Another visitor in another browser with nothing saved must read the same content from the chain.
const visitor = await fresh();
await visitor.goto(`${base}#/case/marlin/offer`);
await visitor.waitForFunction(() => document.querySelector(".tab-panel")?.innerText.includes("Evidence hash"), null, { timeout: 25000 });
const seen = await panel(visitor);
check("another visitor sees the offer text, read from the chain", seen.includes("Test conditions from the owner") && seen.includes("Matches this text"));
await visitor.close();

check("the custom schedule was published", /20%\s+until[\s\S]*7\.5%\s+until/.test(await panel(page)));
// The hacker returns under the offer and gets a 20% reward
await as(page, "Hacker 3");
await go(page, "#/case/marlin/return/mBTC");
await page.waitForFunction(() => document.querySelector("[data-testid=balance]")?.textContent?.includes("mBTC"), null, { timeout: 10000 });
await page.waitForTimeout(400);
text = await panel(page);
check("asset picker lists the assets", (await page.locator(".asset-option").count()) === 3);
check("the split uses the owner's 20%", /You receive\s+1\.6 mBTC/.test(text) && /Goes to refunds\s+6\.4 mBTC/.test(text), text.match(/You receive[^\n]*\n?[^\n]*/)?.[0]?.replace(/\n/g, " "));
await page.screenshot({ path: `${out}/p7-return.png`, fullPage: true });
check("leaving the reward wallet empty is allowed", await page.locator(".optional").first().isVisible() && !(await page.locator(".tab-panel .button-block").isDisabled()));
await page.locator(".tab-panel .button-block").click();
await page.waitForSelector(".result", { timeout: 30000 });
check("return succeeds and shows the result", (await page.innerText(".result")).includes("1.6 mBTC reward"));

// Strangers and users
await as(page, "Stranger");
await go(page, "#/case/marlin/return/mETH");
await page.waitForTimeout(400);
check("stranger cannot return", (await panel(page)).includes("holds no mETH") && (await page.locator(".tab-panel .button-block").isDisabled()));
await go(page, "#/case/marlin/return/mBTC");
check("a fully returned asset says so", (await panel(page)).includes("received everything"));
await go(page, "#/case/marlin/refund/mBTC");
check("stranger cannot claim", (await panel(page)).includes("not on the refund list") && (await page.locator(".card-claim button").count()) === 0);
await as(page, "User 1");
await page.waitForFunction(() => /Available now\s+4 mBTC/.test(document.querySelector(".tab-panel")?.innerText ?? ""), null, { timeout: 10000 });
check("user 1 gets 80% of 5 mBTC", true);
await page.locator(".card-claim .button-primary").click();
await page.waitForSelector(".card-claim .result", { timeout: 30000 });
await page.waitForTimeout(400);
check("after claiming, nothing is left to claim", await page.locator(".card-claim .button-primary").isDisabled());
await page.screenshot({ path: `${out}/p8-refund.png`, fullPage: true });

// A new wallet after the funds moved through many wallets: nothing proves it is the hacker, and it can still return
await as(page, "New wallet");
await go(page, "#/case/kestrel/return/mHYPE");
await page.waitForFunction(() => document.querySelector("[data-testid=balance]")?.textContent?.includes("40,000"), null, { timeout: 10000 });
await page.waitForTimeout(300);
text = await panel(page);
check("the new wallet is not labelled as a hacker", (await page.innerText(".wallet-button")).includes("New wallet") && !(await page.innerText(".wallet-button")).includes("Hacker"));
check("the page says no proof is needed", text.includes("Do I have to prove I am the hacker?"));
check("the new wallet gets the 20% offer", /You receive\s+8,000 mHYPE/.test(text));
await page.locator("label.field input").nth(1).fill(await page.evaluate(() => "0x90F79bf6EB2c4f870365E785982E1f101E93b906"));
await page.locator(".tab-panel .button-block").click();
await page.waitForSelector(".result", { timeout: 30000 });
check("the new wallet returned the funds", (await page.innerText(".result")).includes("8,000 mHYPE reward"));

// The reward cap is explained
await go(page, "#/case/northgate/incident");
await page.waitForFunction(() => document.querySelector(".tab-panel")?.innerText.includes("The reward cap applied"), null, { timeout: 10000 });
text = await panel(page);
check("the reward cap is explained", text.includes("The reward cap applied") && text.includes("Max reward") && text.includes("limited by the reward cap"));
await page.screenshot({ path: `${out}/p14-cap.png`, fullPage: true });

// Who are you, and a typed-in wallet
await as(page, "Stranger");
check("the header asks who you are", (await page.innerText(".topbar")).includes("Who are you?"));
check("the page says which role you are in", (await page.innerText(".viewing-strip")).includes("Viewing as") && (await page.innerText(".viewing-strip")).includes("no part in any case"));
await page.locator(".wallet-button").click();
check("entering a wallet is marked optional", (await page.innerText(".wallet-custom")).includes("Optional") && (await page.innerText(".wallet-custom")).includes("no identity check"));
await page.locator("#custom-wallet").fill("0x123");
check("a bad address cannot be viewed", await page.locator(".wallet-custom .button").isDisabled());
await page.waitForTimeout(350);
check("the wallet menu is solid, not see-through", await page.locator(".wallet-popover").evaluate((el) => { const c = getComputedStyle(el); return c.opacity === "1" && !c.backgroundColor.includes("0)"); }));
await page.screenshot({ path: `${out}/p15-who.png` });
await page.locator("#custom-wallet").fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
await page.locator(".wallet-custom .button").click();
await page.waitForTimeout(300);
check("the typed wallet is shown as view only", (await page.innerText(".wallet-button")).includes("View only") && (await page.innerText(".viewing-strip")).includes("cannot send transactions"));
await go(page, "#/case/marlin/refund/mBTC");
await page.waitForFunction(() => /You lost/.test(document.querySelector(".tab-panel")?.innerText ?? ""), null, { timeout: 8000 });
check("view only shows that wallet's refund but cannot claim", (await page.locator(".card-claim button").isDisabled()) && (await panel(page)).includes("Connect that wallet to claim"));
await page.locator(".wallet-button").click();
await page.locator("#custom-wallet").fill("0x000000000000000000000000000000000000bEEF");
await page.locator(".wallet-custom .button").click();
await page.waitForTimeout(300);
check("an unknown wallet is simply unknown", (await page.innerText(".viewing-strip")).includes("does not need to"));
check("a home link is not in the sidebar, but the logo goes home", (await page.locator(".sidebar .brand").getAttribute("href")) === "#/" && (await page.locator(".side-nav .side-link", { hasText: "Home" }).count()) === 0);
await as(page, "User 1");

// NEAR Intents: a real quote for a refund, with no swap
await as(page, "User 3");
await go(page, "#/case/kestrel/refund/mBTC");
await page.waitForSelector(".convert", { timeout: 20000 });
text = await page.innerText(".convert");
check("the refund page offers another asset through NEAR Intents", text.includes("Receive it in another asset") && text.includes("NEAR Intents"));
check("it warns what a quote sends out", text.includes("sends the amount and this destination address"));
check("with nothing returned yet there is nothing to convert", (await page.innerText(".convert-button")).includes("Nothing available"));
// Northgate is fully returned and User 3 has not claimed, so there is a real amount to quote.
await go(page, "#/case/northgate/refund/mUSDC");
await page.waitForSelector(".convert", { timeout: 20000 });
await page.waitForFunction(() => /Available now\s+292,500 mUSDC/.test(document.querySelector(".tab-panel")?.innerText ?? ""), null, { timeout: 15000 });
await page.locator(".convert input").fill("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
await page.locator(".convert-button").click();
await page.waitForSelector(".quote-result, .convert .field-error", { timeout: 30000 });
const liveQuote = await page.innerText(".convert");
check("a live quote comes back for the user's refund", /About\s+[0-9.]+ BTC/.test(liveQuote), liveQuote.match(/About[^\n]*/)?.[0] ?? liveQuote.slice(-140));
check("the quote says nothing was swapped", liveQuote.includes("Nothing was swapped"));
await page.locator(".convert input").fill("not-an-address");
await page.locator(".convert-button").click();
await page.waitForSelector(".convert .field-error", { timeout: 30000 });
check("a bad destination shows the service's own error", (await page.innerText(".convert .field-error")).includes("NEAR Intents returned"));
await page.getByRole("button", { name: "USDC on Base" }).click();
await page.waitForTimeout(150);
check("an EVM destination fills in this wallet", ((await page.locator(".convert input").inputValue()).toLowerCase()) === "0x90f79bf6eb2c4f870365e785982e1f101e93b906");
await page.screenshot({ path: `${out}/p16-intents.png`, fullPage: true });

// FAQ
await as(page, "Hacker 2");
await go(page, "#/faq");
text = await page.innerText("main");
check("FAQ opens the group for the current role", text.includes("Do I have to prove I am the hacker?"));
check("FAQ has all three groups", ["Holding the funds", "Lost funds", "Running a protocol"].every((name) => text.includes(name)));
await as(page, "User 1");
await page.locator(".faq-tab", { hasText: "Lost funds" }).click();
await page.waitForTimeout(150);
check("FAQ shows the users' questions", (await page.innerText("main")).includes("Will I definitely get my money back?"));
check("answers start closed", (await page.locator(".faq-item.is-open").count()) === 0);
await page.locator(".faq-question", { hasText: "Will I definitely" }).click();
await page.waitForTimeout(320);
check("a question opens to its answer", (await page.locator(".faq-item.is-open").innerText()).includes("It depends on whether the holder returns"));
await page.screenshot({ path: `${out}/p17-faq.png`, fullPage: true });
await page.locator(".faq-search input").fill("prosecution");
await page.waitForTimeout(150);
check("FAQ search looks across every group", (await page.locator(".faq-item").count()) >= 1 && (await page.innerText(".faq-list")).includes("Holding the funds"));
await page.locator(".faq-search input").fill("zzzz");
await page.waitForTimeout(100);
check("an empty FAQ search says so", (await page.innerText("main")).includes("No question matches"));

// Discussion
await go(page, "#/case/kestrel/discussion");
text = await panel(page);
check("discussion shows comments read from the chain", text.includes("Protocol owner") && text.includes("Is 20% too generous?"));
check("comment authors carry labels", text.includes("Lost funds"));
check("sample comments show their own ages", /\d+[mh] ago/.test(text));
check("the page says comments are public and permanent", text.includes("Public and permanent") && text.includes("no server"));
const before = await page.locator(".comment").count();
await as(page, "Stranger");
check("a stranger's composer has no Lost funds label", (await page.locator(".composer-author .lost-funds").count()) === 0);
await as(page, "User 1");
check("a victim's composer has the Lost funds label", (await page.locator(".composer-author .lost-funds").count()) === 1);
check("an empty comment cannot be posted", await page.locator(".composer-foot .button").isDisabled());
await page.locator(".tab-panel textarea").fill("<b>Will I get my ETH back?</b>");
await page.locator(".composer-foot .button").click();
await page.waitForFunction((n) => document.querySelectorAll(".comment").length === n, before + 1, { timeout: 30000 });
check("the comment appears first", (await page.locator(".comment-text").first().innerText()).includes("<b>Will I get my ETH back?</b>"));
check("HTML in a comment is shown as text", (await page.locator(".comment-text b").count()) === 0);
const reader = await fresh();
await reader.goto(`${base}#/case/kestrel/discussion`);
await reader.waitForFunction((n) => document.querySelectorAll(".comment").length === n, before + 1, { timeout: 25000 });
check("another visitor sees the new comment", (await reader.locator(".comment-text").first().innerText()).includes("Will I get my ETH back?"));
check("the author's Lost funds label cannot be faked, it follows the wallet", (await reader.locator(".comment").first().innerText()).includes("Lost funds"));
await reader.close();
check("comments cannot be deleted", (await page.locator(".comment .link-button").count()) === 0);
await page.locator(".wallet-button").click();
await page.locator("#custom-wallet").fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
await page.locator(".wallet-custom .button").click();
await page.waitForTimeout(250);
await page.locator(".tab-panel textarea").fill("from a typed-in wallet");
check("a typed-in wallet cannot post", await page.locator(".composer-foot .button").isDisabled());
await as(page, "User 1");
await page.screenshot({ path: `${out}/p9-discussion.png`, fullPage: true });

// Other pages
await go(page, "#/wallet");
await page.waitForSelector(".wallet-list li", { timeout: 15000 });
check("My wallet lists refunds across incidents", (await page.locator(".wallet-row").count()) >= 3, `${await page.locator(".wallet-row").count()} rows`);
await page.screenshot({ path: `${out}/p10-wallet.png`, fullPage: true });
await go(page, "#/activity");
await page.waitForSelector(".feed-row", { timeout: 15000 });
text = await page.innerText(".feed");
check("activity names people, not addresses", text.includes("Hacker") && text.includes("User") && !/0x[0-9a-fA-F]{20,}/.test(text));
await page.screenshot({ path: `${out}/p11-activity.png` });
await go(page, "#/tracker");
text = await page.innerText("main");
check("tracker keeps real events separate", text.includes("None of these organizations uses Pactum") && text.includes("Binance"));
await page.locator(".tracker-head", { hasText: "Bitget" }).click();
await page.waitForTimeout(350);
check("tracker rows expand", await page.locator(".tracker-item.is-open", { hasText: "Bitget" }).isVisible());
await go(page, "#/how");
check("how it works explains permissions", (await page.innerText("main")).includes("Who can do what"));

// Search
await page.keyboard.press("Control+k");
await page.waitForSelector(".palette");
await page.keyboard.type("msol");
await page.waitForTimeout(100);
check("search finds an incident by asset", (await page.innerText(".palette-list")).includes("Tidewater Perps"));
await page.keyboard.press("Enter");
await page.waitForTimeout(350);
check("Enter opens the result", page.url().includes("#/case/tidewater"));

// Collapsed sidebar
await page.locator(".sidebar-toggle").click();
await page.waitForTimeout(350);
check("sidebar collapses", (await page.locator(".sidebar").boundingBox()).width < 80);
await page.locator(".sidebar-toggle").click();

// Phone
const phone = await fresh({ width: 375, height: 800 });
await phone.goto(base);
await phone.waitForSelector(".hero h1");
await phone.waitForTimeout(400);
check("landing has no sideways scroll on a phone", !(await overflow(phone)));
await phone.screenshot({ path: `${out}/p12-phone-landing.png` });
await phone.goto(`${base}#/cases`);
await phone.waitForSelector(".case-row", { timeout: 20000 });
await phone.waitForTimeout(500);
check("cases has no sideways scroll on a phone", !(await overflow(phone)));
await phone.screenshot({ path: `${out}/p13-phone-cases.png`, fullPage: true });
check("sidebar is hidden on a phone", (await phone.locator(".sidebar").boundingBox()).x < 0);
await phone.locator(".menu-button").click();
await phone.waitForTimeout(350);
check("menu opens the sidebar", (await phone.locator(".sidebar").boundingBox()).x === 0);
await phone.locator(".side-link", { hasText: "Activity" }).click();
await phone.waitForTimeout(450);
check("choosing a section closes the menu", (await phone.locator(".sidebar").boundingBox()).x < 0);
for (const hash of ["#/guardians", "#/faq", "#/activity", "#/tracker", "#/wallet", "#/how", "#/case/tidewater/incident", "#/case/kestrel/offer", "#/case/tidewater/return/mUSDC", "#/case/tidewater/refund/mUSDC", "#/case/kestrel/discussion", "#/case/tidewater/ledger/mETH"]) {
  await go(phone, hash);
  await phone.waitForTimeout(250);
  const wide = await overflow(phone);
  check(`${hash} has no sideways scroll on a phone`, !wide);
  if (wide) console.log("      wider than the screen:", await phone.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest(".table-wrap")).slice(0, 6).map((el) => `${el.tagName}.${el.className} right=${Math.round(el.getBoundingClientRect().right)}`).join(" | ")));
}

// The Guardians page reads the real controller on NEAR testnet even in the local build.
const guardians = await fresh();
await guardians.goto(`${base}#/guardians`);
await guardians.waitForSelector(".proposal", { timeout: 30000 });
const guardiansText = await guardians.innerText("main");
check("guardians page says the local cases are simulated", guardiansText.includes("use a test key in place of NEAR"));
const servedChains = await guardians.locator(".chain-list .party-name").allInnerTexts();
check("guardians page shows all three chains", servedChains.join() === "Sepolia,Base Sepolia,Robinhood testnet", servedChains.join());
check("guardians page shows the rule and the limit", guardiansText.includes("2 of 3 guardians") && guardiansText.includes("20% on every chain"));
check("guardians page reports no access keys", guardiansText.includes("0. Nobody can change this contract"));
const proposalCount = await guardians.locator(".proposal").count();
check("one offer has one approval round for three chains", (await guardians.locator(".proposal").last().innerText()).includes("Approved once by Guardian A, Guardian B") && (await guardians.locator(".proposal").last().locator(".offer-chain").count()) === 3);
check("the vote that added a chain is shown", guardiansText.includes("Added by a guardian vote") && guardiansText.includes("Robinhood testnet"));
const proposalChains = await guardians.locator(".offer-chain-name").allInnerTexts();
check("the offer lists a case on each chain", servedChains.every((name) => proposalChains.includes(name)), proposalChains.join());
check("the guardians can read the offer", guardiansText.includes("Keep 10% if the funds come back within 72 hours"));
check("every offer text matches its hash", (await guardians.locator(".proposal-hash.is-good").count()) === proposalCount);
await guardians.waitForFunction(() => [...document.querySelectorAll(".offer-chain")].every((el) => /Open/.test(el.textContent ?? "")), null, { timeout: 30000 });
check("each case is read back from its own chain", true);
await guardians.locator(".proposal-record summary").first().click();
check("the full record opens", (await guardians.locator(".proposal-record pre").first().innerText()).includes("drainTx"));
await guardians.screenshot({ path: `${out}/p14-guardians.png`, fullPage: true });

// Reduced motion
const calm = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: "reduce" })).newPage();
await calm.goto(base);
await calm.waitForSelector(".hero h1");
await calm.waitForTimeout(300);
check("reduced motion shows content without waiting", (await calm.locator(".reveal:not(.is-visible)").count()) === 0);

check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
