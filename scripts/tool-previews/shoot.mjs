// Screenshot landing tool cards (or the whole landing page) from the dev server.
//
//   node shoot.mjs <slug...|all> [--mobile | --both | --vp=desktop,laptop,...] [--hover]
//   node shoot.mjs page [--vp=...]
//
// Cards: one PNG per theme (light + dark via prefers-color-scheme), at a 1440px
// desktop viewport by default, a 390px phone viewport with --mobile, or both
// with --both. --vp picks any of desktop (1440), laptop (1024), tablet (700) and
// phone (390). --hover also shoots the hover state, by moving the mouse onto the
// card (the real :hover, so the disabled card stays still). `page` shoots the
// full landing page in light/dark x desktop/phone (or --vp). Output: ./out/
// (git-ignored). BASE defaults to http://localhost:5174 (see the README).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, BASE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  laptop: { width: 1024, height: 800 },
  tablet: { width: 700, height: 1000 },
  phone: { width: 390, height: 844 },
};
const THEMES = ["light", "dark"];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const targets = args.filter((a) => !a.startsWith("--"));
const USAGE = "usage: node shoot.mjs <slug...|all|page> [--mobile|--both|--vp=desktop,laptop,tablet,phone] [--hover]";
const vpFlag = [...flags].find((f) => f.startsWith("--vp="));
const badFlag = [...flags].find((f) => f !== vpFlag && !["--mobile", "--both", "--hover"].includes(f));
const badVp = vpFlag && vpFlag.slice(5).split(",").find((v) => !VIEWPORTS[v]);
if (!targets.length || badFlag || badVp !== undefined) {
  if (badFlag) console.error(`unknown flag ${badFlag}`);
  if (badVp !== undefined) console.error(`unknown viewport "${badVp}"`);
  console.error(USAGE);
  process.exit(1);
}
const viewports = vpFlag
  ? vpFlag.slice(5).split(",")
  : flags.has("--both") ? ["desktop", "phone"] : flags.has("--mobile") ? ["phone"] : ["desktop"];

// Headless captures never scroll, so lazy prints below the fold would stay blank.
async function loadAllPrints(page) {
  await page.evaluate(() => document.querySelectorAll(".tool-card img[loading=lazy]").forEach((i) => (i.loading = "eager")));
  await page.waitForFunction(() => [...document.querySelectorAll(".tool-card img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => console.log("  (some prints did not load)"));
}

async function openLanding(newPage, theme, vp) {
  const page = await newPage({ colorScheme: theme, ...VIEWPORTS[vp], dpr: 2 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tool-card", { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await loadAllPrints(page);
  return page;
}

await run(async ({ newPage, sleep, shoot }) => {
  if (targets[0] === "page") {
    for (const vp of vpFlag ? viewports : ["desktop", "phone"]) {
      for (const theme of THEMES) {
        const page = await openLanding(newPage, theme, vp);
        await sleep(600);
        const out = path.join(OUT, `page-${theme}-${vp}.png`);
        await shoot(page, "full", out);
        console.log("wrote", path.relative(HERE, out));
        await page.context().close();
      }
    }
    return;
  }

  for (const vp of viewports) {
    for (const theme of THEMES) {
      const page = await openLanding(newPage, theme, vp);
      const slugs = targets[0] === "all" ? await page.$$eval(".tool-card", (els) => els.map((e) => e.dataset.tool)) : targets;
      for (const slug of slugs) {
        const card = page.locator(`.tool-card[data-tool="${slug}"]`);
        if (!(await card.count())) {
          console.log(`  no card for ${slug}`);
          process.exitCode = 1;
          continue;
        }
        await card.scrollIntoViewIfNeeded();
        const states = flags.has("--hover") ? ["rest", "hover"] : ["rest"];
        for (const state of states) {
          if (state === "hover") await card.hover();
          else await page.mouse.move(0, 0);
          await sleep(state === "hover" ? 900 : 300);
          const box = await card.boundingBox();
          const { scrollY, docW } = await page.evaluate(() => ({ scrollY: window.scrollY, docW: document.documentElement.clientWidth }));
          const pad = 24; // keep the card's own shadow and focus ring in frame
          const x0 = Math.max(0, box.x - pad);
          const x1 = Math.min(docW, box.x + box.width + pad);
          const out = path.join(OUT, `${slug}-${theme}-${vp}${state === "hover" ? "-hover" : ""}.png`);
          await page.screenshot({
            path: out,
            fullPage: true,
            animations: "disabled",
            clip: { x: x0, y: Math.max(0, box.y + scrollY - pad), width: x1 - x0, height: box.height + pad * 2 },
          });
          console.log("wrote", path.relative(HERE, out));
        }
      }
      await page.context().close();
    }
  }
});
