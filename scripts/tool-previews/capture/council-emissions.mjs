// Council Emissions (/council-emissions) — source captures for the landing-page preview art.
//
//   node capture/council-emissions.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/council-emissions/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses timeline.png, fate-bars.png and
// stat-emitted.png (previews/council-emissions.js).
//
// Read-only: the page takes no wallet and nothing is clicked. It shows the five
// HIP-149 Advisory Council seat wallets because they are the mini-fanout's
// recipients on chain; the site owner approved showing them on the card
// (2026-10-28). The figures are live (a new emission lands every day at 00:00
// UTC), so the numbers change from one capture to the next; the crops frame
// the layout, not the digits.
//
// From one page state at 1024x900, light then dark (emulateMedia):
//   timeline.png      the emissions timeline: colour legend and the five seat
//                     lanes (emission bars above each line, transfers below)
//   fate-bars.png     "Where it went, by seat": legend, the all-seats bar and the
//                     five per-seat bars (held / swapped / sent to an exchange)
// Macro, dpr 3:
//   stat-emitted.png  the "Emitted to seats" stat tile (the card's anchor number)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, writeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/council-emissions/', import.meta.url));
const ROUTE = '/council-emissions';
const THEMES = ['light', 'dark'];
const WIDTH = 1024;
const PAD = 14; // page background kept around each element, CSS px

const P = (theme, f) => path.join(OUT, theme, f);

async function rectOf(loc, pad = PAD) {
  return loc.evaluate((el, p) => {
    const b = el.getBoundingClientRect();
    return {
      x: Math.floor(b.left + window.scrollX - p),
      y: Math.floor(b.top + window.scrollY - p),
      width: Math.ceil(b.width + 2 * p),
      height: Math.ceil(b.height + 2 * p),
    };
  }, pad);
}

async function load(page) {
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await page.locator('main section svg g[role="group"]').nth(4).waitFor({ timeout: 60000 });
  await page.locator('main dl > div').first().waitFor({ timeout: 30000 });
  await page.mouse.move(2, 2); // no hovered mark, no tooltip
  const txt = await page.locator('main').innerText();
  if (/Couldn't load|warming|Still reading|NaN|undefined/i.test(txt)) throw new Error('page not ready: ' + txt.slice(0, 400));
}

await run(async ({ newPage, shootRect, settle, sleep }) => {
  for (const t of THEMES) fs.mkdirSync(path.join(OUT, t), { recursive: true });
  const shots = {};

  // ---- Main pass: 1024 wide, dpr 2 ----
  const page = await newPage({ colorScheme: 'light', width: WIDTH, height: 900, dpr: 2 });
  await load(page);
  await settle(page, 1500);
  const timelineSection = page.locator('main section', { has: page.getByRole('heading', { name: 'Every emission, and where it went' }) });
  const barsSection = page.locator('main section', { has: page.getByRole('heading', { name: 'Where it went, by seat' }) });
  const timeline = timelineSection.locator('div.relative').first();
  // The bars and their legend, without the table under them.
  const barsLegend = barsSection.locator('ul').first();
  const barsStack = barsSection.locator('div.space-y-3').first();
  const legendBox = await rectOf(barsLegend);
  const stackBox = await rectOf(barsStack);
  const barsRect = {
    x: Math.min(legendBox.x, stackBox.x),
    y: legendBox.y,
    width: Math.max(legendBox.x + legendBox.width, stackBox.x + stackBox.width) - Math.min(legendBox.x, stackBox.x),
    height: stackBox.y + stackBox.height - legendBox.y,
  };
  const rects = {
    'timeline.png': await rectOf(timeline),
    'fate-bars.png': barsRect,
  };
  const texts = {
    'timeline.png': `Emissions timeline at ${WIDTH}px: legend and five seat lanes. ${(await timeline.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`,
    'fate-bars.png': `Where it went, by seat: legend, the all-seats bar and five per-seat 100% bars. ${(await barsStack.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`,
  };
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(700);
    for (const [file, r] of Object.entries(rects)) await shootRect(page, r, P(theme, file));
  }
  for (const [file] of Object.entries(rects)) shots[file] = { dpr: 2, kind: 'crop', role: 'print', describes: texts[file] };

  // ---- Macro: the anchor number, dpr 3 ----
  const macro = await newPage({ colorScheme: 'light', width: WIDTH, height: 900, dpr: 3 });
  await load(macro);
  await settle(macro, 1500);
  const tile = macro.locator('main dl > div').first();
  const tileRect = await rectOf(tile, 10);
  const tileText = (await tile.innerText()).replace(/\s+/g, ' ').trim();
  if (!/Emitted to seats/.test(tileText)) throw new Error('unexpected first stat tile: ' + tileText);
  for (const theme of THEMES) {
    await macro.emulateMedia({ colorScheme: theme });
    await sleep(700);
    await shootRect(macro, tileRect, P(theme, 'stat-emitted.png'));
  }
  shots['stat-emitted.png'] = { dpr: 3, kind: 'crop', role: 'anchor', describes: `Macro (dpr 3): the "${tileText}" stat tile` };

  writeManifest(OUT, {
    slug: 'council-emissions',
    route: ROUTE,
    wallet: 'None (the page shows the five council seat wallets from chain; owner-approved 2026-10-28)',
    shots,
  });
});
