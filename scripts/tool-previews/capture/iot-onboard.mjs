// IoT Hotspot Setup (/iot-onboard) — source captures for the landing-page preview art.
//
//   node capture/iot-onboard.mjs            (from scripts/tool-previews; frontend on BASE)
//   node capture/iot-onboard.mjs sources    (only the source pass)
//   node capture/iot-onboard.mjs macros     (only the card's macros)
//
// Writes captures/iot-onboard/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses identity-macro.png and
// wifi-macro.png (previews/iot-onboard.js); mode-macro.png is shot but unused.
//
// Headless Chrome has no Web Bluetooth, so navigator.bluetooth is MOCKED
// (iot-onboard.ble-mock.mjs): "Pair Hotspot" resolves a fake gateway-config Hotspot whose
// GATT characteristics return protobuf/ASCII values in the formats the page decodes. The
// worker's POST /iot-onboard/lookup is fulfilled locally with a plausible
// "issued, not yet onboarded" status (the fake Hotspot doesn't exist on chain), using
// the real on-chain fees read once from GET /iot-onboard/fees. The `single` showcase
// wallet is fake-connected read-only so the onboarding step renders its connected
// state. Interactions: Pair Hotspot (mock), WiFi Scan (mock read), picking an
// available-network chip, picking the "Full Onboard (PoC)" mode card, typing a
// location, and zooming the map. It never clicks Connect, Identify, Issue, or
// "Onboard & Assert Location" (the BLE mock also refuses ADD_GATEWAY, and signing is
// disabled). Light and dark come from the same load via emulateMedia.
//
// Crops are taken from inside the live viewport (scroll, then clip) rather than from a
// captureBeyondViewport full-page raster.
//
// Macros: from one more page state (paired, scanned, Rooftop-Mesh-5G picked, Full
// Onboard (PoC) selected; no location typed), light then dark, at dpr 3:
//   identity-macro.png  the paired Hotspot's identity bar (Bluetooth icon, animal
//                       name, Disconnect)
//   wifi-macro.png      the WiFi card (current/saved network, the eight scanned
//                       network chips with Rooftop-Mesh-5G selected, SSID form)
//   mode-macro.png      the Onboarding Mode block (Full Onboard (PoC) selected vs
//                       Data-Only, with the on-chain DC fees)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS, mergeManifest } from '../lib.mjs';
import { bleMockScript } from './iot-onboard.ble-mock.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/iot-onboard/', import.meta.url));
const PHASE = process.argv[2]; // 'sources' | 'macros' | undefined (both)
if (PHASE && !['sources', 'macros'].includes(PHASE)) throw new Error(`unknown phase ${PHASE}: use sources or macros`);
const ROUTE = '/iot-onboard';
const WALLET = WALLETS.single;
const THEMES = ['light', 'dark'];
const P = (theme, f) => path.join(OUT, theme, f);
const VIEW = { width: 1440, height: 960 };

