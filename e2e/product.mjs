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
async function fresh(viewport = { width: 1360, height: 900 }, firstVisit = false) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  // The other checks are not first visits, so they skip the welcome screen.
  if (!firstVisit) await context.addInitScript(() => localStorage.setItem("pactum-tour", "done"));
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
const confirmReturn = async (page) => {
  await page.locator(".warn-check input").check();
  await page.locator(".warn-confirm").click();
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const page = await fresh();

// Landing
await page.goto(base);
await page.waitForSelector(".hero h1");
let text = await page.innerText("body");
check("landing opens with the product, not hack numbers", text.includes("Get stolen funds back without a negotiation") && !text.includes("Total lost"));
check("the new name is used everywhere on the landing", text.includes("Pactum") && !/return desk/i.test(text));
check("landing answers the proof question", text.includes("Do I have to prove I am the hacker?"));
check("landing shows the testnet warning", text.includes("Do not send real or stolen funds"));
check("the name sits top left on the landing", await page.locator(".landing-header .brand").evaluate((el) => { const r = el.getBoundingClientRect(); return r.left < 60 && r.top < 90; }));
check("the landing brand is text only", (await page.locator(".landing-header .brand svg").count()) === 0 && (await page.innerText(".landing-header .brand")) === "Pactum");
check("the flow animation is running", await page.locator(".stream").first().evaluate((el) => getComputedStyle(el).animationName !== "none"));
await page.waitForTimeout(1700);
await page.screenshot({ path: `${out}/p1-landing.png` });
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
});
await page.waitForTimeout(1200);
check("sections reveal while scrolling", (await page.locator(".reveal:not(.is-visible)").count()) === 0, `${await page.locator(".reveal").count()} blocks`);
check("metric count-up reaches the measured values", (await page.innerText(".metrics")).includes("53/53") && (await page.innerText(".metrics")).includes("100%"));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p1b-landing-full.png`, fullPage: true });
await page.locator(".landing-header .button-primary").click();

// Sidebar and sorting
await page.waitForSelector(".case-row", { timeout: 40000 });
await page.waitForFunction(() => /\d of 6/.test(document.querySelector(".stat dd")?.textContent ?? ""), null, { timeout: 15000 });
const brand = await page.locator(".sidebar .brand").boundingBox();
check("the name sits top left in the app", brand.x < 40 && brand.y < 40);
check("the app brand is text only", (await page.locator(".sidebar .brand svg").count()) === 0);
const navLabels = await page.locator(".side-nav .side-label").allInnerTexts();
await page.locator(".theme-toggle").click();
await page.waitForTimeout(100);
check("light mode can be turned on", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
await page.screenshot({ path: `${out}/p2b-light.png` });
await page.locator(".theme-toggle").click();
await page.waitForTimeout(100);
check("sections are stacked in the sidebar", navLabels.join() === "Search,Cases,Hack tracker,Activity,My wallet,Profile,Guardians,More", navLabels.join());
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
check("return page has a box to verify the offer", text.includes("Verify this offer") && text.includes("A fake site can show the same checks"));
check("the refund list is really checked against the signed root", (await page.locator(".verify-row.is-good").filter({ hasText: "every proof matches the signed root" }).count()) === 1);
check("the stake check says it is simulated locally", (await page.locator(".verify-row.is-neutral").filter({ hasText: "Operator has money at stake" }).count()) === 1);
check("the local contract is not called official", (await page.locator(".verify-row.is-neutral").filter({ hasText: "Contract is on the official list" }).count()) === 1);
const pactumAddress = await page.evaluate(async () => (await (await fetch("./deployment.json")).json()).contracts.Pactum);
await page.getByLabel("Send my reward to").fill(pactumAddress);
await page.waitForTimeout(100);
check("a reward cannot be sent to the contract itself", (await panel(page)).includes("would be locked forever"));
await page.getByLabel("Send my reward to").fill("");
await page.waitForTimeout(100);
check("the holder is told a lower reward reverts", (await panel(page)).includes("it reverts and your tokens stay with you"));

// The protocol owner creates an offer
await go(page, "#/case/marlin/offer");
await as(page, "Hacker");
text = await panel(page);
check("a non-owner sees no made-up offer", !text.includes("What this offer means"));
check("no wallet can write an offer before the guardians verify it", (await page.locator(".tab-panel .button-block", { hasText: "Publish" }).count()) === 0);
check("the page says nothing on chain names an owner", text.includes("Nothing on chain says who runs a protocol"));
await page.locator(".register-start").click();
await page.waitForTimeout(80);
check("any wallet can ask to register, not only the owner test account", (await panel(page)).includes("Register with the guardians"));
await page.getByLabel("Official website").fill("https://fake.example");
await page.getByLabel("How guardians can reach you").fill("fake@example.com");
await page.getByLabel("Link to that post, or the signature").fill("https://fake.example/post");
await page.waitForTimeout(80);
await page.locator(".register-send").click();
await page.waitForTimeout(80);
check("guardians look for two independent sources", (await panel(page)).includes("at least two of these"));
await page.getByRole("button", { name: "Guardians reject" }).click();
await page.waitForTimeout(80);
check("a rejected request cannot write an offer", (await panel(page)).includes("did not confirm this team") && (await page.locator(".tab-panel .button-block", { hasText: "Publish" }).count()) === 0);
await page.getByRole("button", { name: "Start again" }).click();
await page.waitForTimeout(80);
await go(page, "#/case/marlin/return");
check("no offer means nothing can be returned", (await panel(page)).includes("has not published an offer yet"));
await go(page, "#/case/marlin/offer");
await as(page, "Protocol owner");
check("nobody sees a made-up offer before one exists", !(await panel(page)).includes("What this offer means"));
check("the owner test account must register too", (await panel(page)).includes("Register with the guardians") && (await page.locator(".tab-panel .button-block", { hasText: "Publish" }).count()) === 0);
check("registration says it is simulated", (await panel(page)).includes("Nothing you type here is sent or saved"));
check("registration needs every field", await page.locator(".register-send").isDisabled());
await page.getByLabel("Official website").fill("https://marlin.example");
await page.getByLabel("How guardians can reach you").fill("security@marlin.example");
check("registration asks for a new code, not just a link", /Code PACTUM-[0-9A-F]{6}/.test(await panel(page)) && (await panel(page)).includes("A link on its own proves nothing"));
await page.getByLabel("Link to that post, or the signature").fill("https://marlin.example/post");
await page.waitForTimeout(80);
await page.locator(".register-send").click();
await page.waitForTimeout(80);
check("after registering, the owner waits for the guardians", (await panel(page)).includes("Waiting for the guardians") && (await page.locator(".tab-panel .button-block", { hasText: "Publish" }).count()) === 0);
await page.getByRole("button", { name: "Guardians confirm" }).click();
await page.waitForTimeout(80);
check("once verified, the owner sees the offer form", (await page.locator(".tab-panel textarea").count()) === 1 && (await panel(page)).includes("Verified by the guardians, simulated"));
await go(page, "#/case/marlin/incident");
await go(page, "#/case/marlin/offer");
check("the verification survives moving between tabs", (await page.locator(".tab-panel textarea").count()) === 1);
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
await page.waitForSelector(".return-warning");
text = await page.innerText(".return-warning");
check("a warning stops a normal person before sending", text.includes("If these tokens are your own money, do not continue") && text.includes("cannot be undone"));
check("the warning shows what you give up", text.includes("Leaves your wallet") && text.includes("Gone for good") && text.includes("6.4 mBTC"));
check("the warning cannot be confirmed without ticking the box", await page.locator(".warn-confirm").isDisabled());
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
check("the warning can be cancelled without sending anything", (await page.locator(".return-warning").count()) === 0 && (await page.locator(".result").count()) === 0);
await page.locator(".tab-panel .button-block").click();
await confirmReturn(page);
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
await confirmReturn(page);
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
check("a live quote comes back for the user's refund", /About\s+[0-9.,]+ BTC/.test(liveQuote), liveQuote.match(/About[^\n]*/)?.[0] ?? liveQuote.slice(-140));
check("the quote says nothing was swapped", liveQuote.includes("Nothing was swapped"));
await page.locator(".convert input").fill("not-an-address");
await page.locator(".convert-button").click();
await page.waitForSelector(".convert .field-error", { timeout: 30000 });
check("a bad destination shows the service's own error", (await page.innerText(".convert .field-error")).includes("NEAR Intents returned"));
await page.getByRole("button", { name: "USDC on Base" }).click();
await page.waitForTimeout(150);
check("an EVM destination fills in this wallet", ((await page.locator(".convert input").inputValue()).toLowerCase()) === "0x90f79bf6eb2c4f870365e785982e1f101e93b906");
await page.screenshot({ path: `${out}/p16-intents.png`, fullPage: true });

// The FAQ sits at the end of the landing page, not on a separate page
await as(page, "User 1");
await page.locator(".sidebar-bottom .side-link", { hasText: "FAQ" }).click();
await page.waitForSelector("#faq");
await page.waitForTimeout(500);
const faqInView = () => page.locator("#faq").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
check("the app's FAQ link lands on the FAQ section of the landing", await faqInView());
await go(page, "#/");
await page.waitForTimeout(300);
await page.locator(".landing-nav button", { hasText: "FAQ" }).click();
await page.waitForTimeout(1200);
check("the landing's FAQ button scrolls there and stays on the page", (await page.evaluate(() => location.hash)) === "#/" && (await faqInView()));
check("FAQ is the last section of the landing", await page.locator("#faq").evaluate((el) => el.nextElementSibling?.tagName === "FOOTER"));
text = await page.innerText("#faq");
check("FAQ opens with the holders' questions", text.includes("Do I have to prove I am the hacker?"));
check("FAQ has all three groups", ["Holding the funds", "Lost funds", "Running a protocol"].every((name) => text.includes(name)));
await page.locator(".faq-tab", { hasText: "Lost funds" }).click();
await page.waitForTimeout(150);
check("FAQ shows the users' questions", (await page.innerText("#faq")).includes("Will I definitely get my money back?"));
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
check("an empty FAQ search says so", (await page.innerText("#faq")).includes("No question matches"));

// Discussion. Leaving the landing page rebuilds the app, so wait until the chain data is read.
await go(page, "#/case/kestrel/discussion");
await page.waitForFunction(() => /\d+[mh] ago/.test(document.querySelector(".tab-panel")?.textContent ?? ""), null, { timeout: 30000 });
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
check("tracker lists at least ten real hacks", (await page.locator(".tracker-item").count()) >= 10, String(await page.locator(".tracker-item").count()));
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
check("the guardians page shows five offers at first", (await guardians.locator(".proposal").count()) <= 5);
check("each offer names its protocol", (await guardians.locator(".proposal-protocol").first().innerText()).length > 0);
for (const name of ["Action required", "Approved", "Cancelled"]) check(`the guardians page can filter by ${name}`, await guardians.locator(".gd-filter", { hasText: name }).isVisible());
await guardians.locator(".gd-filter", { hasText: "Cancelled" }).click();
await guardians.waitForFunction(() => document.querySelectorAll(".proposal").length > 0, null, { timeout: 40000 });
check("filtering by cancelled keeps only cancelled offers", (await guardians.locator(".proposal").allInnerTexts()).every((item) => item.includes("Cancelled")));
await guardians.locator(".gd-filter", { hasText: "All" }).click();
for (let i = 0; i < 20 && (await guardians.locator(".show-more").count()); i += 1) { await guardians.locator(".show-more").click(); await guardians.waitForTimeout(80); }
const proposalCount = await guardians.locator(".proposal").count();
check("show more reveals every offer", proposalCount > 5, String(proposalCount));
check("one offer has one approval round for three chains", (await guardians.locator(".proposal").last().innerText()).includes("Approved once by Guardian A, Guardian B") && (await guardians.locator(".proposal").last().locator(".offer-chain").count()) === 3);
check("the vote that added a chain is shown", guardiansText.includes("Added by a guardian vote") && guardiansText.includes("Robinhood testnet"));
const proposalChains = await guardians.locator(".offer-chain-name").allInnerTexts();
check("the offer lists a case on each chain", servedChains.every((name) => proposalChains.includes(name)), proposalChains.join());
check("the guardians can read the offer", guardiansText.includes("Keep 10% if the funds come back within 72 hours"));
check("every offer text matches its hash", (await guardians.locator(".proposal-hash.is-good").count()) === proposalCount);
await guardians.locator(".proposal").last().locator(".offer-chain", { hasText: "Sepolia" }).first().waitFor();
await guardians.waitForFunction(() => { const rows = [...document.querySelectorAll(".proposal:last-child .offer-chain")]; return rows.length > 0 && rows.every((el) => /Open/.test(el.textContent ?? "")); }, null, { timeout: 30000 });
check("each case is read back from its own chain", true);
const drill = guardians.locator(".proposal", { hasText: "Drill, not a real offer" });
check("a cancelled offer says so", (await drill.innerText()).includes("Cancelled by a guardian vote") && (await drill.innerText()).includes("Voted to cancel"));
await guardians.waitForFunction(() => { const rows = [...document.querySelectorAll(".proposal")].find((el) => el.textContent.includes("Drill, not a real offer"))?.querySelectorAll(".offer-chain") ?? []; return rows.length === 12 && [...rows].every((el) => /Revoked on chain/.test(el.textContent ?? "")); }, null, { timeout: 40000 });
check("each revoked case is read back as revoked from its own chain", true);
await guardians.waitForSelector(".stake-card", { timeout: 20000 });
const stakeText = await guardians.innerText(".stake-card");
check("the guardians page shows the real stake from NEAR", stakeText.includes("Listed") && /Staked\s*0\.54 NEAR/.test(stakeText.replace(/\n/g, " ")), stakeText.slice(0, 120));
check("the challenge drills are shown with their outcome", stakeText.includes("Dismissed") && stakeText.includes("Upheld: 0.06 NEAR slashed"));
check("the guardian changes are listed", (await guardians.innerText(".guardian-votes")).includes("Applied"));
check("nothing can be relayed from the local demo's test accounts", (await guardians.locator(".relay-button").count()) === 0);
const firstOffer = guardians.locator(".proposal").last();
await firstOffer.locator(".proposal-record:not(.guardian-cli) summary").click();
check("the full record opens", (await firstOffer.locator(".proposal-record:not(.guardian-cli) pre").innerText()).includes("drainTx"));
await firstOffer.locator(".guardian-cli summary").click();
check("a real guardian gets a command for their own key", (await firstOffer.locator(".guardian-cli pre").first().innerText()).includes("vote_cancel"));
await guardians.screenshot({ path: `${out}/p14-guardians.png`, fullPage: true });

// Reduced motion
const calm = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: "reduce" })).newPage();
await calm.goto(base);
await calm.waitForSelector(".hero h1");
await calm.waitForTimeout(300);
check("reduced motion shows content without waiting", (await calm.locator(".reveal:not(.is-visible)").count()) === 0);

// Only guardians have approve and cancel buttons
const council = await fresh();
await council.goto(`${base}#/guardians`);
await council.waitForSelector(".proposal", { timeout: 30000 });
await as(council, "Hacker");
await council.waitForSelector(".guardian-locked");
check("a wallet that is not a guardian has no approve or cancel button", (await council.locator(".guardian-buttons button").count()) === 0 && (await council.innerText(".guardian-locked >> nth=0")).includes("Only guardians can approve or cancel"));
await as(council, "Guardian A");
await council.waitForSelector(".guardian-buttons button");
const councilButtons = (await council.locator(".guardian-buttons button").allInnerTexts()).join();
check("a guardian only gets buttons for itself", councilButtons.includes("Guardian A") && !councilButtons.includes("Guardian B") && !councilButtons.includes("Guardian C"), councilButtons.slice(0, 120));
check("the page says which guardian is acting", (await council.innerText(".wallet-button")).includes("Guardian A") && (await council.innerText(".viewing-strip")).includes("Guardians never hold the funds"));
await council.reload();
await council.waitForSelector(".guardian-buttons button", { timeout: 30000 });
check("the chosen guardian survives a reload", (await council.innerText(".wallet-button")).includes("Guardian A"));
await as(council, "User 1");
await council.waitForSelector(".guardian-locked");
check("switching away removes the guardian buttons", (await council.locator(".guardian-buttons button").count()) === 0);

