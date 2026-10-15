// Hotspot Reward Claimer (/hotspot-claimer) — source captures for the landing-page preview art.
//
//   node capture/hotspot-claimer.mjs                    (from scripts/tool-previews; frontend on BASE)
//   node capture/hotspot-claimer.mjs sources            (only the source pass)
//   node capture/hotspot-claimer.mjs macros             (only the card's macros, both modes)
//   node capture/hotspot-claimer.mjs hotspot|wallet     (only that mode's macros)
//
// Writes captures/hotspot-claimer/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses pending-macro.png,
// list-macro.png and table-macro.png (previews/hotspot-claimer.js).
//
// Read-only: looks up the `main` showcase wallet (10 Hotspots, Lutz FL) in Wallet mode,
// then opens its richest Hotspot (largest pending HNT) in Hotspot mode by clicking its
// entity-key link (a URL-param navigation). It NEVER clicks "Claim", "Claim All" or
// "Claim Rewards". The page's bulk POST /hotspot-claimer/wallet/rewards is blocked by
// lib.mjs's side-effect guard (its path contains "claim"); the page then falls back on
// its own to per-Hotspot GET /rewards, which populates the same table.
// Light and dark come from the same load via emulateMedia.
//
// Macros: the same wallet and its richest Hotspot, Polite Burlap Crocodile, at a high
// dpr so the card can show their amounts above 1x and stay crisp:
//   pending-macro.png  (dpr 4) Hotspot mode at a 320px phone viewport: the
//                      Pending Rewards card (IOT 0 / MOBILE 0 / HNT 14.61 with
//                      its Claimable pill / Claim Rewards)
//   list-macro.png     (dpr 3) Wallet mode at the same 320px viewport: the
//                      stacked rewards list (per-Hotspot "HNT x.xx", the
//                      "Total HNT 23.67" band, Claim All)
//   table-macro.png    (dpr 3) Wallet mode at 1440px: the desktop rewards table
//                      (IOT / MOBILE / HNT columns, Claim links, Total row)
// Nothing is clicked in the macro pass (both modes open by URL), so no Claim, Claim
// All or Claim Rewards control is ever pressed.
//
// Rewards are live, so the amounts change from one capture to the next. The
// card's rects (previews/hotspot-claimer.js) are set for the reference capture's
// 14.61 / 23.67 and the first five table rows; re-check them after a re-shoot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS, writeManifest, mergeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/hotspot-claimer/', import.meta.url));
const PHASE = process.argv[2]; // 'sources' | 'macros' | 'hotspot' | 'wallet' | undefined (everything)
if (PHASE && !['sources', 'macros', 'hotspot', 'wallet'].includes(PHASE)) throw new Error(`unknown phase ${PHASE}: use sources, macros, hotspot or wallet`);
const ROUTE = '/hotspot-claimer';
const WALLET = WALLETS.main;
const THEMES = ['light', 'dark'];
const P = (theme, f) => path.join(OUT, theme, f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "hotspot-claimer",
  route: "/hotspot-claimer?mode=wallet&wallet=BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd",
  wallet: "BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd (WALLETS.main, looked up read-only in Wallet mode; no wallet connect)",
  notes: "Live production data (2026-10-14). Wallet mode for WALLETS.main shows 10 Hotspots (8 MOBILE, 2 IOT), pending HNT per Hotspot, Total 23.67 HNT. IOT and MOBILE columns are all 0 (post-HIP-138 rewards are paid in HNT) - this is real data, not a load failure. The page's bulk POST /hotspot-claimer/wallet/rewards is aborted by the harness guard (path contains \"claim\"); the page falls back on its own to per-Hotspot GET /rewards, which fills the identical table. Hotspot-mode shots open the richest Hotspot (Polite Burlap Crocodile, 14.61 HNT) by clicking its entity-key link (?mode=hotspot&key=...), at an 800px viewport so the cards are compact. Tight crops hide sibling page blocks with visibility:hidden (no layout change). No Claim / Claim All / Claim Rewards control was ever clicked. WALLETS.large (1,659 Hotspots) was not used: with the bulk endpoint guarded it would need ~1,659 per-Hotspot GETs against a 30/min per-IP limit shared with other agents.",
  shots: {
    "hero.png": { dpr: 2, kind: "wallet-table", role: "hero", describes: "Wallet-mode rewards table card: \"10 Hotspots\" with MOBILE/IOT network badges, Lutz FL locations, truncated entity keys, IOT/MOBILE/HNT pending-reward columns (HNT 0.42 … 14.61), per-row Claim links, a Total row (23.67 HNT) and the full-width Claim All button. Near-square (~8:7) because the card is naturally that shape; isolated on the page background with breathing room." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Populated tool at 1440x960: header, \"Reward Claimer\" title, Hotspot/Wallet tab toggle (Wallet active), wallet address input, and the top ~7 rows of the rewards table." },
    "full.png": { dpr: 2, kind: "full-page", role: "backdrop", describes: "Full page in Wallet mode: title, tabs, wallet input and the complete 10-Hotspot rewards table through Total and Claim All." },
    "rows-hover.png": { dpr: 2, kind: "table-rows", role: "supporting", describes: "Edge-to-edge strip of four table rows plus the Total row; the richest Hotspot (Polite Burlap Crocodile, 14.61 HNT) has its entity-key link hovered, showing the \"View Hotspot details\" tooltip." },
    "hotspot-lookup.png": { dpr: 2, kind: "hotspot-view", role: "supporting", describes: "Hotspot mode for Polite Burlap Crocodile: tab toggle (Hotspot active), entity-key input, the Hotspot card (MOBILE badge, Asset id, Owner, Rewards Recipient (owner), Location) and the Pending Rewards card (IOT 0, MOBILE 0, HNT 14.61 Claimable, Claim Rewards button). 800px-wide viewport." },
    "hotspot-card.png": { dpr: 2, kind: "hotspot-card", role: "supporting", describes: "Single Hotspot identity card: name, MOBILE badge, Asset id, Owner and Rewards Recipient wallet links with copy icons, Location." },
    "pending-rewards.png": { dpr: 2, kind: "pending-rewards", role: "supporting", describes: "Pending Rewards card: IOT / MOBILE / HNT rows, HNT 14.61 with green Claimable pill, full-width Claim Rewards button." },
    "wallet-list-mobile.png": { dpr: 2, kind: "wallet-list-mobile", role: "supporting", describes: "Phone-width (390px) variant of the wallet rewards list: stacked Hotspot rows with badges, entity keys, \"HNT 14.61\"-style amounts and Claim links, Total HNT 23.67 and Claim All. Tall portrait (~1:3.4)." },
    "detail.png": { dpr: 3, kind: "pending-rewards-macro", role: "detail", describes: "Macro of the Pending Rewards card at dpr 3 (560px viewport): HNT 14.61 + Claimable pill + Claim Rewards button." },
  },
};