// manifest.json meta; each shot's entry is recorded as it is taken.
const META = {
  slug: "iot-onboard",
  route: "/iot-onboard",
  wallet: "79EgtsdW9mPgqWMZZqyNffDkhv1d9VHFGDaXDm4muU6n (single; fake read-only connect, only so the onboarding step renders its connected state)",
  notes: "Web Bluetooth is MOCKED (capture/iot-onboard.ble-mock.mjs): navigator.bluetooth.requestDevice() returns a fake gateway-config Hotspot (GATT service 0fda92b2-...) serving ASCII pubkey/onboarding key/ethernet/SSID and protobuf diagnostics_v1 + wifi_services_v1 values. The keys are freshly generated checksum-valid Helium ecc_compact addresses that belong to no real Hotspot (animal name Electric Pewter Perch). The mock reports one saved WiFi network (the current one), so the Diagnostics and WiFi cards end level with no blank space. POST /iot-onboard/lookup is fulfilled locally (maker RAKwireless with insufficient DC, issued=true, onboarded=false) because the fake Hotspot is not on chain. Fees are the real values from GET /iot-onboard/fees: full 1,000,000+100,000 DC, data-only 50,000+50,000 DC. Location: the centre of H3 res-12 cell 8c3944603ad09ff (41.390695, 2.161161) in Barcelona Eixample. The cell sits in the chamfered west corner of the block east of the octagonal Carrer de València × Carrer de Balmes intersection (OSM node 41.3907357, 2.1607406). The map is zoomed to z17 for full/assert-location and z17.6 for detail, through the map's own easeTo, the same path a wheel zoom takes. Interactions: Pair Hotspot (mock), WiFi Scan (mock read), select the Rooftop-Mesh-5G chip, select the Full Onboard (PoC) card, type lat/lng and elevation 12. Never clicked Connect, Identify, Issue or Onboard. The BLE mock refuses ADD_GATEWAY and wallet signing is disabled. The open-elevation autofill call is aborted, so the elevation is typed instead. Crop hygiene: hero/diagnostics/wifi-networks hide the page intro and every non-subject card with visibility:hidden, so no sibling edge bleeds into the padding (edge strips verified as pure background). viewport.png is scrolled 13px so the fold falls 5px below the Diagnostics/WiFi cards, in the gap above the On-Chain Onboarding panel, and the header logo stays whole. assert-location.png collapses maker/status/mode with the hidden attribute (Tailwind space-y skips it), so the banner sits 16px under the header divider. onboarding-mode.png lifts the location step out of the flow, and gives the selected card its own compositor layer at the same 1.02 scale: painted in place, its translucent tint rasterized with a 1/255 blocky rounding pattern (the earlier ghost). The tint is now verified flat. Dropped: pair-card.png (the pre-pairing CTA start state does not satisfy the no-empty-states rule). Art-direction note: the strongest, most tool-unique content is the identity bar (Bluetooth signal icon + animal name), the Available Networks chip cluster with the teal-selected SSID, and the Connect button. The WiFi password field shows its placeholder (no password typed). The H3 hex map also appears in Update Hotspot Location and Mobile WiFi Onboarding, so keep it secondary for this tool.",
};

// Barcelona's Eixample: Cerdà's chamfered (octagonal) intersections read well around the
// H3 cell. Carrer de València × Carrer de Balmes, OSM intersection node:
const ISECT = { lat: 41.3907357, lng: 2.1607406 };
// Centre of H3 res-12 cell 8c3944603ad09ff (35 m E / 4.5 m S of the intersection): the
// cell sits snug in the chamfered west corner of the block east of the intersection, so
// the pin + hex have the chamfer face, València and Balmes on three sides.
const LAT = '41.390695';
const LNG = '2.161161';
const ELEVATION = '12';
const PICK_SSID = 'Rooftop-Mesh-5G';
const MAIN_ZOOM = 17;     // location map in full/assert-location
const DETAIL_ZOOM = 17.6; // macro crop (dpr 3)
const DETAIL_W = 440;     // detail.png width, CSS px
const DETAIL_SHIFT = 0.5; // detail.png centre: this far from the pin toward the intersection

const FALLBACK_FEES = { full: { base: 1000000, location: 100000 }, data_only: { base: 50000, location: 50000 }, stale: false };
async function realFees() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + '/api/iot-onboard/fees');
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 40000)); continue; }
      const j = await r.json();
      if (j?.full?.base) return { full: j.full, data_only: j.data_only, stale: !!j.stale };
    } catch {}
  }
  return FALLBACK_FEES;
}

async function box(h) {
  return h.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}
function frame(boxes, padX, padTop, padBottom = padTop) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: Math.round(x0 - padX), y: Math.round(y0 - padTop), width: Math.round(x1 - x0 + 2 * padX), height: Math.round(y1 - y0 + padTop + padBottom) };
}

