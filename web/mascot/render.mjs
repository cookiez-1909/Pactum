// Captures every mascot frame as a PNG with a transparent background. Usage:
//   node render.mjs <output folder> [sheet]
// With "sheet", only a contact sheet is captured, for review.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../e2e/"))("playwright");
const outDir = process.argv[2];
const sheetOnly = process.argv[3] === "sheet";
const FPS = 20;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 240, height: 240 } });
await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style><div id="a"></div>`);
await page.addScriptTag({ content: readFileSync(join(here, "mascot.js"), "utf8") });
const names = await page.evaluate(() => Object.keys(window.PAX.STATES));

if (sheetOnly) {
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 1090 } });
  await sheet.setContent(`<!doctype html><style>body{margin:0;display:grid;grid-template-columns:repeat(6,250px);font:14px sans-serif}div{width:250px;height:270px;text-align:center}div:nth-child(odd){background:#12131a;color:#fff}div:nth-child(even){background:#f5f2ff}</style><main id="m" style="display:contents"></main>`);
  await sheet.addScriptTag({ content: readFileSync(join(here, "mascot.js"), "utf8") });
  await sheet.evaluate((list) => {
    document.getElementById("m").innerHTML = list.map((name, i) => `<div>${name}${window.PAX.render(name, i % 2 ? 0.28 : 0.63).replaceAll('id="iris"', `id="iris${i}"`).replaceAll("url(#iris)", `url(#iris${i})`)}</div>`).join("");
  }, names);
  await sheet.screenshot({ path: join(outDir, "sheet.png") });
} else {
  for (const name of names) {
    const seconds = await page.evaluate((item) => window.PAX.STATES[item].seconds, name);
    const frames = Math.round(seconds * FPS);
    const dir = join(outDir, name);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < frames; i += 1) {
      await page.evaluate(([item, t]) => { document.getElementById("a").innerHTML = window.PAX.render(item, t); }, [name, i / frames]);
      await page.screenshot({ path: join(dir, `${String(i).padStart(3, "0")}.png`), omitBackground: true });
    }
    console.log(name, frames);
  }
}
await browser.close();