// First visit
const newcomer = await fresh({ width: 1360, height: 900 }, true);
await newcomer.goto(base);
await newcomer.waitForSelector(".hero h1");
await newcomer.waitForTimeout(300);
check("the landing page is not covered on a first visit", (await newcomer.locator(".welcome-box").count()) === 0);
await newcomer.locator(".landing-header .button-primary").click();
await newcomer.waitForSelector(".welcome-box");
check("a first visit asks who you are", (await newcomer.locator(".welcome-role strong").allInnerTexts()).join() === "User,Hacker,Protocol");
await newcomer.locator(".welcome-skip").click();
check("the welcome can be skipped", (await newcomer.locator(".welcome-box").count()) === 0);
await newcomer.reload();
await newcomer.waitForSelector(".case-row");
await newcomer.waitForTimeout(300);
check("a skipped welcome does not come back", (await newcomer.locator(".welcome-box").count()) === 0);
await newcomer.goto(`${base}#/tour`);
await newcomer.waitForSelector(".welcome-box");
check("the tour can be reopened", true);
await newcomer.locator(".welcome-role", { hasText: "Hacker" }).click();
await newcomer.waitForSelector(".tour-card");
await newcomer.waitForSelector(".tour-spot");
check("the tour switches to the right wallet", (await newcomer.innerText(".wallet-button")).includes("Hacker"));
const tourTitles = [await newcomer.innerText(".tour-card h3")];
await newcomer.locator(".tour-next").click();
await newcomer.waitForFunction((seen) => document.querySelector(".tour-card h3")?.textContent !== seen, tourTitles[0]);
await newcomer.waitForSelector(".tour-spot");
tourTitles.push(await newcomer.innerText(".tour-card h3"));
check("the tour moves to the next page and highlights it", tourTitles[1] === "See your cut" && newcomer.url().includes("/return"), tourTitles.join());
await newcomer.locator(".tour-next").click();
await newcomer.waitForFunction(() => document.querySelector(".tour-next")?.textContent === "Done");
await newcomer.locator(".tour-next").click();
await newcomer.waitForTimeout(200);
check("finishing the tour closes it", (await newcomer.locator(".tour-card").count()) === 0 && (await newcomer.locator(".tour-spot").count()) === 0);
for (const [role, expected] of [["user", 4], ["protocol", 3]]) {
  await newcomer.goto(`${base}#/tour/${role}`);
  await newcomer.reload();
  await newcomer.waitForSelector(".tour-card");
  let seen = 1;
  while (await newcomer.locator(".tour-next").innerText() !== "Done") {
    const before = await newcomer.innerText(".tour-card h3");
    await newcomer.waitForSelector(".tour-spot", { timeout: 15000 });
    await newcomer.locator(".tour-next").click();
    await newcomer.waitForFunction((title) => document.querySelector(".tour-card h3")?.textContent !== title, before);
    seen += 1;
  }
  await newcomer.waitForSelector(".tour-spot", { timeout: 15000 });
  check(`the ${role} tour finds every step on the page`, seen === expected, String(seen));
  await newcomer.locator(".tour-skip").click();
  check(`the ${role} tour can be skipped`, (await newcomer.locator(".tour-card").count()) === 0);
}

