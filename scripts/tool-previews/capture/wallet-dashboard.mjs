// Wallet Dashboard (/wallet-dashboard/<wallet>): source captures for the landing-page preview art.
//
//   node capture/wallet-dashboard.mjs                 -> all phases (nyc, large, main)
//   node capture/wallet-dashboard.mjs large main      -> selected phases
//   (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/wallet-dashboard/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses hero.png (the Summary's Wallet
// value column) and mobile-activity.png (the Earnings "HNT per day" card), plus
// fleet-map.png (the Map section's sites) on its featured (two-column) stage
// (previews/wallet-dashboard.js); the other shots are spare source material.
//
// Every phase waits for the page to settle (waitReady) and fails the run when it
// doesn't, so a half-loaded page never becomes a source capture; the nyc phase
// (the Summary) also waits for whole rewards figures (ALLOW_PARTIAL=1 skips that).
//
// The page has stable hooks for this script; keep them when changing it:
//   - `.wd-root[data-wd-settled="true"]` once every Hotspot scan has settled,
//     and the Summary's data status chip (`[data-wd-card="identity"]
//     button[aria-haspopup="dialog"]`) reading "Live" once the Mobile check is;
//   - `[data-wd-section="summary|earnings|hotspots|health|map|wallet|about"]`;
//   - `[data-wd-card="identity|earnings-chart|map|onboarding-timeline"]` and
//     `[data-wd-col="value|unclaimed|earned|lifetime"]` (the money band);
//   - the map: `canvas#deckgl-overlay` with a controlled `viewState`, dev builds'
//     `window.__wdMap.getView()/setView()`, and `[data-map-panel]` (a selection).
// With `window.__wdMap` (any dev server) the camera is set directly, so no drag
// ever starts on an HTML site marker. Without it (a production build, such as
// BASE=https://heliumtools.org) the script falls back to reading the viewState
// from React's fiber and driving deck's own wheel zoom and drag pan (best
// effort; see setView).
//
// BASE must serve the Mobile activity engine (icebird, hyparquet,
// hyparquet-compressors, fzstd; listed in pages/public/package.json): run
// `npm install` in pages/public before starting the dev server. To capture a
// change that isn't deployed use the local dev server (BASE defaults to it);
// BASE=https://heliumtools.org shows production.
//
// Read-only: the dashboard takes the wallet from its URL (no wallet connect), and
// the Hotspot detail from its `hotspot` parameter. The only other inputs are
// viewport sizes, camera moves and the map panel's "Modeled coverage" toggle;
// nothing is signed or sent.
//
// Wallets (only lib.mjs's WALLETS; each phase is one page load, and light + dark
// come from the same load):
//   nyc   - 2,172 Mobile Hotspots in NYC: viewport.png + hero.png (1440 layout)
//   large - 1,659 Hotspots: fleet-map.png (sites from the Great Lakes to the East
//           Coast) and deployment-timeline.png at 1440; mobile-activity.png and
//           detail.png at a 480 layout (the Earnings card at a phone width)
//   main  - 10 Hotspots (FL): hotspot-coverage.png (a selected IoT Hotspot with
//           its modeled coverage)
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
const DESK = { width: 1440, height: 960 };
// The Earnings card at a phone width (448 px wide), where it has about the
// proportions of a portrait print and its readout reads large for its size.
const EARN_W = 480;
// Site groups merge by whole zoom (useSiteClusters floors it): from zoom 5 the
// Chicago and Milwaukee groups stay apart, so the fleet map never frames below it.
const SITE_ZOOM = 5.02;
// The map legend's right edge in the map area (MapLegend's floating box: left-3.5, w-[262px]).
const LEGEND_RIGHT = 276;
// The Hotspot the main phase opens (Cheerful Carbon Armadillo, an active IoT Hotspot).
const COVERAGE_ASSET = '4TEDfAAeFwXaitY12hE7nfJAuoWGTiDq9KgpC4ShQabZ';

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: 'wallet-dashboard',
  route: '/wallet-dashboard/<wallet>',
  wallet: WALLETS.nyc,
  wallets: { hero_viewport: WALLETS.nyc, fleet_map_earnings_timeline: WALLETS.large, hotspot_coverage: WALLETS.main },
  notes: 'Light and dark always come from the same page load via emulateMedia; element crops are scrolled clear of the sticky app bar. Three wallets, all from WALLETS, so numbers do NOT reconcile across plates: nyc (2,172 Mobile, viewport + hero), large 9Zye… (1,659 Hotspots, fleet-map + deployment-timeline at 1440, mobile-activity + detail at 480), main BMJi… (10 Hotspots FL, hotspot-coverage). fleet-map.png frames the sites in the map area right of the legend (x 290 to 980 css of the card), so a crop there misses the legend, the zoom controls and the unasserted link. Re-run: node capture/wallet-dashboard.mjs [nyc|large|main].',
  shots: {
    'viewport.png': { dpr: 2, kind: 'viewport', role: 'backdrop', wallet: WALLETS.nyc, describes: 'Top of the page at 1440x960: app bar, the identity row (nycgFa…NJR5Ux, 2,172 Hotspots, Live chip, Copy link, Solscan), the Summary money band (Wallet value $585.27 with its token split, Unclaimed 51.55 HNT, Earned 4.53 HNT on Oct 18 (UTC) over 7 day bars, Lifetime 2,554.78 HNT), the need-a-look line and the top of Earnings. (wallet nyc)' },
    'hero.png': { dpr: 2, kind: 'element', role: 'hero', wallet: WALLETS.nyc, describes: 'The Summary section at the 1440 layout (16 px margin): the identity row over the money band card (Wallet value $585.27: 62.87 HNT, 0.86 SOL, 45,936,375 DC and 183,115.55 legacy MOBILE in its split bar and legend; Unclaimed; Earned with its 7 day bars; Lifetime) and the fleet status line. The card crops the Wallet value column. (wallet nyc)' },
    'fleet-map.png': { dpr: 2, kind: 'element', role: 'supporting', wallet: WALLETS.large, describes: 'Map card at 1440 (Color by Network): the Great Lakes to East Coast band of a 1,659-Hotspot fleet as site groups, violet rings with Hotspot counts and amber need-a-look counts (Milwaukee, Chicago, Detroit, Cleveland, Buffalo, Rochester, Philadelphia, Baltimore and Washington), framed right of the legend; Carto Positron (light) or Dark Matter (dark). (wallet large)' },
    'mobile-activity.png': { dpr: 2, kind: 'element', role: 'supporting', wallet: WALLETS.large, describes: 'Earnings "HNT per day" card at a 480 layout: the readout for the latest UTC day (378.52 HNT, $152.02 at that day\'s price, 1.28 TB rewarded, 1,106 of 1,647 Mobile Hotspots rewarded) over the 7 violet day bars (Oct 12 to Oct 18, the max day and the latest labelled) and the 7-day total. (wallet large)' },
    'deployment-timeline.png': { dpr: 2, kind: 'element', role: 'supporting', wallet: WALLETS.large, describes: 'About section\'s "Onboarding over time" card at 1440: Hotspots by on-chain onboard month (UTC), Apr 2023 to Feb 2026, IoT green and Mobile violet, a 2025 build-out peak (332), the latest month read out (31 Mobile) and 1,656 of 1,659 Hotspots dated. (wallet large)' },
    'detail.png': { dpr: 3, kind: 'element', role: 'detail', wallet: WALLETS.large, describes: 'Macro at dpr 3, 480 layout: the Earnings readout and the 7 day bars with their axis. (wallet large)' },
    'hotspot-coverage.png': { dpr: 2, kind: 'element', role: 'supporting', wallet: WALLETS.main, describes: 'Map card at 1440 with Cheerful Carbon Armadillo (Lutz FL) opened by URL: its map panel on the right (Active, had traffic, 30-day messages, "Modeled coverage" on with its notes and credit) and the whole modeled footprint (12 res-8 cells) framed between the legend and the panel, around the Lutz site group. (wallet main)' },
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

// A view that fits [lat,lng] points into the canvas minus padding (at minZoom
// or more: then the points are centred in the padded area and may overflow it).
function fitView(points, w, h, pad = { l: 40, r: 40, t: 40, b: 40 }, maxZoom = 16, minZoom = 0) {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const [s, n, west, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const availW = w - pad.l - pad.r;
  const availH = h - pad.t - pad.b;
  const dx0 = wx(e, 0) - wx(west, 0) || 1e-6;
  const dy0 = wy(s, 0) - wy(n, 0) || 1e-6;
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.log2(availW / dx0), Math.log2(availH / dy0)));
  const cx = (wx(west, zoom) + wx(e, zoom)) / 2;
  const cy = (wy(n, zoom) + wy(s, zoom)) / 2;
  const tx = pad.l + availW / 2 - w / 2;
  const ty = pad.t + availH / 2 - h / 2;
  return { zoom, longitude: lngOf(cx - tx, zoom), latitude: latOf(cy - ty, zoom) };
}

