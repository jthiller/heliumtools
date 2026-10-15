// Wallet Dashboard (/wallet-dashboard/<wallet>) — source captures for the landing-page preview art.
//
//   node capture/wallet-dashboard.mjs                 -> all phases (nyc, large, main)
//   node capture/wallet-dashboard.mjs large main      -> selected phases
//   (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/wallet-dashboard/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses hero.png and mobile-activity.png,
// plus fleet-map.png on its featured (two-column) stage (previews/wallet-dashboard.js);
// the other shots are spare source material.
//
// BASE must serve the Mobile activity engine: the reference capture was taken from
// https://heliumtools.org because the local dev server's node_modules lacked its deps
// (icebird, hyparquet, hyparquet-compressors, fzstd; listed in pages/public/package.json),
// so on localhost:5174 the Mobile card errored behind a Vite import-analysis overlay.
// Run `npm install` in pages/public first, or set BASE=https://heliumtools.org (which
// shows the deployed UI, so only when the change being captured is already live).
//
// Read-only: the dashboard takes the wallet from its URL (no wallet connect). The
// only inputs are map pans/zooms, a Hotspot's map dot and its "Modeled coverage"
// toggle; nothing is signed or sent.
//
// Wallets (only lib.mjs's WALLETS; each phase is one page load, and light + dark
// come from the same load):
//   nyc   — 2,172 Mobile Hotspots in NYC: viewport.png + hero.png
//   large — 1,659 Hotspots: fleet-map.png (Great Lakes→East Coast), mobile-activity.png,
//           deployment-timeline.png, detail.png
//   main  — 10 Hotspots (FL): hotspot-coverage.png (selected IoT Hotspot + modeled coverage)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS, writeManifest } from '../lib.mjs';