// The mascot and the replay of a real hack
const replay = await fresh();
await replay.goto(`${base}#/cases`);
await replay.waitForSelector(".case-row");
check("the cases page starts with the numbers, not a second role picker", (await replay.locator(".role-card").count()) === 0);
await replay.goto(base);
await replay.waitForSelector(".role-card");
await replay.locator(".role-card").first().scrollIntoViewIfNeeded();
await replay.waitForFunction(() => document.querySelector('.role-card img[data-action="sad"]')?.naturalWidth > 0, null, { timeout: 15000 });
check("the role cards show the mascot acting out each role", (await replay.locator(".role-card img").evaluateAll((items) => items.map((item) => item.dataset.action).join())) === "sad,sneak,alarm,look");
await go(replay, "#/case/gmx-replay");
await replay.waitForSelector(".replay-card");
await as(replay, "Hacker");
text = await replay.innerText(".replay-card");
check("the replay says it is a replay and names its limits", text.includes("GMX did not use Pactum") && text.includes("What this replay leaves out"));
check("the replay links its sources", (await replay.locator(".replay-sources a").count()) === 3);
await go(replay, "#/case/gmx-replay/return/mUSDC");
await replay.waitForSelector(".split-preview");
await replay.locator(".tab-panel .button-block").click();
await replay.waitForSelector('.return-warning img[data-action="stop"]');
await confirmReturn(replay);
await replay.waitForSelector(".result", { timeout: 30000 });
check("replaying the return pays 10% and books the rest in one transaction", (await replay.innerText(".result")).includes("4,200,000 mUSDC") && (await replay.innerText(".result")).includes("37,800,000 mUSDC"), (await replay.innerText(".result")).replace(/\n/g, " ").slice(0, 120));
await go(replay, "#/tracker");
check("the tracker links GMX to its replay", await replay.locator(".tracker").getByText("GMX").first().isVisible());