const rafs = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Screenshot a page-coordinate rect from inside the live viewport: scroll it into view
// (centred), let two frames render, then clip in viewport coordinates.
async function shootClip(page, rect, out, sleep) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const vh = page.viewportSize().height;
  if (rect.height > vh) throw new Error(`rect taller than viewport: ${rect.height}`);
  const want = Math.max(0, Math.round(rect.y - (vh - rect.height) / 2));
  await page.evaluate((y) => window.scrollTo(0, y), want);
  await rafs(page);
  await sleep(250);
  const sy = await page.evaluate(() => window.scrollY);
  const y = rect.y - sy;
  if (y < 0 || y + rect.height > vh) throw new Error(`rect not inside viewport after scroll (y=${y})`);
  await page.screenshot({ path: out, clip: { x: rect.x, y, width: rect.width, height: rect.height }, animations: 'disabled', caret: 'hide', timeout: 30000 });
}

// Hide (visibility only, no layout shift) or restore elements.
async function setVisible(handles, on) {
  for (const h of handles) await h.evaluate((el, on) => { el.style.visibility = on ? '' : 'hidden'; }, on);
}
// Lift an element out of the flow (absolute, hidden, off-screen, same width) while it
// stays rendered. Returns a restore function.
async function liftOut(h) {
  await h.evaluate((el) => {
    const w = el.getBoundingClientRect().width;
    el.dataset.prevStyle = el.getAttribute('style') || '';
    Object.assign(el.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: `${w}px`, left: '-20000px', top: '0' });
  });
  return async () => h.evaluate((el) => { el.setAttribute('style', el.dataset.prevStyle); delete el.dataset.prevStyle; });
}
// Take elements out of the layout with the `hidden` attribute, which Tailwind's space-y
// selector (`> :not([hidden]) ~ :not([hidden])`) skips — so the first remaining sibling
// gets no stray margin-top. Returns a restore function.
async function collapse(handles) {
  for (const h of handles) await h.evaluate((el) => { el.hidden = true; el.style.display = 'none'; });
  return async () => { for (const h of handles) await h.evaluate((el) => { el.hidden = false; el.style.display = ''; }); };
}

// Local mock of POST /iot-onboard/lookup (the fake Hotspot is not on chain), with the
// real fees; nothing reaches the worker's lookup.
async function setup(page, fees) {
  await page.route('**/api/iot-onboard/lookup', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      maker: { name: 'RAKwireless', address: null, dc_balance: 284150, dc_sufficient: false },
      onchain: { issued: true, onboarded: false, has_location: false },
      suggested_mode: 'data_only',
      fees,
    }),
  }));
  // Ground-elevation autofill is a best-effort third-party call; the elevation is typed instead.
  await page.route('**/api.open-elevation.com/**', (route) => route.abort());
}

async function loadStart(page) {
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Pair Hotspot' }).waitFor({ timeout: 30000 });
}

async function waitMapIdle(page, sleep, ms = 2500) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
  await sleep(ms);
}

// The location map's own maplibre instance, via react-map-gl's MapContext (found by
// walking the React fiber under the map container). Zooming it is the same thing a
// scroll-wheel zoom does; the page's onMove/onMoveEnd handlers stay in charge.
async function zoomMap(page, zoom) {
  return page.evaluate((zoom) => {
    let el = document.querySelector('.maplibregl-map');
    const fiberKey = (n) => n && Object.keys(n).find((k) => k.startsWith('__reactFiber$'));
    while (el && !fiberKey(el)) el = el.parentElement;
    if (!el) return null;
    const root = el[fiberKey(el)];
    const stack = [root];
    let map = null;
    while (stack.length && !map) {
      const n = stack.pop();
      if (!n) continue;
      const v = n.memoizedProps && n.memoizedProps.value;
      if (v && v.map && typeof v.map.getMap === 'function') map = v.map.getMap();
      if (n.child) stack.push(n.child);
      if (n.sibling && n !== root) stack.push(n.sibling);
    }
    if (!map) return null;
    // An animated zoom: under react-map-gl's controlled viewState a jumpTo is reverted to
    // props, while an easeTo goes through onMove like a wheel zoom does.
    map.easeTo({ zoom, duration: 300 });
    return new Promise((res) => setTimeout(() => {
      const c = map.getCenter();
      res({ zoom: map.getZoom(), lat: c.lat, lng: c.lng });
    }, 1500));
  }, zoom);
}