function percentileBox(points, lo = 0.02, hi = 0.98) {
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  return [[q(lats, lo), q(lngs, lo)], [q(lats, hi), q(lngs, hi)]];
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

const hasMapApi = (page) => page.evaluate(() => Boolean(window.__wdMap));

// The camera: dev builds' window.__wdMap, else the controlled viewState prop
// read from deck canvas's React fiber.
async function getVS(page) {
  return page.evaluate(() => {
    if (window.__wdMap) return window.__wdMap.getView();
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

// Set the camera to `target` ({ longitude, latitude, zoom }). With
// window.__wdMap it is one instant move. Without it, drive deck's own
// controller (wheel zoom about a point, drag pan): wheel zoom anchors on the
// target (clamped into `safe`, fractions of the canvas) and drags start from
// `grab`, so neither lands on the map panel. Best effort: a drag that starts
// on an HTML site marker doesn't pan, and its click zooms to that site, so
// check the shot when capturing a build without window.__wdMap.
async function setView(page, target, { grab = [0.5, 0.5], safe = [0.03, 0.97, 0.05, 0.95] } = {}) {
  if (await hasMapApi(page)) {
    await page.evaluate((t) => window.__wdMap.setView(t, { duration: 0 }), { longitude: target.longitude, latitude: target.latitude, zoom: target.zoom });
    await sleep(400);
    log('view', JSON.stringify(await getVS(page)), 'target', JSON.stringify(target));
    return;
  }
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
  log('view', JSON.stringify(await getVS(page)), 'target', JSON.stringify(target));
}

// Poll until the page has settled: every Hotspot scan in (data-wd-settled),
// the data status chip "Live" (the Mobile check) or "All sources loaded", and
// no skeleton, busy card or "…" left in the sections the card crops. With
// `fullRewards` (the phase that shoots the Summary) the money band must also
// be whole: no Hotspot whose rewards couldn't be checked or confirmed, no
// lower-bound Lifetime (an oracle hiccup; the worker caches a batch about
// 15 minutes, so re-run later, or set ALLOW_PARTIAL=1 to shoot it anyway).
// Throws when the page never gets there, so a half-loaded page never becomes
// a source capture (the run exits 1 and writes no manifest).
const ALLOW_PARTIAL = process.env.ALLOW_PARTIAL === '1';
async function waitReady(page, { max = 300000, fullRewards = false } = {}) {
  const t0 = Date.now();
  let info;
  while (Date.now() - t0 < max) {
    info = await page.evaluate(() => {
      const root = document.querySelector('.wd-root');
      if (!root) return { why: 'no root' };
      const chip = document.querySelector('[data-wd-card="identity"] button[aria-haspopup="dialog"]')?.innerText.replace(/^Data status:\s*/, '').trim() ?? null;
      const sections = ['summary', 'earnings', 'map', 'about'].map((s) => root.querySelector(`[data-wd-section="${s}"]`)).filter(Boolean);
      return {
        settled: root.dataset.wdSettled,
        chip,
        skel: sections.reduce((n, s) => n + s.querySelectorAll('.wd-skel, .animate-pulse').length, 0),
        busy: sections.reduce((n, s) => n + s.querySelectorAll('[aria-busy="true"]').length + (s.getAttribute('aria-busy') === 'true' ? 1 : 0), 0),
        // "…" is a figure still checking (the address in the h1 is shortened with one too).
        ell: [...root.querySelectorAll('[data-wd-col], [data-wd-card="earnings-chart"]')].reduce((n, el) => n + (el.innerText.match(/…/g) || []).length, 0),
        // Money band columns with a partial rewards figure.
        partial: [...root.querySelectorAll('[data-wd-col]')].filter((el) => /couldn.t be (confirmed|checked)|lower bound/i.test(el.innerText)).length,
      };
    });
    const ok =
      info.settled === 'true' && /^(Live|All sources loaded)/.test(info.chip || '') && info.skel === 0 && info.busy === 0 && info.ell === 0 &&
      (!fullRewards || ALLOW_PARTIAL || info.partial === 0);
    if (ok) { log('ready after', Math.round((Date.now() - t0) / 1000), 's', JSON.stringify(info)); return true; }
    await sleep(3000);
  }
  throw new Error(`the page never settled in ${Math.round(max / 1000)} s: ${JSON.stringify(info)}`);
}

const card = (page, name) => page.locator(`[data-wd-card="${name}"]`).first();
// Element crop that never sits under the sticky app bar: scroll the element to
// just below it first (Playwright only scrolls when it's off-screen).
async function scrollUnderBar(loc) {
  await loc.evaluate((el) => {
    const bar = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    window.scrollBy(0, el.getBoundingClientRect().top - bar - 24);
  });
  await sleep(350);
}
async function shootEl(page, loc, file) {
  await scrollUnderBar(loc);
  await loc.screenshot({ path: file, ...SHOT });
}
// A clip around an element with a margin (keeps the card's shadow), scrolled clear of the bar.
async function shootPadded(page, loc, file, pad = 16) {
  await scrollUnderBar(loc);
  const b = await loc.boundingBox();
  const sy = await page.evaluate(() => scrollY);
  await page.screenshot({ path: file, fullPage: true, clip: { x: b.x - pad, y: b.y + sy - pad, width: b.width + pad * 2, height: b.height + pad * 2 }, ...SHOT });
}
// Park the mouse off the map and the charts, so no hover state shows.
async function mouseAway(page) {
  await page.mouse.move(2, 2);
  await sleep(200);
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

async function openWallet(newPage, key, query = '') {
  const page = await newPage({ colorScheme: 'light', ...DESK });
  const waitTiles = trackTiles(page);
  page.on('response', (r) => { if (r.status() === 429) log('[429]', r.url().slice(0, 120)); });
  const fleetResp = page.waitForResponse((r) => /\/wallet-dashboard\/fleet\?/.test(r.url()) && r.status() === 200, { timeout: 120000 });
  await page.goto(`${BASE}/wallet-dashboard/${WALLETS[key]}${query}`, { waitUntil: 'domcontentloaded' });
  const fleet = await (await fleetResp).json();
  const pts = fleet.hotspots.filter((h) => h.location).map((h) => ({ name: h.name, ll: h3.cellToLatLng(h.location), h }));
  return { page, waitTiles, fleet, pts };
}

// ---------- phases ----------
const PHASES = {
  // Viewport + hero: the Summary of 2,172 Mobile Hotspots in NYC, at 1440.
  async nyc({ newPage }) {
    const { page } = await openWallet(newPage, 'nyc');
    await waitReady(page, { fullRewards: true });
    const shots = async (theme) => {
      await mouseAway(page);
      await page.evaluate(() => scrollTo(0, 0));
      await sleep(400);
      await page.screenshot({ path: out(theme, 'viewport.png'), ...SHOT });
      await shootPadded(page, page.locator('[data-wd-section="summary"]'), out(theme, 'hero.png'));
      log(theme, 'viewport + hero');
    };
    await shots('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(800);
    await shots('dark');
  },

  // Card crops from the 1,659-Hotspot fleet. The map is framed on the Great
  // Lakes → East Coast band where most of it sits, inside the part of the map
  // right of the legend (FRAME, css px of the map area); the Earnings card is
  // shot at EARN_W.
  async large({ newPage }) {
    const { page, waitTiles, pts } = await openWallet(newPage, 'large');
    await waitReady(page);
    // Milwaukee and Chicago to Syracuse, Philadelphia and Washington.
    const east = pts.map((p) => p.ll).filter(([la, ln]) => la > 38.5 && la < 44.5 && ln > -88.5 && ln < -74.5);
    log('large points', pts.length, 'east band', east.length);
    const FRAME = { l: LEGEND_RIGHT + 14, r: 980 }; // the crop's x range in the map card

    const shots = async (theme) => {
      await page.setViewportSize(DESK);
      await sleep(800);
      await waitReady(page, { max: 90000 });
      const map = card(page, 'map');
      await scrollUnderBar(map);
      const r = await canvasRect(page);
      const target = fitView(percentileBox(east, 0.01, 0.99), r.width, r.height, { l: FRAME.l + 40, r: r.width - FRAME.r + 40, t: 50, b: 50 }, 16, SITE_ZOOM);
      await setView(page, target);
      await waitTiles();
      await mouseAway(page);
      await shootEl(page, map, out(theme, 'fleet-map.png'));
      log(theme, 'fleet-map');
      await shootEl(page, card(page, 'onboarding-timeline'), out(theme, 'deployment-timeline.png'));
      log(theme, 'deployment-timeline');

      await page.setViewportSize({ width: EARN_W, height: 900 });
      await sleep(1500);
      const earn = card(page, 'earnings-chart');
      await shootEl(page, earn, out(theme, 'mobile-activity.png'));
      log(theme, 'mobile-activity');
      // The readout, plot and axis (DayBars' root: the parent of its role=group plot).
      await shootHiDpi(page, earn.locator('[role="group"]').locator('xpath=..'), out(theme, 'detail.png'));
      log(theme, 'detail');
    };
    await shots('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(800);
    await shots('dark');
    await page.setViewportSize(DESK);
  },

  // A selected IoT Hotspot with its modeled coverage footprint, framed whole
  // beside the map panel. Opening the Hotspot by URL opens its detail
  // beside the list and selects it on the map, which flies to its site.
  async main({ newPage }) {
    const { page, waitTiles } = await openWallet(newPage, 'main', `?hotspot=${COVERAGE_ASSET}`);
    const covResp = page.waitForResponse((r) => r.url().includes('/iot/coverage') && r.status() === 200, { timeout: 240000 });
    await waitReady(page);
    const map = card(page, 'map');
    await scrollUnderBar(map);
    const panel = map.locator('[data-map-panel]');
    await panel.waitFor({ timeout: 30000 });
    await panel.getByRole('button', { name: 'Modeled coverage' }).click();
    const cov = await (await covResp).json();
    const drawn = cov.filter((c) => Number(c.rssi) >= -130);
    const ring = drawn.flatMap((c) => h3.cellToBoundary(c.hex));
    log('coverage cells', cov.length, 'drawn', drawn.length);
    await sleep(1500);
    for (let i = 0; i < 40; i++) {
      const t = await panel.innerText();
      const sk = await panel.locator('.wd-skel, .animate-pulse').count();
      if (!/Loading|…/.test(t) && sk === 0) break;
      await sleep(1000);
    }
    // The open space between the legend (top left) and the panel (right of
    // the map on a wide card, else left), in css px of the canvas.
    const frame = async () => {
      const r = await canvasRect(page);
      const pb = await panel.boundingBox();
      const panelRight = pb.x + pb.width / 2 > r.x + r.width / 2;
      const gap = 56;
      const lo = panelRight ? LEGEND_RIGHT + gap : pb.x + pb.width - r.x + gap;
      const hi = panelRight ? pb.x - r.x - gap : r.width - gap;
      if (hi - lo < 120) throw new Error(`no room to frame the footprint (${Math.round(lo)} to ${Math.round(hi)} of ${Math.round(r.width)})`);
      const view = fitView(ring, r.width, r.height, { l: lo, r: r.width - hi, t: 64, b: 64 }, 14);
      log('frame', Math.round(lo), 'to', Math.round(hi), 'fit', JSON.stringify(view));
      // Without __wdMap: grab and wheel inside that space so drags never land on the panel.
      const mid = (lo + hi) / 2 / r.width;
      await setView(page, view, { grab: [mid, 0.5], safe: [lo / r.width, hi / r.width, 0.08, 0.92] });
      await waitTiles();
      await mouseAway(page);
    };
    const shots = async (theme) => {
      await scrollUnderBar(map);
      await frame();
      await shootEl(page, map, out(theme, 'hotspot-coverage.png'));
      log(theme, 'hotspot-coverage');
    };
    await shots('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(800);
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
