// veHNT Positions (/ve-hnt) — source captures for the landing-page preview art.
//
//   node capture/ve-hnt.mjs            (from scripts/tool-previews; frontend on BASE)
//   node capture/ve-hnt.mjs macros     (the same run: the macro pass is the only pass)
//
// Writes captures/ve-hnt/{light,dark}/*.png and merges its entries into
// manifest.json (OUT_DIR overrides the directory). The landing card uses
// summary-narrow.png and position-delegated-narrow.png (previews/ve-hnt.js);
// position-undelegated-narrow.png is shot but unused.
//
// Read-only: the page is driven by its ?wallet= URL param (no wallet connect).
// Claim / withdraw / delegate are never touched (they are external helium.vote
// links for a non-connected wallet).
//
// Macros: /ve-hnt?wallet=<WALLETS.empty> (two active Cliff positions, one delegated
// to MOBILE, one undelegated) at a 412px phone viewport, where the summary's two
// figures and each position card sit compactly; from that one page state, light then
// dark, at dpr 3:
//   summary-narrow.png                the summary ledger (HNT locked / total voting power)
//   position-delegated-narrow.png     position 01/02 (Delegated · MOBILE) with its lockup bar
//   position-undelegated-narrow.png   position 02/02 (Undelegated) with its lockup bar
// Nothing is clicked in the macro pass. The figures are live (voting power decays as a
// Cliff lockup nears its end and the "Unlocks in" countdown moves), so the card's
// numbers change from one capture to the next. The crops in previews/ve-hnt.js frame
// the cards' layout, not the digits, so they hold across re-shoots.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS, mergeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/ve-hnt/', import.meta.url));
const PHASE = process.argv[2]; // optional: 'macros', the only pass
if (PHASE && PHASE !== 'macros') throw new Error(`unknown pass ${PHASE}: ve-hnt has only the macros pass`);
const ROUTE = '/ve-hnt';
const THEMES = ['light', 'dark'];

const out = (theme, name) => path.join(OUT, theme, name);

// manifest.json meta, used only when there is no manifest yet (the macro pass
// merges its own shot entries, with css sizes taken from the shot rects).
const META = {
  slug: 've-hnt',
  route: `${ROUTE}?wallet=${WALLETS.empty}`,
  wallet: `${WALLETS.empty} (WALLETS.empty)`,
};

// ── Macros the landing card uses (WALLETS.empty, 412px phone viewport, dpr 3) ───
const MACRO_DPR = 3;
const MACRO_WIDTH = 412;
const MACRO_PAD = 12; // page background kept around each element, CSS px
const mpad = (b, p = MACRO_PAD) => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
const snap = (r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });

async function macros({ newPage, settle, sleep, shootRect }) {
  const page = await newPage({ colorScheme: 'light', width: MACRO_WIDTH, height: 900, dpr: MACRO_DPR });
  await page.goto(`${BASE}${ROUTE}?wallet=${WALLETS.empty}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Total voting power').waitFor({ timeout: 30000 });
  await page.locator('article').nth(1).waitFor({ timeout: 30000 });
  await settle(page, 2000); // the lockup bars ease in over 700ms

  const summary = page.locator('div.rounded-2xl', { has: page.getByText('Total voting power') }).last();
  const cards = page.locator('article');
  const els = {
    'summary-narrow.png': summary,
    'position-delegated-narrow.png': cards.nth(0),
    'position-undelegated-narrow.png': cards.nth(1),
  };
  const rects = {};
  const texts = {};
  for (const [file, loc] of Object.entries(els)) {
    await loc.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    const b = await loc.boundingBox();
    rects[file] = snap(mpad({ ...b, y: b.y + scrollY })); // shootRect clips the full page
    texts[file] = (await loc.innerText()).replace(/\s+/g, ' ').trim();
  }

  const shots = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(800);
    for (const [file, r] of Object.entries(rects)) {
      await shootRect(page, r, out(theme, file));
      shots.push({
        file: `${theme}/${file}`,
        theme,
        kind: 'crop',
        describes: `Macro (dpr ${MACRO_DPR}) at a ${MACRO_WIDTH}px phone viewport, WALLETS.empty: ${texts[file].slice(0, 240)}`,
        cssWidth: r.width,
        cssHeight: r.height,
        role: 'detail',
        dpr: MACRO_DPR,
      });
      console.log('wrote', `${theme}/${file}`, `${r.width}x${r.height} css`);
    }
  }
  mergeManifest(OUT, shots, { seed: META });
  for (const [f, t] of Object.entries(texts)) console.log(f, '->', t.slice(0, 200));
}

await run(macros, { timeoutMs: 240000 });