async function populate(page, sleep, zoom) {
  await page.getByRole('button', { name: 'Pair Hotspot' }).click();
  await page.getByRole('heading', { name: 'Diagnostics' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByText('Available Networks').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: PICK_SSID, exact: true }).click();
  await page.getByText('Step 3: Assert Location').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Full Onboard/ }).click();
  const lat = page.locator('input[placeholder="e.g. 37.7749"]');
  const lng = page.locator('input[placeholder="e.g. -122.4194"]');
  await lat.fill(LAT);
  await lng.fill(LNG);
  await lng.blur();
  await page.locator('input[placeholder="above ground level"]').fill(ELEVATION);
  await page.locator('input[placeholder="above ground level"]').blur();
  await page.locator('.maplibregl-map').first().scrollIntoViewIfNeeded();
  await waitMapIdle(page, sleep, 1500);
  // Zoom the location map in so the asserted H3 cell and the street geometry read at a glance.
  let z = await zoomMap(page, zoom);
  if (!z) {
    // Fallback: keyboard zoom (integer steps from the page's initial z16).
    await page.locator('.maplibregl-canvas').first().focus();
    for (let i = 0; i < Math.round(zoom - 16); i++) { await page.keyboard.press('Equal'); await sleep(900); }
    z = { zoom: 16 + Math.round(zoom - 16), fallback: true };
  }
  console.log('map', JSON.stringify(z));
  await page.mouse.move(5, 5);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await waitMapIdle(page, sleep, 2500);
  const ll = [await lat.inputValue(), await lng.inputValue()];
  if (ll[0] !== LAT || ll[1] !== LNG) console.log('WARNING lat/lng drifted to', ll);
  return z;
}

// Web Mercator (512 px tiles) pixel position, for placing the macro crop around the intersection.
function mercPx(lat, lng, z) {
  const W = 512 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * W, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W };
}

