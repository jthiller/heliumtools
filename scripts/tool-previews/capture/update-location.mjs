// Update Hotspot Location (/update-location) — source captures for the landing-page preview art.
//
//   node capture/update-location.mjs            (from scripts/tool-previews; frontend on BASE)
//   node capture/update-location.mjs sources    (only the source pass)
//   node capture/update-location.mjs macros     (only the card's macros)
//
// Writes captures/update-location/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses fields-macro.png and
// map-macro.png (previews/update-location.js).
//
// Three read-only states, every one from live production data through a fake-connected
// (read-only, signing throws) wallet. "Update Hotspot" is never clicked.
//
//   A  "metadata edit"  — WALLETS.mixed, Hotspot "Fancy Shadow Elephant".
//      Its asserted res-12 cell sits wholly on open ground beside Queen Street, so the hex
//      fill is one even tint. Elevation 7 -> 9 m and gain 6 -> 8 dBi are edited (a
//      metadata-only change: "No DC fee", live "Update Hotspot" button; the wallet holds 0 DC
//      so a location change would gate on a top-up warning). Native layout, zoom 17.
//      -> viewport.png, editor-card.png, fields-cost.png
//
//   B  "re-positioning" — WALLETS.mixed, Hotspot "Huge Lava Raccoon" (a dense row-house
//      grid with named streets). Its asserted cell straddles a building edge, so we
//      do what the tool is for: type a new latitude/longitude (the pin and hex move ~66 m onto
//      a single large roof off Lincoln Avenue — the cell 8c2a847360ac3ff was picked because all
//      six vertices sit inside that roof polygon). For the hero the card is widened (main
//      max-width 920px) and the map wrapper raised from 224px to 400px (MapLibre's
//      ResizeObserver resizes the canvas); the help line, the Elevation/Gain row, the cost card
//      and the button are collapsed so the card reads name -> key -> map -> lat/lng.
//      The cost card is never in frame in this state (location is dirty and the wallet has
//      0 DC, so it would show the top-up gate). Zoom 17.5.
//      -> hero.png, map.png (dpr 2), detail.png (dpr 3, second load)
//
//   C  "fleet list"     — WALLETS.iotOnly (26 IoT Full Hotspots, each listed with its town).
//      -> hotspot-list.png (first six rows, the sixth fading into the page background so no
//         row is cut mid-height), full.png (the whole 26-row page)
//
// Light and dark come from the same load via emulateMedia (the MapLibre basemap follows
// prefers-color-scheme live: Carto Positron <-> Dark Matter).
//
// Macros: state B again at a 390px phone viewport and dpr 4, where the Latitude /
// Longitude / Elevation / Gain grid is ~320 CSS px wide, so the card can show the
// coordinates near 1x and crisp. From that one state, light then dark:
//   fields-macro.png  the 2x2 field grid (the card crops its Latitude/Longitude row)
//   map-macro.png     a 216x282 portrait of the location picker, map raised to
//                       420px and zoomed to 17.5 (as hero.png), the pin's cell in
//                       its top third
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { run, BASE, WALLETS, writeManifest, mergeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/update-location/', import.meta.url));
const PHASE = process.argv[2]; // 'sources' | 'macros' | undefined (both)
if (PHASE && !['sources', 'macros'].includes(PHASE)) throw new Error(`unknown phase ${PHASE}: use sources or macros`);
const ROUTE = '/update-location';
const THEMES = ['light', 'dark'];
const P = (theme, f) => path.join(OUT, theme, f);

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "update-location",
  route: "/update-location",
  wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F (WALLETS.mixed: editor shots) + 2mwuyMhooEnqjsBuQKvjNuNv9Ju2xQUwutdTz6sZB8rJ (WALLETS.iotOnly: hotspot-list, full)",
  notes: "All data is live production data through a fake-connected read-only wallet (signing throws); \"Update Hotspot\" was never clicked and no transaction was built. Why not WALLETS.main / WALLETS.iotOnly for the editor: all 26 iotOnly cells were screened at zoom 17 and every one sits in farmland or on a town edge, so none gives a dense town centre. WALLETS.mixed and WALLETS.large were screened too. No dense-area Hotspot has its asserted res-12 cell wholly on one surface; each straddles a building edge or a kerb. So the editor is captured in two honest states. (A) editor-card / fields-cost / viewport show \"Fancy Shadow Elephant\" at its REAL asserted cell, which sits wholly on open ground among labelled streets (few mapped building footprints there). Elevation 7->9 m and gain 6->8 dBi are edited, a metadata-only change, so the cost reads \"No DC fee\" and the button is live. (B) hero / map / detail show \"Huge Lava Raccoon\" in a dense area mid-edit: a new latitude/longitude was typed into the tool's own inputs, moving the pin ~66 m onto a single large roof off Lincoln Avenue (cell 8c2a847360ac3ff, all six vertices inside the roof polygon), so the hex is one even tint with no seam. In state B the location is dirty and WALLETS.mixed holds 0 DC, so the tool's cost card would read \"100,000 DC ($1.00) + network fee\" with the top-up warning and a \"Top up Data Credits\" button. The cost card and button are never in frame in B. Hero framing: main max-width raised to 920px (card 872px) and the map wrapper raised from 224px to 400px. MapLibre's ResizeObserver resized the canvas to 830x398 and the centre was kept. The help line, the Elevation/Gain row, the cost card and the button are collapsed, so the card reads name -> key -> map -> lat/lng. Zoom is set through the component's own controlled viewState (centre unchanged). Zoom 17.5 in B gives a ~67px hex with street labels; zoom 17 in A. hotspot-list.png: the sixth row fades into the page background (sharp gradient composite in the page's own surface colour) instead of a mid-row cut. full.png is now the 26-row list page, not a copy of viewport.png. Light and dark come from the same load via emulateMedia; the basemap switches live between Carto Positron and Dark Matter, and every dark shot was checked to be dark. Every shot is dpr 2 except detail.png (dpr 3, a second load). The open-elevation request is aborted, but it never fires here because elevation is already set.",
  shots: {
    "hero.png": { dpr: 2, kind: "element", role: "hero", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "Editor card for Hotspot \"Huge Lava Raccoon\" led by a tall location picker: name + entity key, then an ~830x400 MapLibre map at zoom 17.5 of a dense row-house grid with named streets (Lincoln Avenue, East Sherman Street, Hays Street, Meade Alley, Sheridan Street, Evergreen Road) and the violet drop pin centred on its translucent res-12 H3 hexagon sitting wholly on one large roof, then the Latitude/Longitude fields (40.480057, -79.970868). Card widened to 872px and map raised from 224 to 400px for this shot; help line, Elevation/Gain row, cost card and button collapsed." },
    "map.png": { dpr: 2, kind: "element", role: "supporting", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "The location picker alone (~2:1, 832x400 map inside 20px of card surface): violet pin + even-toned H3 hex on a single roof, dense building footprints, street grid with labels, use-my-location button top-right. Same dense-street view as the hero." },
    "editor-card.png": { dpr: 2, kind: "element", role: "supporting", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "The complete editor card at native size for Hotspot \"Fancy Shadow Elephant\" at its real asserted location: name, entity key, help line (\"Asserted 3 time(s) so far\"), 584x224 map at zoom 17 with the pin + hex wholly on open ground beside Queen Street (Oak Avenue, Union Way, East High Street labelled), Latitude/Longitude/Elevation (m) 9/Gain (dBi) 8 inputs, Hotspot type Full (PoC eligible) / Cost No DC fee (metadata-only change), and the live accent \"Update Hotspot\" button." },
    "fields-cost.png": { dpr: 2, kind: "element-crop", role: "supporting", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "Form fragment cropped inside the card surface: Latitude 40.819632 / Longitude -79.519423 / Elevation 9 / Gain 8 inputs, the inset cost panel (Full (PoC eligible), No DC fee (metadata-only change)) and the full-width \"Update Hotspot\" button." },
    "hotspot-list.png": { dpr: 2, kind: "element", role: "supporting", wallet: "2mwuyMhooEnqjsBuQKvjNuNv9Ju2xQUwutdTz6sZB8rJ", describes: "Wallet Hotspot picker for a 26-Hotspot fleet: \"26 IoT Hotspot(s)\" count, purple connected-wallet button 2mwu..B8rJ, search field, and rows Active Goldenrod Swan, Proud Stone Newt, Passive Carrot Horse, Raspy Heather Cow, Perfect Grey Wallaby, each with a Full pill, pin + town and a chevron; the sixth row (Atomic Rainbow Canary) fades into the page background so no row is cut mid-height. 40/36/40 padding." },
    "detail.png": { dpr: 3, kind: "macro", role: "detail", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "dpr-3 macro of the map centre: violet drop pin inside the translucent violet res-12 H3 hexagon, the hex fully on one flat roof (single even tint, no seam), neighbouring roofs, Lincoln Avenue label and an East Sherman Street fragment at the left edge." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", wallet: "7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F", describes: "1440x960 viewport of the populated tool: site header with breadcrumb, tool title + lime map-pin icon, \"All Hotspots\" back link, and the full editor card for Fancy Shadow Elephant (same state as editor-card.png)." },
    "full.png": { dpr: 2, kind: "full-page", role: "backdrop", wallet: "2mwuyMhooEnqjsBuQKvjNuNv9Ju2xQUwutdTz6sZB8rJ", describes: "Full page (1440 wide, ~2090 tall) of the list state for the 26-Hotspot IoT-only fleet: header, title, count + wallet button, search, and all 26 rows with Full pills and town names. Distinct from viewport.png (different state)." },
  },
};