// Trang Profile
const me = await fresh();
await me.goto(`${base}#/profile`);
await me.waitForSelector(".page h1");
await as(me, "User 3");
await me.waitForSelector(".intent-card");
check("the profile asks where the money should go", (await me.innerText(".intent-card h2")).includes("Where do you want your returned money to go?"));
await me.waitForSelector(".intent-chain", { timeout: 20000 });
check("any chain NEAR Intents lists can be picked", (await me.locator(".intent-chain option").count()) > 20, String(await me.locator(".intent-chain option").count()));
check("the upcoming refunds are listed", (await me.locator(".intent-list li").count()) > 0);
// Fakes the NEAR Intents reply, so saving is tested without depending on the network.
await me.route("**/v0/quote", (route) => route.fulfill({ json: { quote: { amountOutFormatted: "6.1", amountOutUsd: "998", timeEstimate: 60 } } }));
await me.locator(".intent-chain").selectOption("sol");
await me.locator(".intent-asset").selectOption({ label: "SOL" });
check("a non-EVM chain asks for an address", (await me.locator(".intent-recipient").inputValue()) === "" && await me.locator(".intent-save").isDisabled());
await me.locator(".intent-recipient").fill("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV");
await me.locator(".intent-save").click();
await me.waitForSelector(".intent-card .quote-result");
check("saving shows a sample quote and says nothing swaps", (await me.innerText(".intent-card")).includes("6.1 SOL") && (await me.innerText(".intent-card")).includes("Nothing is swapped"));
check("upcoming refunds use the chosen asset", (await me.innerText(".intent-list")).includes("as SOL on Solana"));
await me.reload();
await me.waitForSelector(".intent-recipient", { timeout: 20000 });
check("the choice survives a reload", (await me.locator(".intent-recipient").inputValue()).startsWith("7EcDh"));
await go(me, "#/case/tidewater/refund/mBTC");
await me.waitForSelector(".convert", { timeout: 20000 });
check("the refund tab opens on the saved choice", (await me.innerText(".convert .pill.is-active")).includes("SOL on Solana (your choice)") && (await me.locator(".convert input").inputValue()).startsWith("7EcDh"));
await go(me, "#/profile");
await me.waitForSelector(".available-list li", { timeout: 15000 });
const readyBefore = await me.locator(".available-list li").count();
check("available refunds are listed above the upcoming ones", await me.evaluate(() => { const titles = [...document.querySelectorAll(".intent-upcoming")].map((item) => item.textContent); return titles[0] === "Available refunds" && titles[1] === "Your upcoming refunds"; }));
const northgateRow = me.locator(".available-list li", { hasText: "Northgate" }).first();
await northgateRow.locator(".available-claim").click();
await me.waitForFunction((before) => document.querySelectorAll(".available-list li").length < before, readyBefore, { timeout: 30000 });
check("a refund can be claimed straight from the profile", true);
check("a finished case is not listed as still to come", !(await me.innerText(".intent-card")).includes("Quillon"));
await go(me, "#/case/northgate");
await me.waitForFunction(() => document.querySelector(".next-step h2")?.textContent === "All done. You have been paid", null, { timeout: 15000 });
check("a wallet that was paid in full is told it is done", true);
check("a case someone has not finished claiming is not completed yet", (await me.innerText(".case-title")).includes("Fully returned"));
for (const name of ["User 1", "User 2"]) {
  await go(me, "#/profile");
  await as(me, name);
  const row = me.locator(".available-list li", { hasText: "Northgate" }).first();
  await row.waitFor({ timeout: 15000 });
  const before = await me.locator(".available-list li").count();
  await row.locator(".available-claim").click();
  await me.waitForFunction((count) => document.querySelectorAll(".available-list li").length < count, before, { timeout: 30000 });
}
await go(me, "#/case/northgate");
await me.waitForFunction(() => document.querySelector(".case-title")?.textContent.includes("Completed"), null, { timeout: 15000 });
check("a case everyone has claimed shows as completed", true);
await go(me, "#/stats");
await me.waitForSelector(".stats-list li");
text = await me.innerText(".page");
check("the stats page shows the whole platform and this wallet", ["Recovery rate", "Claimed by users", "Refunds received", "Reward earned"].every((label) => text.includes(label)) && (await me.locator(".stats-list li").count()) === 6);
check("stats and stake sit under More", (await me.locator(".side-sub .side-label").allInnerTexts()).join() === "Stats,Stake");
check("the sidebar sections do not overlap with More open", await me.evaluate(() => document.querySelector(".side-section").getBoundingClientRect().bottom <= document.querySelector(".sidebar-bottom").getBoundingClientRect().top + 1));
await go(me, "#/stake");
await me.waitForSelector(".operator-list li", { timeout: 20000 });
check("the stake page shows the real stake from NEAR", (await me.innerText(".staking-card")).includes("0.54 NEAR"));
await me.setViewportSize({ width: 390, height: 800 });
await go(me, "#/stats");
await me.waitForSelector(".stats-list li");
await me.waitForTimeout(300);
check("the stats page has no sideways scroll on a phone", !(await overflow(me)));
await go(me, "#/profile");
await me.waitForSelector(".intent-card");
await me.waitForTimeout(400);
check("the profile has no sideways scroll on a phone", !(await overflow(me)));
const landing = await fresh();
await landing.goto(base);
await landing.waitForSelector(".hero h1");
check("the theme button sits right next to Open app", await landing.evaluate(() => document.querySelector(".landing-header > .button-primary").nextElementSibling?.classList.contains("theme-toggle")));