async function sources({ newPage, shoot, sleep }, fees) {
  const shots = [];
  const record = (theme, file, kind, describes, rect, role, dpr = 2) => {
    shots.push({ file: `${theme}/${file}`, theme, kind, describes, cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height), dpr, role });
  };
  for (const theme of THEMES) fs.mkdirSync(path.join(OUT, theme), { recursive: true });

  {
    const page = await newPage({ colorScheme: 'light', wallet: WALLET, initScript: bleMockScript(), ...VIEW, dpr: 2 });
    await setup(page, fees);
    await loadStart(page);
    await sleep(1500);
    await populate(page, sleep, MAIN_ZOOM);

    const L = (re) => page.locator('main div.rounded-xl').filter({ has: page.getByRole('heading', { name: re }) }).first();
    const identity = page.locator('main div.rounded-xl').filter({ hasText: 'Disconnect' }).first();
    const onboard = L('On-Chain Onboarding');
    const handles = {
      intro: await page.locator('main > div.mb-10').first().elementHandle(),
      identity: await identity.elementHandle(),
      diag: await L('Diagnostics').elementHandle(),
      wifi: await page.locator('main div.rounded-xl').filter({ has: page.getByRole('heading', { name: 'WiFi', exact: true }) }).first().elementHandle(),
      onboard: await onboard.elementHandle(),
      maker: await onboard.locator('div.rounded-lg.bg-surface-inset').filter({ hasText: 'Maker Info' }).first().elementHandle(),
      status: await onboard.locator('div.rounded-lg.bg-surface-inset').filter({ hasText: 'On-Chain Status' }).first().elementHandle(),
      mode: await onboard.getByText('Onboarding Mode', { exact: true }).locator('..').elementHandle(),
      step: await onboard.getByText('Step 3: Assert Location & Onboard').locator('..').elementHandle(),
    };
    const B = {};
    for (const [k, h] of Object.entries(handles)) B[k] = await box(h);

    // Viewport fold: land it in the gap under the Diagnostics/WiFi cards while keeping the
    // header logo (top at 20px) whole.
    const cardsBottom = Math.max(B.diag.y + B.diag.height, B.wifi.y + B.wifi.height);
    const viewportY = Math.min(Math.max(0, Math.round(cardsBottom + 5 - VIEW.height)), 13);
    console.log('cardsBottom', cardsBottom, 'onboardTop', B.onboard.y, 'viewportY', viewportY, 'fold', viewportY + VIEW.height);

    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await waitMapIdle(page, sleep, theme === 'dark' ? 4000 : 1500); // map basemap swaps style on scheme change
      {
        await page.evaluate((y) => window.scrollTo(0, y), viewportY);
        await rafs(page); await sleep(400);
        await shoot(page, 'viewport', P(theme, 'viewport.png'));
        record(theme, 'viewport.png', 'viewport', `1440x960 viewport (scrolled ${viewportY}px) of the paired, populated tool: site header, page title, Hotspot identity bar, Diagnostics and WiFi panels, fold in the gap above the On-Chain Onboarding panel`, VIEW, 'backdrop');
      }
      {
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(300);
        await shoot(page, 'full', P(theme, 'full.png'));
        const fh = await page.evaluate(() => document.documentElement.scrollHeight);
        record(theme, 'full.png', 'full-page', 'Entire page: identity bar, Diagnostics + WiFi panels, and the On-Chain Onboarding panel (maker info, on-chain status, Full/Data-Only mode cards, location step with the CARTO map + H3 hex at an Eixample corner, fields, cost, CTA)', { width: VIEW.width, height: fh }, 'backdrop');
      }

      await setVisible([handles.intro], false);
      // Hero: the connected Hotspot (identity bar) with its live Diagnostics + WiFi panels.
      {
        await setVisible([handles.onboard], false);
        const r = frame([B.identity, B.diag, B.wifi], 64, 44, 36);
        await shootClip(page, r, P(theme, 'hero.png'), sleep);
        record(theme, 'hero.png', 'element-group', 'Connected Hotspot view: identity bar (Bluetooth signal icon, animal name Electric Pewter Perch, Disconnect) above the side-by-side Diagnostics panel (public/onboarding keys, ethernet, firmware, MACs, IP, connectivity) and WiFi panel (current connection, saved network, eight available-network chips with Rooftop-Mesh-5G selected, SSID/password form, Connect button)', r, 'hero');
        await setVisible([handles.onboard], true);
      }
      // Single-card crops: every other card hidden so no sibling edge bleeds into the padding.
      {
        await setVisible([handles.identity, handles.onboard], false);
        {
          await setVisible([handles.wifi], false);
          const r = frame([B.diag], 28, 24);
          await shootClip(page, r, P(theme, 'diagnostics.png'), sleep);
          record(theme, 'diagnostics.png', 'element', 'Diagnostics card read over Bluetooth: public key, onboarding key (with copy buttons), Ethernet Connected, fw 2023.04.18.0, eth/wifi MACs, IP, connected/dialable/nat_type rows, Identify + Refresh buttons', r, 'supporting');
          await setVisible([handles.wifi], true);
        }
        {
          await setVisible([handles.diag], false);
          const r = frame([B.wifi], 28, 24);
          await shootClip(page, r, P(theme, 'wifi-networks.png'), sleep);
          record(theme, 'wifi-networks.png', 'element', 'WiFi card: current connection Rooftop-Mesh, one saved network, eight available-network chips (Rooftop-Mesh-5G selected in the accent colour), SSID + password form and Connect button', r, 'supporting');
          await setVisible([handles.diag], true);
        }
        await setVisible([handles.identity, handles.onboard], true);
      }

      await setVisible([handles.identity, handles.diag, handles.wifi], false);
      // Maker + on-chain status + the full/data-only mode cards, location step collapsed.
      {
        // The step (with the WebGL map) is lifted out of the flow but kept alive and hidden,
        // rather than display:none'd: freeing the map's GPU surfaces is what left a faint
        // ghost of map tiles inside the translucent, transformed selected card.
        const restore = await liftOut(handles.step);
        // Painted in place, the selected card's 2D scale-[1.02] over its translucent accent
        // tint rasterizes with a 1/255 rounding pattern (a faint blocky "ghost" visible under
        // a contrast boost). Giving it its own compositor layer at the same scale renders the
        // tint perfectly flat; nothing about its size, position or colour changes.
        const modeBtns = await handles.mode.$$('button');
        for (const b of modeBtns) await b.evaluate((el) => { if (/scale-/.test(el.className)) el.style.willChange = 'transform'; });
        await rafs(page);
        await sleep(400);
        const r = frame([await box(handles.onboard)], 40, 32);
        await shootClip(page, r, P(theme, 'onboarding-mode.png'), sleep);
        record(theme, 'onboarding-mode.png', 'element', 'On-Chain Onboarding card top (location step collapsed out): maker info (RAKwireless, insufficient DC), on-chain status (Issued Yes), and the Full Onboard (PoC) vs Data-Only mode cards with Full selected and the real on-chain DC fees', r, 'supporting');
        await restore();
        for (const b of modeBtns) await b.evaluate((el) => { el.style.willChange = ''; });
        await waitMapIdle(page, sleep, 1500);
      }
      // Location step as a self-contained card: maker/status/mode collapsed out of the panel.
      {
        const restore = await collapse([handles.maker, handles.status, handles.mode]);
        await rafs(page);
        await waitMapIdle(page, sleep, 1500);
        const r = frame([await box(handles.onboard)], 40, 32);
        await shootClip(page, r, P(theme, 'assert-location.png'), sleep);
        record(theme, 'assert-location.png', 'element', 'On-Chain Onboarding card at the location step (maker/status/mode collapsed out): issued-on-chain banner, CARTO map of Barcelona\'s Eixample with the purple H3 res-12 hex + pin in the chamfered corner beside the octagonal Carrer de València × Carrer de Balmes intersection, lat/lng/elevation/gain fields, onboarding cost, Onboard & Assert Location button', r, 'supporting');
        await restore();
        await waitMapIdle(page, sleep, 1000);
      }
      await setVisible([handles.identity, handles.diag, handles.wifi, handles.intro], true);
    }
    await page.context().close();
  }

  // ---- Detail at dpr 3: map macro around the pin, the asserted hex and the octagonal intersection.
  {
    const page3 = await newPage({ colorScheme: 'light', wallet: WALLET, initScript: bleMockScript(), ...VIEW, dpr: 3 });
    await setup(page3, fees);
    await loadStart(page3);
    await sleep(1000);
    const z = await populate(page3, sleep, DETAIL_ZOOM);
    const mapH = await page3.locator('main div.relative.h-56').first().elementHandle();
    // Hide the "use my location" button so the macro is pure map.
    await page3.locator('button[aria-label="Use my location"]').evaluate((el) => { el.style.visibility = 'hidden'; });
    const bM = await box(mapH);
    const zz = z.zoom;
    const c = mercPx(Number(LAT), Number(LNG), zz), i = mercPx(ISECT.lat, ISECT.lng, zz);
    const dx = i.x - c.x;
    const cx = bM.x + bM.width / 2 + dx * DETAIL_SHIFT;
    const rect = { x: Math.round(cx - DETAIL_W / 2), y: Math.round(bM.y) + 2, width: DETAIL_W, height: Math.round(bM.height) - 4 };
    for (const theme of THEMES) {
      await page3.emulateMedia({ colorScheme: theme });
      await waitMapIdle(page3, sleep, theme === 'dark' ? 4000 : 1500);
      await shootClip(page3, rect, P(theme, 'detail.png'), sleep);
      record(theme, 'detail.png', 'macro', 'Macro (dpr 3) of the location map: purple H3 res-12 hex + pin tucked into a chamfered Eixample block corner, beside the octagonal Carrer de València × Carrer de Balmes intersection (street geometry on three sides of the hex)', rect, 'detail', 3);
    }
    await page3.context().close();
  }

  // Theme-major order: all light shots, then all dark.
  shots.sort((a, b) => (a.theme === b.theme ? 0 : a.theme === 'light' ? -1 : 1));
  mergeManifest(OUT, shots, { meta: META });
}