const A = { name: 'Fancy Shadow Elephant', zoom: 17, elevation: '9', gain: '8' };
const B = { name: 'Huge Lava Raccoon', zoom: 17.5, lat: '40.480057', lng: '-79.970868', cell: '8c2a847360ac3ff' };
const WIDE_CSS = `main.max-w-2xl{max-width:920px!important} main .mx-auto.max-w-2xl{max-width:none!important} main div.relative.h-56{height:400px!important}`;

// ---- React-fiber helpers: the MapLibre instance, and the editor's controlled viewState setter.
const FIND_MAP = `(() => {
  const el = document.querySelector('.maplibregl-map');
  if (!el) return null;
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  let f = el[key];
  for (let i = 0; f && i < 30; i++, f = f.return) {
    let h = f.memoizedState;
    for (let j = 0; h && j < 60 && typeof h === 'object'; j++, h = h.next) {
      const v = h.memoizedState;
      for (const c of [v, v && v.current, Array.isArray(v) ? v[0] : null]) {
        if (!c || typeof c !== 'object') continue;
        if (typeof c.getZoom === 'function') return c;
        try { if (c.map && typeof c.map.getZoom === 'function') return c.map; } catch {}
        if (c._map && typeof c._map.getZoom === 'function') return c._map;
      }
    }
  }
  return null;
})()`;
// Zoom through the component's own viewState (react-map-gl is controlled, so a direct
// map.jumpTo is reverted). Centre is untouched, so the asserted/typed location never moves.
const SET_ZOOM = (z) => `(() => {
  window.__map = ${FIND_MAP};
  const el = document.querySelector('.maplibregl-map');
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  let f = el[key];
  for (let i = 0; f && i < 40; i++, f = f.return) {
    let h = f.memoizedState;
    for (let j = 0; h && j < 80 && typeof h === 'object'; j++, h = h.next) {
      const v = h.memoizedState;
      if (v && typeof v === 'object' && 'zoom' in v && 'latitude' in v && 'longitude' in v && h.queue && h.queue.dispatch) {
        h.queue.dispatch((old) => ({ ...old, zoom: ${z} }));
        return true;
      }
    }
  }
  return false;
})()`;