async function box(loc) {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}
// Union of boxes, padded (CSS px), rounded.
function frame(boxes, padX, padTop, padBottom = padTop) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: Math.max(0, Math.round(x0 - padX)), y: Math.max(0, Math.round(y0 - padTop)), width: Math.round(x1 - x0 + 2 * padX), height: Math.round(y1 - y0 + padTop + padBottom) };
}

async function walletReady(page) {
  return page.evaluate(() => {
    const t = document.querySelector('main')?.innerText || '';
    return /\d+ Hotspots/.test(t) && !!document.querySelector('main tfoot') && !/Loading rewards/.test(t) &&
      !/failed to load rewards/i.test(t) && !/\bFailed\b/.test(t) && /Claim All/.test(t);
  });
}

async function loadWallet(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await page.goto(`${BASE}${ROUTE}?mode=wallet&wallet=${WALLET}`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if (await walletReady(page)) return;
    }
    console.log('wallet not ready (attempt', attempt, ', status', resp && resp.status(), ') — waiting 45s');
    await sleep(45000);
  }
  throw new Error('wallet table never populated');
}

async function hotspotReady(page) {
  return page.evaluate(() => {
    const t = document.querySelector('main')?.innerText || '';
    return /Pending Rewards/.test(t) && /Rewards Recipient/.test(t) && !/Loading\.\.\./.test(t) &&
      !/Querying oracles/.test(t) && /Claimable|Recent Claim/.test(t) && /Location/.test(t);
  });
}