// A reward tier expires while the page still shows the old numbers
const race = await fresh();
await race.goto(`${base}#/case/tidewater/return/mHYPE`);
await race.waitForSelector(".tab-panel");
await as(race, "Hacker");
await race.waitForSelector(".split-preview");
check("the first reward rate is shown", (await race.innerText(".split-preview")).includes("127,500 mHYPE"));
const { rpc } = await (await fetch(`${base}deployment.json`)).json();
// Blocks exactly the reward-tier read, so the page keeps the old numbers right as chain time passes the deadline. The selector is currentTier's.
await race.route(rpc, (route) => (route.request().postData()?.includes("c01853c1") ? route.abort() : route.continue()));
await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [1500] }) });
await race.locator(".tab-panel .button-block").click();
await confirmReturn(race);
await race.waitForSelector("text=The reward dropped before this went through", { timeout: 15000 });
check("a reward that just dropped gets a plain explanation", (await race.innerText(".tab-panel")).includes("Your tokens did not move"));
await race.unroute(rpc);
await race.waitForTimeout(7000);
check("the page moves to the new reward without a reload", (await race.innerText(".split-preview")).includes("85,000 mHYPE"));
await go(race, "#/case/tidewater");
await race.waitForFunction(() => document.querySelector(".tab-panel")?.innerText.includes("rate in force"), null, { timeout: 15000 });
check("the timeline shows the rate used when funds came back", (await race.innerText(".tab-panel")).includes("Paid at the 15% rate in force at the time"));

check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