// h3-js from the repo's frontend deps (same version the page uses).
const h3 = createRequire(fileURLToPath(new URL('../../../pages/public/package.json', import.meta.url)))('h3-js');
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/wallet-dashboard/', import.meta.url));
const out = (theme, f) => path.join(OUT, theme, f);
const ALL_PHASES = ['nyc', 'large', 'main'];
const phases = process.argv.slice(2).length ? process.argv.slice(2) : ALL_PHASES;
for (const p of phases) if (!ALL_PHASES.includes(p)) throw new Error(`unknown phase ${p}: use ${ALL_PHASES.join(', ')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SHOT = { animations: 'disabled', caret: 'hide' };

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "wallet-dashboard",
  route: "/wallet-dashboard/<wallet>",
  wallet: "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux",
  wallets: {"hero_viewport": "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux", "fleet_map_and_mobile_cards": "9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6", "hotspot_coverage": "BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd"},
  notes: "Light and dark always come from the same page load via emulateMedia; element crops are scrolled clear of the sticky site header. Three wallets, all from WALLETS, so numbers do NOT reconcile across plates: nyc (2,172 Mobile, viewport + hero), large 9Zye… (1,659 Hotspots, fleet-map + mobile-activity + deployment-timeline + detail), main BMJi… (10 Hotspots FL, hotspot-coverage). Mask/crop candidates for the art director: (1) hero.png / viewport.png: the map legend covers the PASSAIC basemap label (leaving \"SAIC\"), the IOT row shows 0 / $0.00 with an amber NO ATA chip, and in dark mode the white MapLibre attribution pill and zoom controls are the brightest marks on the map — all safe to mask. (2) fleet-map.png: the legend clips the WISCONSIN label. Re-run: node capture/wallet-dashboard.mjs [nyc|large|main].",
  shots: {
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", wallet: "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux", describes: "Populated bento at 1440x960: portfolio strip ($586.11, 2,172 Hotspots, 96% ever rewarded, $25.36 unclaimed), fleet map framed on New York with ~2,170 violet Mobile dots tracing Manhattan, Brooklyn and Queens, token balances (HNT, MOBILE, IOT, SOL, DC with USD) and the unclaimed-rewards card. (wallet nyc: nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux)" },
    "hero.png": { dpr: 2, kind: "element", role: "hero", wallet: "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux", describes: "Tight bento crop (1040-wide layout): portfolio value + stat strip on top, fleet map of 2,172 Mobile Hotspots across New York City on the left, token balances and unclaimed rewards stacked on the right. Reads as wallet + fleet + money at thumbnail size. (wallet nyc: nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux)" },
    "fleet-map.png": { dpr: 2, kind: "element", role: "supporting", wallet: "9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6", describes: "Fleet map card framed on the Great Lakes to East Coast band where most of a 1,659-Hotspot fleet sits: dense violet Mobile clusters around Milwaukee, Chicago, Detroit, Cleveland, Buffalo, Philadelphia, Baltimore/Washington and New York, a few gray never-rewarded dots, state and city labels, legend top-left. (wallet large: 9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6)" },
    "hotspot-coverage.png": { dpr: 2, kind: "element", role: "supporting", wallet: "BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd", describes: "Fleet map with one IoT Hotspot selected (Cheerful Carbon Armadillo, Lutz FL): the whole modeled-coverage footprint (12 res-8 hexes, dark/bright centre cell plus falloff ring) sits to the right of the floating detail panel with basemap margin on every side; the panel shows a 30-day daily-messages bar chart (61,345 messages) and per-operator legend. (wallet main: BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd)" },
    "mobile-activity.png": { dpr: 2, kind: "element", role: "supporting", wallet: "9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6", describes: "Live Mobile activity card (read in-browser from Helium's Iceberg tables): 473.99 HNT earned from data transfer with a 7-day violet bar chart, 1.01 TB rewarded data, 171,463 users served, 1,042 of 1,647 WiFi Hotspots heartbeating, amber health rows, Live status pill. (wallet large: 9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6)" },
    "deployment-timeline.png": { dpr: 2, kind: "element", role: "supporting", wallet: "9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6", describes: "Deployment timeline histogram: 1,656 Hotspots by on-chain onboard date, Apr 2023 to Feb 2026, teal bars with a 2025 build-out peak. (wallet large: 9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6)" },
    "detail.png": { dpr: 3, kind: "element", role: "detail", wallet: "9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6", describes: "Macro at dpr 3: Mobile earnings headline (473.99 HNT, $207.18), 7-day violet bar chart and the rewarded-data (1.01 TB) / users-served (171,463) tiles. (wallet large: 9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6)" },
  },
};

// ---------- Web Mercator (deck.gl: 512px world at zoom 0, pitch/bearing 0) ----------
const wx = (lng, z) => ((lng + 180) / 360) * 512 * 2 ** z;
const wy = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 512 * 2 ** z;
};
const lngOf = (x, z) => (x / (512 * 2 ** z)) * 360 - 180;
const latOf = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / (512 * 2 ** z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};
const project = (vs, lat, lng, w, h) => [wx(lng, vs.zoom) - wx(vs.longitude, vs.zoom) + w / 2, wy(lat, vs.zoom) - wy(vs.latitude, vs.zoom) + h / 2];

// A view that fits [lat,lng] points into the canvas minus padding.
function fitView(points, w, h, pad = { l: 40, r: 40, t: 40, b: 40 }, maxZoom = 16) {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const [s, n, west, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const availW = w - pad.l - pad.r;
  const availH = h - pad.t - pad.b;
  const dx0 = wx(e, 0) - wx(west, 0) || 1e-6;
  const dy0 = wy(s, 0) - wy(n, 0) || 1e-6;
  const zoom = Math.min(maxZoom, Math.log2(availW / dx0), Math.log2(availH / dy0));
  const cx = (wx(west, zoom) + wx(e, zoom)) / 2;
  const cy = (wy(n, zoom) + wy(s, zoom)) / 2;
  const tx = pad.l + availW / 2 - w / 2;
  const ty = pad.t + availH / 2 - h / 2;
  return { zoom, longitude: lngOf(cx - tx, zoom), latitude: latOf(cy - ty, zoom) };
}

// ---------- page helpers ----------
function trackTiles(page) {
  const inflight = new Set();
  let last = Date.now();
  const isTile = (u) => /cartocdn|basemaps|openmaptiles|tiles\./i.test(u);
  page.on('request', (r) => { if (isTile(r.url())) { inflight.add(r); last = Date.now(); } });
  const done = (r) => { if (inflight.delete(r)) last = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async function waitTiles(quiet = 2500, max = 45000) {
    const t0 = Date.now();
    await sleep(600);
    while (Date.now() - t0 < max) {
      if (inflight.size === 0 && Date.now() - last > quiet) break;
      await sleep(250);
    }
    await sleep(1200); // let MapLibre paint the last tiles
  };
}

async function getVS(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas#deckgl-overlay');
    if (!c) return null;
    const key = Object.keys(c).find((k) => k.startsWith('__reactFiber$'));
    let f = c[key];
    while (f) {
      const p = f.memoizedProps;
      if (p && p.viewState && typeof p.viewState.longitude === 'number') {
        const { longitude, latitude, zoom } = p.viewState;
        return { longitude, latitude, zoom };
      }
      f = f.return;
    }
    return null;
  });
}
const canvasRect = (page) => page.evaluate(() => {
  const r = document.querySelector('canvas#deckgl-overlay').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  await sleep(80);
  await page.mouse.up();
  await sleep(300);
}

// Drive deck's own controller (wheel zoom about a point, drag pan) to a target view.
// Wheel-zoom anchors on the target (clamped into `safe`, fractions of the canvas)
// and drags start from `grab`, so neither lands on the detail panel.
async function setView(page, target, { grab = [0.5, 0.5], safe = [0.03, 0.97, 0.05, 0.95] } = {}) {
  for (let i = 0; i < 60; i++) {
    const vs = await getVS(page);
    const r = await canvasRect(page);
    const dz = target.zoom - vs.zoom;
    const [px, py] = project(vs, target.latitude, target.longitude, r.width, r.height);
    if (Math.abs(dz) > 0.03) {
      const step = clamp(dz, -0.9, 0.9);
      const scale = 2 ** Math.abs(step);
      const d = -100 * Math.log(2 / scale - 1);
      await page.mouse.move(r.x + clamp(px, r.width * safe[0], r.width * safe[1]), r.y + clamp(py, r.height * safe[2], r.height * safe[3]));
      await page.mouse.wheel(0, step > 0 ? -d : d);
      await sleep(250);
      continue;
    }
    const dx = r.width / 2 - px;
    const dy = r.height / 2 - py;
    if (Math.hypot(dx, dy) < 1.5) break;
    const lim = Math.min(r.width * (1 - grab[0]), r.width * grab[0], r.height * (1 - grab[1]), r.height * grab[1]) * 1.6;
    const mx = clamp(dx, -lim, lim);
    const my = clamp(dy, -lim, lim);
    const cx = r.x + r.width * grab[0];
    const cy = r.y + r.height * grab[1];
    await drag(page, cx - mx / 2, cy - my / 2, cx + mx / 2, cy + my / 2);
  }
  const vs = await getVS(page);
  log('view', JSON.stringify(vs), 'target', JSON.stringify(target));
}

async function tooltipAt(page, x, y) {
  await page.mouse.move(x, y);
  await sleep(140);
  return page.evaluate(() => {
    const t = document.querySelector('.deck-tooltip');
    return t && getComputedStyle(t).display !== 'none' ? t.innerText : '';
  });
}

// Find a pixel whose topmost dot is `name` (dots overlap; tooltips name the picked one).
async function findDot(page, name, x, y) {
  if ((await tooltipAt(page, x, y)).startsWith(name)) return [x, y];
  for (let rad = 2; rad <= 14; rad += 1.5) {
    for (let a = 0; a < 360; a += 22.5) {
      const px = x + rad * Math.cos((a * Math.PI) / 180);
      const py = y + rad * Math.sin((a * Math.PI) / 180);
      if ((await tooltipAt(page, px, py)).startsWith(name)) return [px, py];
    }
  }
  return null;
}

// Poll until every dashboard card has settled (no skeletons, no "…" progress, Mobile live).
async function waitReady(page, { mobile = true, max = 240000 } = {}) {
  const t0 = Date.now();
  let info;
  while (Date.now() - t0 < max) {
    info = await page.evaluate(() => {
      const grid = document.querySelector('.wd-grid');
      if (!grid) return { ok: false, why: 'no grid' };
      const txt = grid.innerText;
      const mob = [...grid.querySelectorAll('h2')].find((h) => h.textContent.includes('Mobile activity'))?.closest('.wd-grid > *');
      return {
        skel: grid.querySelectorAll('.animate-pulse').length,
        ell: (txt.match(/…/g) || []).length,
        couldnt: /Couldn.t|unavailable|Updating/.test(txt),
        mobileLive: mob ? /Live/.test(mob.innerText) && !/Loading/.test(mob.innerText) : null,
      };
    });
    const ok = info.skel === 0 && info.ell === 0 && !info.couldnt && (!mobile || info.mobileLive === true);
    if (ok) { log('ready after', Math.round((Date.now() - t0) / 1000), 's'); return true; }
    await sleep(3000);
  }
  log('NOT ready', JSON.stringify(info));
  return false;
}

// The card box itself (not its grid cell, which can be taller than the card).
const cardOf = (page, title) => page.locator('.wd-grid .shadow-soft').filter({ has: page.locator('h2', { hasText: title }) }).first();
const box = async (loc) => { const b = await loc.boundingBox(); const sy = await loc.page().evaluate(() => scrollY); return { ...b, y: b.y + sy }; };
// Element crop that never sits under the sticky site header: scroll the element
// to just below the header first (Playwright only scrolls when it's off-screen).
async function shootEl(page, loc, file) {
  await loc.evaluate((el) => {
    const hdr = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    window.scrollBy(0, el.getBoundingClientRect().top - hdr - 24);
  });
  await sleep(350);
  await loc.screenshot({ path: file, ...SHOT });
}
// Hover an empty bit of the map first so deck drops its autoHighlight, then leave.
async function mouseAway(page) {
  const r = await canvasRect(page).catch(() => null);
  const vh = page.viewportSize().height;
  if (r && r.y > 0 && r.y + r.height < vh) {
    for (const [fx, fy] of [[0.97, 0.55], [0.6, 0.97], [0.97, 0.97], [0.5, 0.03], [0.03, 0.97], [0.75, 0.05]]) {
      const t = await tooltipAt(page, r.x + r.width * fx, r.y + r.height * fy);
      if (!t) break;
    }
  }
  await page.mouse.move(2, 400);
  await sleep(150);
}

// Capture an element at a higher device pixel ratio in place (no reload): CDP
// metrics override + captureScreenshot (clip in document coordinates).
async function shootHiDpi(page, loc, file, pad = { x: 14, y: 12 }, dpr = 3) {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const vp = page.viewportSize();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: false });
  await sleep(900);
  const b = await loc.boundingBox();
  const [sx, sy] = await page.evaluate(() => [scrollX, scrollY]);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: b.x - pad.x + sx, y: b.y - pad.y + sy, width: b.width + pad.x * 2, height: b.height + pad.y * 2, scale: 1 } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: false });
  await cdp.detach();
  await sleep(600);
}

async function openWallet(newPage, key) {
  const page = await newPage({ colorScheme: 'light' });
  const waitTiles = trackTiles(page);
  page.on('response', (r) => { if (r.status() === 429) log('[429]', r.url().slice(0, 120)); });
  const fleetResp = page.waitForResponse((r) => r.url().includes('/wallet-dashboard/fleet') && r.status() === 200, { timeout: 120000 });
  await page.goto(`${BASE}/wallet-dashboard/${WALLETS[key]}`, { waitUntil: 'domcontentloaded' });
  const fleet = await (await fleetResp).json();
  const pts = fleet.hotspots.filter((h) => h.location).map((h) => ({ name: h.name, ll: h3.cellToLatLng(h.location), h }));
  return { page, waitTiles, fleet, pts };
}

function percentileBox(points, lo = 0.02, hi = 0.98) {
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  return [[q(lats, lo), q(lngs, lo)], [q(lats, hi), q(lngs, hi)]];
}

// ---------- phases ----------
const PHASES = {
  // Viewport + hero: 2,172 Mobile Hotspots, map framed on New York.
  async nyc({ newPage }) {
    const { page, waitTiles, pts } = await openWallet(newPage, 'nyc');
    await waitReady(page);
    await waitTiles();
    const r = await canvasRect(page);
    const ny = pts.map((p) => p.ll).filter(([la, ln]) => la > 40.3 && la < 41.2 && ln > -74.6 && ln < -73.4);
    log('nyc points', ny.length, 'of', pts.length);
    const target = fitView(percentileBox(ny, 0.01, 0.99), r.width, r.height, { l: 150, r: 40, t: 30, b: 30 });
    await setView(page, target);
    await mouseAway(page);
    await waitTiles();

    const heroShot = async (theme) => {
      await page.setViewportSize({ width: 1040, height: 1100 });
      await page.evaluate(() => scrollTo(0, 0));
      await waitTiles();
      await mouseAway(page);
      const hero = await box(page.locator('.wd-grid > *').first());
      const map = await box(cardOf(page, 'Fleet map'));
      const pad = 16;
      await page.screenshot({ path: out(theme, 'hero.png'), clip: { x: hero.x - pad, y: hero.y - pad, width: hero.width + pad * 2, height: map.y + map.height - hero.y + pad * 2 }, ...SHOT });
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.evaluate(() => scrollTo(0, 0));
    };

    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: out('light', 'viewport.png'), ...SHOT });
    log('light viewport');
    await heroShot('light');
    log('light hero');
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitTiles();
    await heroShot('dark');
    log('dark hero');
    await waitTiles();
    await mouseAway(page);
    await waitReady(page, { max: 60000 });
    await page.screenshot({ path: out('dark', 'viewport.png'), ...SHOT });
    log('dark viewport');
  },

  // Card crops from the 1,659-Hotspot fleet; the map framed on the Great Lakes →
  // East Coast band where most of it sits.
  async large({ newPage }) {
    const { page, waitTiles, pts } = await openWallet(newPage, 'large');
    await waitReady(page);
    await waitTiles();
    const r = await canvasRect(page);
    const east = pts.map((p) => p.ll).filter(([la, ln]) => la > 36.5 && la < 45.5 && ln > -91 && ln < -71);
    log('large points', pts.length, 'east band', east.length);
    const target = fitView(percentileBox(east, 0.01, 0.99), r.width, r.height, { l: 160, r: 50, t: 50, b: 40 });
    await setView(page, target);
    await mouseAway(page);
    await waitTiles();

    const shots = async (theme) => {
      await waitReady(page, { max: 90000 });
      await mouseAway(page);
      for (const [title, file] of [['Fleet map', 'fleet-map.png'], ['Mobile activity', 'mobile-activity.png'], ['Deployment timeline', 'deployment-timeline.png']]) {
        const loc = cardOf(page, title);
        await loc.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - (document.querySelector('header')?.getBoundingClientRect().bottom || 0) - 24));
        if (title === 'Fleet map') { await waitTiles(); await mouseAway(page); }
        await shootEl(page, loc, out(theme, file));
        log(theme, file);
      }
      const earn = cardOf(page, 'Mobile activity').locator('div.flex-wrap > *').first();
      await shootHiDpi(page, earn, out(theme, 'detail.png'));
      log(theme, 'detail');
    };
    await shots('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitTiles();
    await shots('dark');
  },

  // A selected IoT Hotspot with its modeled coverage footprint, framed whole to the
  // right of the floating detail panel. WALLETS.main.
  async main({ newPage }) {
    const NAME = 'Cheerful Carbon Armadillo';
    const { page, waitTiles, pts } = await openWallet(newPage, 'main');
    const covResp = page.waitForResponse((r) => r.url().includes('/iot/coverage') && r.status() === 200, { timeout: 240000 });
    await waitReady(page);
    await waitTiles();
    const target = pts.find((p) => p.name === NAME);
    let r = await canvasRect(page);
    // Get close enough to click the dot.
    const lutz = pts.map((p) => p.ll).filter(([la, ln]) => Math.abs(la - target.ll[0]) < 0.05 && Math.abs(ln - target.ll[1]) < 0.05);
    await setView(page, fitView(lutz, r.width, r.height, { l: 420, r: 60, t: 60, b: 60 }, 14));
    await waitTiles();
    const vs = await getVS(page);
    const [tx, ty] = project(vs, target.ll[0], target.ll[1], r.width, r.height);
    const hit = await findDot(page, NAME, r.x + tx, r.y + ty);
    if (!hit) throw new Error('dot not found');
    await page.mouse.click(hit[0], hit[1]);
    await page.waitForSelector('[data-map-panel]', { timeout: 15000 });
    await page.getByRole('button', { name: 'Modeled coverage' }).click();
    const cov = await (await covResp).json();
    const drawn = cov.filter((c) => Number(c.rssi) >= -130);
    const ring = drawn.flatMap((c) => h3.cellToBoundary(c.hex));
    log('coverage cells', cov.length, 'drawn', drawn.length);
    await sleep(1500);
    for (let i = 0; i < 40; i++) {
      const t = await page.locator('[data-map-panel]').innerText();
      const sk = await page.locator('[data-map-panel] .animate-pulse').count();
      if (!/Loading|…/.test(t) && sk === 0) break;
      await sleep(1000);
    }
    // Frame the whole drawn footprint to the right of the panel, with basemap margin.
    r = await canvasRect(page);
    const panel = await page.locator('[data-map-panel]').boundingBox();
    const left = panel.x + panel.width - r.x + 56;
    const view = fitView(ring, r.width, r.height, { l: left, r: 56, t: 64, b: 64 }, 14);
    log('panel right', Math.round(left), 'fit', JSON.stringify(view));
    // Grab the map well to the right of the panel so drags never land on it.
    await setView(page, view, { grab: [0.78, 0.5], safe: [Math.min(0.9, (left + 20) / r.width), 0.96, 0.08, 0.92] });
    await mouseAway(page);
    await waitTiles();

    const shots = async (theme) => {
      const map = cardOf(page, 'Fleet map');
      await waitTiles();
      await mouseAway(page);
      await shootEl(page, map, out(theme, 'hotspot-coverage.png'));
      log(theme, 'hotspot-coverage');
    };
    await shots('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitTiles();
    await shots('dark');
  },
};

await run(async (h) => {
  for (const t of ['light', 'dark']) fs.mkdirSync(path.join(OUT, t), { recursive: true });
  for (const p of phases) {
    log('=== phase', p);
    await PHASES[p](h);
  }
  writeManifest(OUT, { ...MANIFEST, notes: `Captured from ${BASE}. ${MANIFEST.notes}` });
}, { timeoutMs: 1500000 });