// ---- Macros the landing card uses (dpr 3), from one page state.
const MACRO_DPR = 3;
const MACRO_PAD = 16; // page background kept around each element, CSS px
const mpad = (b, p = MACRO_PAD) => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
const snap = (r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });

async function macros({ newPage, settle, sleep, shootRect }, fees) {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: MACRO_DPR, wallet: WALLET, initScript: bleMockScript() });
  await setup(page, fees);

  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Pair Hotspot' }).click({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Diagnostics' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByText('Available Networks').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: PICK_SSID, exact: true }).click();
  await page.getByText('Step 3: Assert Location').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Full Onboard/ }).click();
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.activeElement?.blur()); // no hover, caret or focus ring in the shots
  await settle(page, 1500);

  const identity = page.locator('main div.rounded-xl').filter({ hasText: 'Disconnect' }).first();
  const wifi = page.locator('main div.rounded-xl').filter({ has: page.getByRole('heading', { name: 'WiFi', exact: true }) }).first();
  const mode = page.getByText('Onboarding Mode', { exact: true }).locator('..');
  // The selected mode card is scaled 1.02 over a translucent tint; its own compositor
  // layer renders that tint flat (painted in place it rounds into a faint block pattern).
  await mode.evaluate((el) => el.querySelectorAll('button').forEach((b) => { if (/scale-/.test(b.className)) b.style.willChange = 'transform'; }));

  const abs = async (loc) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const sy = await page.evaluate(() => window.scrollY);
    return { ...b, y: b.y + sy }; // boundingBox is viewport-relative; shootRect clips the full page
  };
  const rects = {
    'identity-macro.png': snap(mpad(await abs(identity))),
    'wifi-macro.png': snap(mpad(await abs(wifi))),
    'mode-macro.png': snap(mpad(await abs(mode))),
  };
  const describes = {
    'identity-macro.png': `Macro (dpr ${MACRO_DPR}) of the paired Hotspot's identity bar: Bluetooth signal icon, animal name Electric Pewter Perch, device name Helium Hotspot 3C72, Disconnect button.`,
    'wifi-macro.png': `Macro (dpr ${MACRO_DPR}) of the WiFi card: current connection Rooftop-Mesh, one saved network, eight scanned network chips with Rooftop-Mesh-5G selected in the accent colour, SSID + password form and Connect button.`,
    'mode-macro.png': `Macro (dpr ${MACRO_DPR}) of the Onboarding Mode block: Full Onboard (PoC) selected vs Data-Only, with the real on-chain fees (~0.004 SOL + 1,100,000 DC ($11.00) / + 100,000 DC ($1.00)).`,
  };

  const shots = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(900);
    for (const [file, r] of Object.entries(rects)) {
      await shootRect(page, r, P(theme, file));
      shots.push({ file: `${theme}/${file}`, theme, kind: 'macro', describes: describes[file], cssWidth: r.width, cssHeight: r.height, dpr: MACRO_DPR, role: 'detail' });
      console.log('wrote', `${theme}/${file}`, `${r.width}x${r.height} css`);
    }
  }
  mergeManifest(OUT, shots, { seed: { slug: META.slug, route: META.route, wallet: META.wallet } });
}

await run(async (h) => {
  const fees = await realFees();
  console.log('fees', JSON.stringify(fees));
  if (PHASE !== 'macros') await sources(h, fees);
  if (PHASE !== 'sources') await macros(h, fees);
}, { timeoutMs: 420000 + 240000 });