async function box(loc) {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}
function frame(boxes, padX, padTop, padBottom = padTop) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: Math.round(x0 - padX), y: Math.round(y0 - padTop), width: Math.round(x1 - x0 + 2 * padX), height: Math.round(y1 - y0 + padTop + padBottom) };
}
async function setStyle(locs, prop, val) {
  for (const l of locs) await l.evaluate((el, [p, v]) => { el.style[p] = v; }, [prop, val]);
}
async function setHidden(locs, on) {
  for (const l of locs) await l.evaluate((el, h) => { if (h) el.setAttribute('hidden', ''); else el.removeAttribute('hidden'); }, on);
}
async function idle(page, sleep, ms = 2000) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
  await sleep(ms);
}
async function waitMap(page, sleep, extra = 1800) {
  await idle(page, sleep, 300);
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i++) {
    const ready = await page.evaluate(() => { const m = window.__map; return !!m && m.isStyleLoaded() && m.areTilesLoaded() && !m.isMoving(); }).catch(() => false);
    ok = ready ? ok + 1 : 0;
    await sleep(400);
  }
  if (ok < 2) console.log('[warn] map not reporting fully loaded');
  await sleep(extra);
}
async function shootRect(page, rect, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip: rect, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 30000 });
}

// Load the route, wait for the wallet's IoT Hotspot list (retry on 429/errors).
async function openList(page, sleep, wallet) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt === 0) await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
    else { console.log('[retry] list load, waiting 45s'); await sleep(45000); await page.reload({ waitUntil: 'domcontentloaded' }); }
    try {
      await page.getByText(/\d+ IoT Hotspot\(s\)/).waitFor({ timeout: 90000 });
      await page.locator('main ul li button').first().waitFor({ timeout: 30000 });
      return;
    } catch (e) { console.log('[list] not ready:', String(e).slice(0, 120)); }
  }
  throw new Error('IoT Hotspot list never loaded for ' + wallet);
}
async function openEditor(page, sleep, name) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    try {
      await page.getByText(/Drag the map/).waitFor({ timeout: 60000 });
      await page.waitForFunction(() => !!document.querySelector('.maplibregl-canvas'), null, { timeout: 30000 });
      return;
    } catch (e) {
      console.log('[retry] editor for', name, String(e).slice(0, 120));
      await page.getByRole('button', { name: /All Hotspots/ }).click().catch(() => {});
      await sleep(45000);
    }
  }
  throw new Error('editor never loaded for ' + name);
}
async function backToList(page) {
  await page.getByRole('button', { name: /All Hotspots/ }).click();
  await page.getByText(/\d+ IoT Hotspot\(s\)/).waitFor({ timeout: 30000 });
}
async function zoomTo(page, sleep, z) {
  const ok = await page.evaluate(SET_ZOOM(z));
  if (!ok) throw new Error('viewState setter not found');
  await waitMap(page, sleep);
  const zNow = await page.evaluate(() => window.__map.getZoom());
  if (Math.abs(zNow - z) > 0.01) throw new Error('zoom did not apply: ' + zNow);
}
async function moveTo(page, sleep, lat, lng) {
  const inputs = page.locator('main input');
  await inputs.nth(0).fill(lat);
  await inputs.nth(1).fill(lng);
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(1200);
}
async function park(page) { await page.mouse.move(1435, 955); }
async function costText(page) {
  return (await page.locator('main div.bg-surface-inset').filter({ hasText: 'Hotspot type' }).innerText()).replace(/\n/g, ' | ');
}
async function editorParts(page) {
  return {
    card: page.locator('main div.rounded-2xl').first(),
    mapWrap: page.locator('main div.relative.h-56').first(),
    grid: page.locator('main div.grid.grid-cols-2').first(),
    gridLower: page.locator('main div.grid.grid-cols-2 > div:nth-child(n+3)'),
    costCard: page.locator('main div.bg-surface-inset').filter({ hasText: 'Hotspot type' }).first(),
    btnRow: page.locator('main button', { hasText: /Update Hotspot|Top up Data Credits|No changes/ }).locator('..'),
    back: page.locator('main button', { hasText: 'All Hotspots' }).first(),
    intro: page.locator('main > div.mb-6').first(),
    help: page.locator('main p', { hasText: 'Drag the map' }).first(),
  };
}
async function bgColor(page) {
  return page.evaluate(() => getComputedStyle(document.querySelector('div.min-h-screen')).backgroundColor);
}
// Fade the bottom of a captured PNG into the page background: transparent at fromCss,
// fully the background colour from toCss to the bottom edge (CSS px within the shot).
async function fadeBottom(file, fromCss, toCss, dpr, rgb) {
  const { width, height } = await sharp(file).metadata();
  const y0 = Math.round(fromCss * dpr);
  const h = height - y0;
  const stop = Math.min(1, (toCss - fromCss) * dpr / h).toFixed(3);
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  const c = `rgb(${r},${g},${b})`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset="${stop}" stop-color="${c}" stop-opacity="1"/><stop offset="1" stop-color="${c}" stop-opacity="1"/></linearGradient></defs><rect width="${width}" height="${h}" fill="url(#f)"/></svg>`);
  const buf = await sharp(file).composite([{ input: svg, left: 0, top: y0 }]).png().toBuffer();
  fs.writeFileSync(file, buf);
}

async function sources({ newPage, sleep }) {
  for (const theme of THEMES) fs.mkdirSync(path.join(OUT, theme), { recursive: true });

  // ======================= States A + B (mixed wallet, dpr 2) =======================
  {
    const page = await newPage({ colorScheme: 'light', wallet: WALLETS.mixed, width: 1440, height: 960, dpr: 2 });
    await page.route('**/api.open-elevation.com/**', (r) => r.abort());
    await openList(page, sleep, 'mixed');
    await idle(page, sleep, 800);

    // ---- A: metadata-only edit on an asserted cell that sits on open ground.
    await openEditor(page, sleep, A.name);
    await idle(page, sleep, 1200);
    await zoomTo(page, sleep, A.zoom);
    await page.locator('input[placeholder="above ground level"]').fill(A.elevation);
    await page.locator('input[placeholder="e.g. 1.2"]').fill(A.gain);
    await page.evaluate(() => document.activeElement?.blur?.());
    await sleep(800);
    const costA = await costText(page);
    const valsA = await page.locator('main input').evaluateAll((els) => els.map((e) => e.value));
    console.log('A inputs', JSON.stringify(valsA), '| cost', costA);
    if (!/No DC fee/.test(costA)) throw new Error('state A is not the metadata-only state: ' + costA);
    {
      const e = await editorParts(page);
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await waitMap(page, sleep, theme === 'dark' ? 2500 : 1800);
        await park(page);
        await page.screenshot({ path: P(theme, 'viewport.png'), animations: 'disabled', caret: 'hide' });
        await setStyle([e.intro, e.back], 'visibility', 'hidden');
        const cardR = frame([await box(e.card)], 40, 40, 44);
        await shootRect(page, cardR, P(theme, 'editor-card.png'));
        await setStyle([e.mapWrap, e.help], 'visibility', 'hidden');
        const fcR = frame([await box(e.grid), await box(e.costCard), await box(e.btnRow)], 16, 18, 16); // stays inside the card surface
        await shootRect(page, fcR, P(theme, 'fields-cost.png'));
        await setStyle([e.mapWrap, e.help, e.intro, e.back], 'visibility', '');
      }
      await page.emulateMedia({ colorScheme: 'light' });
      await waitMap(page, sleep, 800);
    }

    // ---- B: re-position the pin onto a single roof in a dense area; tall, wide map.
    await backToList(page);
    await openEditor(page, sleep, B.name);
    await idle(page, sleep, 1200);
    const wide = await page.addStyleTag({ content: WIDE_CSS });
    await sleep(800);
    await moveTo(page, sleep, B.lat, B.lng);
    await zoomTo(page, sleep, B.zoom);
    const valsB = await page.locator('main input').evaluateAll((els) => els.map((e) => e.value));
    console.log('B inputs', JSON.stringify(valsB));
    if (valsB[0] !== B.lat || valsB[1] !== B.lng) throw new Error('B location did not apply');
    {
      const e = await editorParts(page);
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await waitMap(page, sleep, theme === 'dark' ? 2500 : 1800);
        await park(page);
        await setStyle([e.intro, e.back], 'visibility', 'hidden');
        // map.png — the location picker alone, inside the card's own surface.
        await setStyle([e.help, e.grid], 'visibility', 'hidden');
        const mapR = frame([await box(e.mapWrap)], 20, 20);
        await shootRect(page, mapR, P(theme, 'map.png'));
        await setStyle([e.help, e.grid], 'visibility', '');
        // hero.png — the editor card led by the location picker.
        await setHidden([e.help], true);
        await setStyle([e.costCard, e.btnRow], 'display', 'none');
        for (let i = 0; i < await e.gridLower.count(); i++) await setStyle([e.gridLower.nth(i)], 'display', 'none');
        await sleep(500);
        const heroR = frame([await box(e.card)], 44, 40, 44);
        await shootRect(page, heroR, P(theme, 'hero.png'));
        await setHidden([e.help], false);
        await setStyle([e.costCard, e.btnRow], 'display', '');
        for (let i = 0; i < await e.gridLower.count(); i++) await setStyle([e.gridLower.nth(i)], 'display', '');
        await setStyle([e.intro, e.back], 'visibility', '');
        await sleep(300);
      }
    }
    await wide.evaluate((el) => el.remove());
    await page.context().close();
  }

  // ======================= State B detail (mixed wallet, dpr 3) =======================
  {
    const p3 = await newPage({ colorScheme: 'light', wallet: WALLETS.mixed, width: 1440, height: 960, dpr: 3 });
    await p3.route('**/api.open-elevation.com/**', (r) => r.abort());
    await openList(p3, sleep, 'mixed');
    await openEditor(p3, sleep, B.name);
    await idle(p3, sleep, 1200);
    await p3.addStyleTag({ content: WIDE_CSS });
    await sleep(800);
    await moveTo(p3, sleep, B.lat, B.lng);
    await zoomTo(p3, sleep, B.zoom);
    const mapWrap = p3.locator('main div.relative.h-56').first();
    for (const theme of THEMES) {
      await p3.emulateMedia({ colorScheme: theme });
      await waitMap(p3, sleep, theme === 'dark' ? 2500 : 1800);
      await park(p3);
      const mb = await box(mapWrap);
      const W = 320, H = 220;
      const r = { x: Math.round(mb.x + mb.width / 2 - W / 2), y: Math.round(mb.y + mb.height / 2 - H / 2 - 6), width: W, height: H };
      await shootRect(p3, r, P(theme, 'detail.png'));
    }
    await p3.context().close();
  }

  // ======================= State C (iotOnly wallet, dpr 2) =======================
  {
    const page = await newPage({ colorScheme: 'light', wallet: WALLETS.iotOnly, width: 1440, height: 960, dpr: 2 });
    await openList(page, sleep, 'iotOnly');
    await idle(page, sleep, 1500);
    const countTxt = await page.locator('main > div.mb-4 p').first().innerText();
    console.log('C count', countTxt);
    const countRow = page.locator('main > div.mb-4').first();
    const list = page.locator('main div.space-y-3').first();
    const rows = page.locator('main div.space-y-3 ul > li'); // (the wallet button has its own hidden dropdown <ul>)
    const intro = page.locator('main > div.mb-6').first();
    const SHOW = 6;
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(900);
      await park(page);
      // full.png — the whole 26-row fleet page.
      await page.screenshot({ path: P(theme, 'full.png'), fullPage: true, animations: 'disabled', caret: 'hide' });
      // hotspot-list.png — count + wallet button + search + six rows, the sixth fading out.
      await setStyle([intro], 'visibility', 'hidden');
      const lb = await box(list);
      const lastRow = await box(rows.nth(SHOW - 1));
      const cb = await box(countRow);
      const rect = { x: Math.round(lb.x - 40), y: Math.round(cb.y - 36), width: Math.round(lb.width + 80), height: Math.round(lastRow.y + lastRow.height + 40 - (cb.y - 36)) };
      await shootRect(page, rect, P(theme, 'hotspot-list.png'));
      await fadeBottom(P(theme, 'hotspot-list.png'), lastRow.y - rect.y + 4, lastRow.y + lastRow.height - rect.y + 2, 2, await bgColor(page));
      await setStyle([intro], 'visibility', '');
    }
    await page.context().close();
  }

  writeManifest(OUT, MANIFEST);
}

// ======================= Macros the landing card uses (state B, dpr 4) =======================
const MACRO_DPR = 4;
const MACRO_PAD = 12; // card surface kept around each element, CSS px (the card has 20px padding)
const VIEW = { width: 390, height: 844 };
// Files an earlier version of the macro pass wrote; dropped from the manifest.
const RETIRED = ['fields-a-macro.png', 'cost-a-macro.png', 'fields-b-macro.png', 'map-b-macro.png'].flatMap((f) => [`light/${f}`, `dark/${f}`]);
const mpad = (b, p = MACRO_PAD) => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
const snap = (r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });

async function macros({ newPage, settle, sleep, shootRect }) {
  const page = await newPage({ colorScheme: 'light', ...VIEW, dpr: MACRO_DPR, wallet: WALLETS.mixed });
  await page.route('**/api.open-elevation.com/**', (r) => r.abort());

  const grid = () => page.locator('main div.grid.grid-cols-2').first();
  const values = () => page.locator('main div.grid.grid-cols-2 input').evaluateAll((els) => els.map((e) => e.value));

  // Wait until MapLibre reports the style and every tile loaded and the camera still.
  async function waitMapStill(extra = 1800) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {}
    await page.evaluate(`window.__map = ${FIND_MAP}`);
    let ok = 0;
    for (let i = 0; i < 60 && ok < 2; i++) {
      const ready = await page
        .evaluate(() => {
          const m = window.__map;
          return !!m && m.isStyleLoaded() && m.areTilesLoaded() && !m.isMoving();
        })
        .catch(() => false);
      ok = ready ? ok + 1 : 0;
      await sleep(400);
    }
    if (ok < 2) console.log('[warn] map not reporting fully loaded');
    await sleep(extra);
  }

  const shots = [];
  async function shootBoth(rects, describe, ready) {
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(theme === 'dark' ? 2500 : 1500);
      if (ready) await ready();
      await page.mouse.move(VIEW.width - 2, 2);
      for (const [file, r] of Object.entries(rects)) {
        await shootRect(page, r, P(theme, file));
        shots.push({ file: `${theme}/${file}`, theme, kind: 'crop', describes: describe[file], cssWidth: r.width, cssHeight: r.height, dpr: MACRO_DPR, wallet: WALLETS.mixed, role: 'detail' });
        console.log('wrote', `${theme}/${file}`, `${r.width}x${r.height} css`);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await sleep(800);
  }

  await openList(page, sleep, 'mixed');
  await settle(page, 800);

  // Type the new location (the pin and hex move onto the Lincoln Avenue roof).
  await openEditor(page, sleep, B.name);
  await settle(page, 1200);
  const inputs = page.locator('main div.grid.grid-cols-2 input');
  await inputs.nth(0).fill(B.lat);
  await inputs.nth(1).fill(B.lng);
  await page.evaluate(() => document.activeElement?.blur?.());
  await settle(page, 1500);
  const vals = await values();
  console.log('inputs', JSON.stringify(vals));
  if (vals[0] !== B.lat || vals[1] !== B.lng) throw new Error('the typed location did not apply');
  await grid().scrollIntoViewIfNeeded();
  await shootBoth(
    { 'fields-macro.png': snap(mpad(await box(grid()))) },
    { 'fields-macro.png': `Macro (dpr ${MACRO_DPR}, 390px phone viewport) of the editor's field grid for "${B.name}" after a new location was typed: Latitude ${vals[0]}, Longitude ${vals[1]}, Elevation (m) ${vals[2]}, Gain (dBi) ${vals[3]}. Same state as hero.png / detail.png.` },
  );

  // The location picker as a portrait: the map wrapper raised from 224px to 420px
  // (MapLibre's ResizeObserver resizes the canvas, centre kept) and zoomed to
  // 17.5 through the component's own viewState, as hero.png is. The rect keeps
  // the pin's cell in the top third, so a strip can cross the map below it.
  await page.addStyleTag({ content: 'main div.relative.h-56{height:420px!important}' });
  await sleep(800);
  if (!(await page.evaluate(SET_ZOOM(B.zoom)))) throw new Error('viewState setter not found');
  await waitMapStill();
  const zoom = await page.evaluate(() => window.__map.getZoom());
  if (Math.abs(zoom - B.zoom) > 0.01) throw new Error(`zoom did not apply: ${zoom}`);
  const mapBox = await box(page.locator('main div.relative.h-56').first());
  const cx = mapBox.x + mapBox.width / 2;
  const cy = mapBox.y + mapBox.height / 2;
  const MAP = { w: 216, h: 282, above: 82 }; // css px; `above` = rect top to the map centre (the pin's cell)
  if (mapBox.width < MAP.w || mapBox.height / 2 < MAP.h - MAP.above) throw new Error(`map too small: ${mapBox.width}x${mapBox.height}`);
  const mapRect = snap({ x: cx - MAP.w / 2, y: cy - MAP.above, width: MAP.w, height: MAP.h });
  await page.locator('main div.relative.h-56').first().scrollIntoViewIfNeeded();
  await shootBoth(
    { 'map-macro.png': mapRect },
    { 'map-macro.png': `Macro (dpr ${MACRO_DPR}, 390px phone viewport, map raised to 420px, zoom ${B.zoom}) of the location picker for "${B.name}" at the typed location: the violet pin centred on its translucent res-12 H3 hex on one large roof off Lincoln Avenue, the cell in the top third of a ${MAP.w}x${MAP.h} portrait. Same view as hero.png's map.` },
    waitMapStill,
  );

  mergeManifest(OUT, shots, { drop: RETIRED, seed: { slug: MANIFEST.slug, route: MANIFEST.route, wallet: MANIFEST.wallet } });
}

await run(async (h) => {
  if (PHASE !== 'macros') await sources(h);
  if (PHASE !== 'sources') await macros(h);
}, { timeoutMs: 600000 + 600000 });