async function waitHotspot(page) {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    if (await hotspotReady(page)) return;
  }
  throw new Error('hotspot view never populated');
}

// For tight crops only: hide (visibility, so no layout shift) every other direct child
// of <main> — the intro, tabs, input and sibling cards — so a crop's padding never
// catches a sliver of a neighbour. Pass null to restore.
async function solo(page, loc) {
  if (!loc) {
    await page.evaluate(() => { for (const el of document.querySelectorAll('main > *')) el.style.visibility = ''; });
    return;
  }
  await loc.evaluate((target) => {
    for (const el of document.querySelectorAll('main > *')) el.style.visibility = el.contains(target) ? '' : 'hidden';
  });
}

async function setTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await sleep(600);
}

async function parkMouse(page) {
  const vp = page.viewportSize();
  await page.mouse.move(vp.width - 4, vp.height - 4);
  await sleep(300);
}

async function sources({ newPage, shoot, shootRect }) {
  for (const t of THEMES) fs.mkdirSync(path.join(OUT, t), { recursive: true });

  // ───────────── Wallet mode (1440x960, dpr 2) ─────────────
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  await loadWallet(page);
  await sleep(1500);

  const card = page.locator('main div.rounded-xl.bg-surface-raised.shadow-soft.overflow-hidden').first();
  const rows = card.locator('tbody tr');
  const n = await rows.count();
  // Pick the row with the largest pending HNT (column 5).
  let best = 0, bestHnt = -1;
  for (let i = 0; i < n; i++) {
    const v = parseFloat(((await rows.nth(i).locator('td').nth(4).innerText()) || '0').replace(/[^\d.]/g, '')) || 0;
    if (v > bestHnt) { bestHnt = v; best = i; }
  }
  const bestRow = rows.nth(best);
  const bestName = (await bestRow.locator('td').first().innerText()).split('\n')[0].trim();
  console.log('rows', n, 'best', best, bestName, bestHnt);
  const keyBtn = bestRow.locator('td').nth(1).locator('button').first(); // entity-key link (NOT the Claim button)

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await parkMouse(page);
    await shoot(page, 'viewport', P(theme, 'viewport.png'));
    await shoot(page, 'full', P(theme, 'full.png'));

    // hero: the whole rewards table card (10 Hotspots, pending IOT/MOBILE/HNT, total, Claim All).
    const bCard = await box(card);
    await solo(page, card);
    await shootRect(page, frame([bCard], 48, 40, 48), P(theme, 'hero.png'));
    await solo(page, null);

    // rows-hover: a band of rows around the richest Hotspot, its entity-key tooltip showing.
    await keyBtn.scrollIntoViewIfNeeded();
    await keyBtn.hover();
    await sleep(700);
    const lo = Math.max(0, best - 2);
    const tip = page.locator('[role="tooltip"]').first();
    if (!(await tip.isVisible().catch(() => false))) console.log('tooltip not visible');
    // Inner crop, flush with the card's sides: rows from (best-2) down through the Total row.
    const bTop = await box(rows.nth(lo));
    const bFoot = await box(card.locator('tfoot').first());
    await shootRect(page, { x: Math.round(bCard.x), y: Math.round(bTop.y), width: Math.round(bCard.width), height: Math.round(bFoot.y + bFoot.height - bTop.y) }, P(theme, 'rows-hover.png'));
    await parkMouse(page);
  }

  // Phone-width card list (md:hidden variant of the same table), portrait.
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1200);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await parkMouse(page);
    const b = await box(card);
    await solo(page, card);
    await shootRect(page, frame([b], 16, 20, 24), P(theme, 'wallet-list-mobile.png'));
    await solo(page, null);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await sleep(800);
  await setTheme(page, 'light');

  // ───────────── Hotspot mode: open the richest Hotspot ─────────────
  await keyBtn.scrollIntoViewIfNeeded();
  await keyBtn.click(); // navigates to ?mode=hotspot&key=<entityKey> (lookup + GET /rewards)
  await waitHotspot(page);
  const key = new URL(page.url()).searchParams.get('key');
  console.log('hotspot key', key);
  await page.setViewportSize({ width: 800, height: 960 });
  await sleep(1500);

  const hsCard = page.locator('main div.rounded-xl.bg-surface-raised.shadow-soft').filter({ hasText: 'Rewards Recipient' }).first();
  const rwCard = page.locator('main div.rounded-xl.bg-surface-raised.shadow-soft').filter({ hasText: 'Pending Rewards' }).first();
  const inputWrap = page.locator('#entityKey').locator('xpath=ancestor::div[contains(@class,"mb-6")][1]');
  const tabs = page.locator('main div.flex.rounded-lg.bg-surface-inset').first();

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await parkMouse(page);
    const [bTabs, bInput, bHs, bRw] = await Promise.all([tabs, inputWrap, hsCard, rwCard].map(box));
    await shootRect(page, frame([bTabs, bInput, bHs, bRw], 32, 32, 40), P(theme, 'hotspot-lookup.png'));
    await solo(page, hsCard);
    await shootRect(page, frame([bHs], 32, 28, 36), P(theme, 'hotspot-card.png'));
    await solo(page, rwCard);
    await shootRect(page, frame([bRw], 32, 28, 36), P(theme, 'pending-rewards.png'));
    await solo(page, null);
  }

  // ───────────── detail: Pending Rewards card at dpr 3 ─────────────
  const dpage = await newPage({ colorScheme: 'light', width: 560, height: 900, dpr: 3 });
  await dpage.goto(`${BASE}${ROUTE}?mode=hotspot&key=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
  await waitHotspot(dpage);
  await sleep(1200);
  const dRw = dpage.locator('main div.rounded-xl.bg-surface-raised.shadow-soft').filter({ hasText: 'Pending Rewards' }).first();
  for (const theme of THEMES) {
    await setTheme(dpage, theme);
    await parkMouse(dpage);
    const b = await box(dRw);
    await solo(dpage, dRw);
    await shootRect(dpage, frame([b], 18, 16, 22), P(theme, 'detail.png'));
    await solo(dpage, null);
  }

  writeManifest(OUT, MANIFEST);
}

// ───────────── Macros the landing card uses ─────────────
const HOTSPOT_NAME = 'Polite Burlap Crocodile';
const NARROW = 320;
const mpad = (b, px, top, bottom) => ({
  x: Math.max(0, Math.floor(b.x - px)),
  y: Math.max(0, Math.floor(b.y - top)),
  width: Math.ceil(b.width + 2 * px),
  height: Math.ceil(b.height + top + bottom),
});
async function waitText(page, test, label, tries = 40, ms = 1500) {
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(ms);
    if (test(await page.evaluate(() => document.querySelector('main')?.innerText || ''))) return;
  }
  throw new Error(`${label} never populated`);
}
const hotspotTextReady = (t) =>
  /Pending Rewards/.test(t) && /Rewards Recipient/.test(t) && !/Loading\.\.\./.test(t) &&
  !/Querying oracles/.test(t) && /Claimable/.test(t) && /Location/.test(t);
const walletTextReady = (t) =>
  /\d+ Hotspots/.test(t) && /\bTotal\b/.test(t) && !/Loading rewards/.test(t) &&
  !/failed to load rewards/i.test(t) && !/\bFailed\b/.test(t) && /Claim All/.test(t);

async function macros({ newPage, sleep, shootRect }, only) {
  const shots = [];
  const park = async (page) => {
    const vp = page.viewportSize();
    await page.mouse.move(vp.width - 2, vp.height - 2);
    await sleep(300);
  };
  async function shootBoth(page, loc, file, dpr, padding, describes, before) {
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(700);
      if (before) await before();
      await page.evaluate(() => window.scrollTo(0, 0));
      await park(page);
      const r = mpad(await box(loc), ...padding);
      await solo(page, loc);
      await shootRect(page, r, P(theme, file));
      await solo(page, null);
      shots.push({ file: `${theme}/${file}`, theme, kind: 'crop', describes, cssWidth: r.width, cssHeight: r.height, dpr, role: 'detail' });
      console.log('wrote', `${theme}/${file}`, `${r.width}x${r.height} css @${dpr}x`);
    }
  }
  const card = (page, text) =>
    page.locator('main div.rounded-xl.bg-surface-raised.shadow-soft').filter({ hasText: text }).first();

  if (only !== 'wallet') {
    const res = await fetch(`${BASE}/api${ROUTE}/wallet?address=${WALLET}`);
    const key = (await res.json()).hotspots.find((h) => h.name === HOTSPOT_NAME)?.entityKey;
    if (!key) throw new Error(`${HOTSPOT_NAME} not in wallet`);
    const dpr = 4;
    const page = await newPage({ colorScheme: 'light', width: NARROW, height: 900, dpr });
    await page.goto(`${BASE}${ROUTE}?mode=hotspot&key=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
    await waitText(page, hotspotTextReady, 'hotspot view');
    const rewards = card(page, 'Pending Rewards');
    console.log('pending:', (await rewards.innerText()).replace(/\s+/g, ' '));
    // The page re-queries the oracles after its first paint: shoot only a settled card.
    await shootBoth(page, rewards, 'pending-macro.png', dpr, [14, 12, 16],
      `Macro (dpr ${dpr}, ${NARROW}px viewport) of ${HOTSPOT_NAME}'s Pending Rewards card: IOT 0, MOBILE 0, HNT 14.61 with the green Claimable pill, full-width Claim Rewards button.`,
      () => waitText(page, hotspotTextReady, 'hotspot view'));
    await page.context().close();
  }

  if (only !== 'hotspot') {
    // One wallet load for both widths: resizing only swaps the md:hidden list for the table.
    const dpr = 3;
    const page = await newPage({ colorScheme: 'light', width: NARROW, height: 900, dpr });
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      await page.goto(`${BASE}${ROUTE}?mode=wallet&wallet=${WALLET}`, { waitUntil: 'domcontentloaded' });
      try {
        await waitText(page, walletTextReady, 'wallet list', 30, 2000);
        ok = true;
      } catch {
        console.log('wallet not ready, attempt', attempt, '- waiting 45s');
        await sleep(45000);
      }
    }
    if (!ok) throw new Error('wallet never populated');
    await sleep(1200);
    const table = page.locator('main div.rounded-xl.bg-surface-raised.shadow-soft.overflow-hidden').first();
    console.log('wallet:', (await table.innerText()).replace(/\s+/g, ' ').slice(0, 400));
    await shootBoth(page, table, 'list-macro.png', dpr, [14, 16, 20],
      `Macro (dpr ${dpr}, ${NARROW}px viewport) of the wallet rewards list: 10 stacked Hotspot rows (name, badge, location, entity key, "HNT x.xx", Claim), the Total HNT 23.67 band, Claim All.`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(1000);
    await shootBoth(page, table, 'table-macro.png', dpr, [24, 16, 20],
      `Macro (dpr ${dpr}, 1440px viewport) of the desktop wallet rewards table: 10 Hotspots, IOT / MOBILE / HNT pending columns (HNT 0.42 ... 14.61), Claim links, Total row 23.67, Claim All. Same layout as hero.png.`);
  }

  mergeManifest(OUT, shots, { seed: { slug: MANIFEST.slug, route: MANIFEST.route, wallet: MANIFEST.wallet } });
}

await run(async (h) => {
  if (!PHASE || PHASE === 'sources') await sources(h);
  if (PHASE !== 'sources') await macros(h, PHASE === 'hotspot' || PHASE === 'wallet' ? PHASE : undefined);
}, { timeoutMs: 420000 + 420000 });
