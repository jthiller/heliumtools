// Mobile WiFi Onboarding (/mobile-onboard) — source captures for the landing-page preview art.
//
//   node capture/mobile-onboard.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/mobile-onboard/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses network-list.png and
// radsec-passpoint.png (previews/mobile-onboard.js).
//
// Read-only. Fake-connects the `nyc` showcase wallet (2,172 converted WiFi /
// wifiDataOnly Hotspots in New York) as a read-only Phantom. The `main` wallet's
// Mobile Hotspots are all greenfield Helium Indoor/Outdoor, which this tool mutes
// ("No retrievable certificates"), so it can't show the tool's actual subject.
//
// Never clicks Register on-chain / Onboard to the Mobile network / Retrieve
// certificates / Generate agent link / the Update-location submit. Signing is
// disabled by the fake wallet anyway, and lib.mjs's side-effect guard aborts any
// sendTransaction RPC. (The guard does not match this tool's /issue, /onboard,
// /update, /cert or /agent-brief paths, so never clicking them is what keeps
// the run read-only.)
//
// Everything Token-step related (hero, name-grinder, detail) and the Location
// step come from ONE grind in ONE page session, so the match chips, the selected
// name, the 'Use "<name>"' CTA and the Location step's "Where is <name>?" agree.
// detail.png is shot at dpr 3 in that same session by switching the device scale
// factor over CDP (Emulation.setDeviceMetricsOverride) and capturing with
// Page.captureScreenshot, then switching back to dpr 2.
//
// The wizard's Location step sits behind the on-chain registration. To depict it,
// the freshly ground (never registered) key is committed in the Token step (pure
// client-side: builds the token and saves a local draft); resuming that draft calls
// POST /status, which this page MOCKS locally as "issued + indexed, not onboarded".
// Everything rendered is the tool's real UI; the address geocode is a real
// (browser-direct, single) Nominatim lookup.
import { run, BASE, WALLETS, writeManifest } from '../lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// h3-js from the repo's frontend deps (same version the page uses).
const h3 = createRequire(path.join(HERE, '..', '..', '..', 'pages', 'public', 'package.json'))('h3-js');

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(HERE, '..', 'captures', 'mobile-onboard');
const WALLET = WALLETS.nyc;
// Flatiron Building: at z17 the frame shows the triangle, 5th Ave / Broadway /
// E 23rd St and the corner of Madison Square Park instead of a single grey slab.
const ADDRESS = '175 5th Ave, New York, NY 10010';
const GRIND_COLOR = 'purple';
const PICK_INDEX = 2; // which match chip to select (0-based)
const VENDOR = 'meraki-plus';
const HERO_MAIN_W = 900; // main max-width for the hero / location-step framings
const P = (theme, f) => path.join(OUT, theme, f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "mobile-onboard",
  route: "/mobile-onboard",
  wallet: "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux",
  notes: "Fake-connected the nyc showcase wallet (2,172 converted WiFi / wifiDataOnly Hotspots in New York) instead of main: all 8 of main's Mobile Hotspots are greenfield Helium Indoor/Outdoor, which this tool sorts last and renders muted ('No retrievable certificates'), so it cannot show the tool's subject. HERO is now the Token step (the only fragment unique to this tool: 6-step rail, ground Hotspot name, X Purple Y match chips), not the Location map, which looked like Update Hotspot Location. hero, name-grinder, detail, location-step and viewport all come from ONE grind in ONE page session, so the chips, selected name, Use CTA and 'Where is <name>?' agree (names are random per run; this run: Raspy Purple Ferret). detail.png is dpr 3 from that same session (Emulation.setDeviceMetricsOverride + Page.captureScreenshot over CDP). The grind was repeated (client-side, 1 in 256 keys) until the 12 chips wrap into three even rows at natural width. The Location step sits behind on-chain registration: the freshly ground, never-registered key was committed in the Token step (client-side only, saves a local draft) and the draft resumed with POST /status MOCKED locally as issued+indexed/not onboarded; every pixel is the real UI, fees are the live /fees schedule, and the address was geocoded by a real browser-direct Nominatim lookup (175 5th Ave = Flatiron Building), then keyboard-zoomed one level out (z18 -> z17) so streets, labels and Madison Square Park frame the hex. Manage detail: map keyboard-zoomed z16 -> z17 and the location typed into the neighbouring H3 cell's center (north) so the Cost row shows the real re-assert price (0 DC, free for wifiDataOnly) instead of a dash; the muddy plaza label is no longer in frame. The Phantom wallet-adapter button is hidden (visibility) on the Manage list shots. hero.png and location-step.png relax main max-width to 900px; nothing else is hidden or added. Minor: map labels at the canvas edges are partially clipped (normal MapLibre behaviour). Nothing was signed, registered, onboarded, or requested from the cert/agent-brief services. Light and dark come from one load per page via emulateMedia (maps restyle live).",
  shots: {
    "hero.png": { dpr: 2, kind: "crop", role: "hero", describes: "Onboarding wizard at the Token step under the tool's own title (WiFi icon, 'Mobile WiFi Onboarding', one-line description) and the Onboard/Manage/AP Setup Guide tab strip: 6-step rail (Token active, Register, Location, Certificates, AP setup, Configure), 'Selected Hotspot name' block (Raspy Purple Ferret + mono Helium address), adjective/purple/animal grind inputs with Grind and Reroll, the 12 'X Purple Y' match chips with Raspy Purple Ferret selected, and the 'Use \"Raspy Purple Ferret\"' CTA. main max-width relaxed to 900px so the frame lands at ~4:3; nothing hidden." },
    "name-grinder.png": { dpr: 2, kind: "crop", role: "supporting", describes: "The same Token-step card on its own at the page's natural width (no title/tabs): step rail, selected name + address, grind row, 12 match chips in three even rows with Raspy Purple Ferret selected, and the Use CTA. Same grind as hero/detail." },
    "detail.png": { dpr: 3, kind: "crop", role: "detail", describes: "Macro at dpr 3 of the 'Matches · pick one to use' chip cluster (12 X Purple Y names, Raspy Purple Ferret selected) and the 'Use \"Raspy Purple Ferret\"' CTA. Same page session and grind as name-grinder.png and hero.png (DPR switched over CDP), so chips and CTA match exactly." },
    "location-step.png": { dpr: 2, kind: "crop", role: "supporting", describes: "Wizard at the Location step for the same Hotspot ('Where is Raspy Purple Ferret?' lead line kept): street address 175 5th Ave geocoded (Found: Flatiron Building ...), CARTO map at z17 showing the Flatiron triangle, 5th Avenue / Broadway / E 23rd St / W 22nd St labels and the corner of Madison Square Park with the purple H3 res-12 hex + pin, lat/lng inputs, fee card (200,000 DC = $2.00 + network fee) and the 'Onboard to the Mobile network' CTA. main widened to 900px; nothing collapsed." },
    "network-list.png": { dpr: 2, kind: "crop", role: "supporting", describes: "Manage tab list: '2172 converted WiFi networks' count, search box and 7 Hotspot rows (animal names, 'Converted WiFi' pills, New York map-pin locations), third row hovered. The third-party connected-wallet button is hidden (visibility) so no foreign brand mark sits in the frame." },
    "manage-detail.png": { dpr: 2, kind: "crop", role: "supporting", describes: "Manage detail for one converted WiFi network (Shallow Coffee Sloth): header card (entity key, Type Converted WiFi, Location asserts 2, View on map), RadSec certificates card, and the Location editor with a z17 map at Broadway / Columbus Ave / W 66th St (Lincoln Center), the hex + pin centered in the neighbouring cell, lat/lng inputs, Cost 0 DC ($0.00) + network fee, Cancel / Update location." },
    "radsec-passpoint.png": { dpr: 2, kind: "crop", role: "supporting", describes: "AP Setup Guide tab: RadSec server list (3 IP:port rows + shared secret) and Passpoint realms/domains per carrier (Helium Mobile / Noble Mobile, WeFi, Google Fi) with EAP-TLS Certificate pills and copy buttons." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Whole page at 1440x960, scrolled 98px so the site header is off and the full Location-step wizard card (rail, lead line, address + geocode, Flatiron map with hex, coordinates, fee card, Onboard CTA) sits in frame under the tool title and tab strip." },
    "manage-viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Whole page at 1440x960 on the Manage tab: site header, tool title, tabs, '2172 converted WiFi networks', search, and the list of converted networks (third row hovered); wallet button hidden." },
    "full.png": { dpr: 2, kind: "full", role: "backdrop", describes: "Full page of the Manage detail for Shallow Coffee Sloth: header card, RadSec certificates, Location editor (z17 map, hex + pin, coordinates, cost row, Update location), Configure with AI card with Cisco Meraki (native RadSec) selected, and the Helium Plus carrier line." },
  },
};

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

// Card-only crops: hide the page title + tab strip (visibility, so no layout
// shift) so a crop's padding never catches a sliver of them.
async function hideChrome(page, on) {
  await page.evaluate((on) => {
    for (const el of document.querySelectorAll('main > div.mb-6, main > div.mb-5')) el.style.visibility = on ? 'hidden' : '';
  }, on);
}

// Toggle a named <style> override.
async function css(page, id, text) {
  await page.evaluate(([id, text]) => {
    let el = document.getElementById(id);
    if (!text) { el?.remove(); return; }
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = text;
  }, [id, text]);
}

// Wait until every MapLibre map on the page has finished drawing: nudge a resize
// (a style swap can leave a stale canvas size), then poll element screenshots
// until consecutive frames match.
async function waitMapStable(page, { min = 2500, max = 25000 } = {}) {
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const maps = page.locator('main .maplibregl-map');
  const n = await maps.count();
  const t0 = Date.now();
  let prev = null, same = 0;
  while (Date.now() - t0 < max) {
    await sleep(700);
    const bufs = [];
    for (let i = 0; i < n; i++) bufs.push(await maps.nth(i).screenshot({ scale: 'css', animations: 'disabled' }).catch(() => null));
    const cur = Buffer.concat(bufs.filter(Boolean));
    if (prev && cur.equals(prev)) { if (++same >= 2 && Date.now() - t0 > min) return; } else same = 0;
    prev = cur;
  }
  console.log('map never fully settled');
}

// Keyboard-zoom a MapLibre map by whole levels around its center (the center is
// the picked location, so the H3 cell is unchanged), then drop focus so no focus
// ring is drawn around the canvas.
async function mapZoom(page, mapEl, key, times = 1) {
  await mapEl.locator('canvas').first().focus();
  for (let i = 0; i < times; i++) { await page.keyboard.press(key); await sleep(450); }
  await sleep(500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

await run(async ({ newPage, shoot, shootRect, settle }) => {
  const page = await newPage({ colorScheme: 'light', wallet: WALLET, width: 1440, height: 960, dpr: 2 });

  // Local mock for POST /status on the freshly ground key only (see header).
  const mock = { gateway: null };
  await page.route('**/api/mobile-onboard/status', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
    if (!mock.gateway || body.gateway !== mock.gateway) return route.fallback();
    console.log('[mock] /status issued+indexed');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ issued: true, indexed: true, onboarded: false, has_location: false, location_dec: null, location_hex: null, device_type: null, num_location_asserts: 0 }),
    });
  });

  async function crop(rect, file) {
    await hideChrome(page, true);
    await shootRect(page, rect, file);
    await hideChrome(page, false);
  }
  const park = () => page.mouse.move(2, 958);
  const tab = (name) => page.locator('main > div.mb-5 button', { hasText: name }).first();
  const card = page.locator('main > div.rounded-2xl').first(); // wizard / guide card

  // Shoot one state in both themes from the same load.
  async function bothThemes(fn, { map = false, hover = null } = {}) {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(500);
      if (map) await waitMapStable(page);
      if (hover) await hover(); else await park();
      await sleep(250);
      await fn(theme);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    if (map) await waitMapStable(page);
  }

  // ---------- Manage tab: the converted-network list ----------
  for (let attempt = 0; ; attempt++) {
    const resp = await page.goto(BASE + '/mobile-onboard?tab=manage', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => /converted WiFi network/.test(document.body.innerText) && document.querySelectorAll('main ul li').length > 5, null, { timeout: 60000 });
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      console.log('manage list not ready (status', resp && resp.status(), ') — waiting 45s');
      await sleep(45000);
    }
  }
  await settle(page, 1500);
  console.log('manage header:', await page.locator('main p.text-xs').first().innerText());
  // The connected-wallet button is a third-party (Phantom) brand block — the most
  // saturated thing in the frame. Hide it (visibility: no layout shift).
  await css(page, 'cap-wallet', 'main .wallet-adapter-button, main .wallet-adapter-dropdown { visibility: hidden !important; }');
  const list = page.locator('main ul.divide-y').first();
  const rows = list.locator('li > button');
  {
    const headerRow = await box(page.locator('main div.space-y-3 > div.flex').first());
    const searchB = await box(page.locator('main input[placeholder^="Search by name"]').locator('..'));
    await bothThemes(async (theme) => {
      await shoot(page, 'viewport', P(theme, 'manage-viewport.png'));
      // list crop: count line, search, first 7 rows (later rows collapsed so the
      // list card ends on its own rounded corner)
      await css(page, 'cap-list', 'main ul.divide-y > li:nth-child(n+8) { display: none !important; }');
      const r = frame([headerRow, searchB, await box(list)], 28, 18, 30);
      await crop(r, P(theme, 'network-list.png'));
      await css(page, 'cap-list', null);
    }, { hover: () => rows.nth(2).hover() });
  }
  await css(page, 'cap-wallet', null);

  // ---------- Manage detail: certificates, location editor, Configure with AI ----------
  const rowName = (await rows.first().locator('span.truncate').first().innerText()).trim();
  console.log('opening', rowName);
  await rows.first().click();
  await page.waitForFunction(() => /Location asserts/.test(document.body.innerText), null, { timeout: 45000 });
  // Opening the editor is local UI state only (its submit button is never clicked).
  await page.getByRole('button', { name: 'Update location', exact: true }).click();
  await page.locator('main .maplibregl-canvas').first().waitFor({ timeout: 20000 });
  await page.locator('#agent-vendor').selectOption(VENDOR);
  await waitMapStable(page);
  {
    // z16 -> z17 around the asserted location, then move the location into the
    // neighbouring H3 cell to the north by typing that cell's center into the
    // Latitude/Longitude inputs (blur recenters the camera, zoom kept). The
    // location then counts as "moved", so the Cost row shows the real re-assert
    // price instead of a dash, the pin sits centered in its hex, and the frame
    // keeps W 66th St / Broadway / Columbus Ave fully labelled (no plaza label
    // printed across the avenues).
    const m = page.locator('main div.relative.h-56').first();
    await m.scrollIntoViewIfNeeded();
    await mapZoom(page, m, 'Equal', 1);
    await waitMapStable(page);
    const latIn = page.locator('main input[placeholder="e.g. 37.7749"]');
    const lngIn = page.locator('main input[placeholder="e.g. -122.4194"]');
    const lat0 = parseFloat(await latIn.inputValue()), lng0 = parseFloat(await lngIn.inputValue());
    const cell0 = h3.latLngToCell(lat0, lng0, 12);
    const north = h3.gridDisk(cell0, 1).filter((c) => c !== cell0)
      .map((c) => h3.cellToLatLng(c)).sort((a, b) => b[0] - a[0])[0];
    await latIn.fill(north[0].toFixed(6));
    await lngIn.fill(north[1].toFixed(6));
    await lngIn.blur();
    console.log('location', lat0, lng0, '->', north[0].toFixed(6), north[1].toFixed(6));
    await page.mouse.move(2, 900);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await waitMapStable(page);
  console.log('cost row:', (await page.locator('main div.rounded-lg.bg-surface-inset', { hasText: 'Cost' }).first().innerText()).replace(/\s+/g, ' '));
  {
    const detail = page.locator('main div.space-y-4').first();
    const cards = detail.locator(':scope > div.rounded-2xl');
    const [hdr, , loc] = await Promise.all([0, 1, 2].map((i) => box(cards.nth(i))));
    await bothThemes(async (theme) => {
      await shoot(page, 'full', P(theme, 'full.png'));
      await crop(frame([hdr, loc], 22, 12, 12), P(theme, 'manage-detail.png'));
    }, { map: true });
  }

  // ---------- Onboard wizard -> Token step: grind a name ----------
  await tab('Onboard').click();
  await page.waitForFunction(() => /Carrier coverage/.test(document.body.innerText), null, { timeout: 15000 });
  await sleep(600);
  await page.getByRole('button', { name: 'Start onboarding' }).click();
  await page.waitForFunction(() => /Selected Hotspot name/i.test(document.body.innerText), null, { timeout: 20000 });
  await card.locator('div.grid.grid-cols-3 input').nth(1).fill(GRIND_COLOR);
  const chips = card.locator('ul li button');
  const matchesBlock = card.locator('div.space-y-1\\.5').filter({ hasText: 'Matches' }).first();
  // Grind (1 in 256 keys — instant). Re-grind a few times if the 12 chips wrap
  // into a ragged 4th row at the natural width; three even rows read better.
  let names = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    await page.getByRole('button', { name: 'Grind' }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('main button')].some((b) => b.innerText.trim() === 'Stop'), null, { timeout: 60000 })
      .catch(async () => { console.log('grind still running — stopping'); await page.getByRole('button', { name: 'Stop' }).click(); });
    await page.keyboard.press('Escape');
    await page.mouse.click(2, 958); // blur the datalist input
    names = await chips.allInnerTexts();
    const nrows = await card.locator('ul li').evaluateAll((els) => new Set(els.map((e) => e.offsetTop)).size);
    console.log(`grind ${attempt}: ${names.length} matches, ${nrows} rows`);
    if (names.length === 12 && nrows === 3) break;
  }
  console.log('matches', names.join(' | '));
  const pick = names[PICK_INDEX];
  await chips.nth(PICK_INDEX).click();
  await park();
  await sleep(400);
  console.log('picked', pick, '| CTA:', await card.locator('button', { hasText: 'Use "' }).innerText());
  await page.evaluate(() => window.scrollTo(0, 0));
  {
    // name-grinder.png: the Token-step card at its natural width.
    const c = await box(card);
    await bothThemes(async (theme) => {
      await crop(frame([c], 24, 24), P(theme, 'name-grinder.png'));
    });
  }
  {
    // detail.png: the match chips + CTA at dpr 3, same session, same grind.
    const rect = frame([await box(matchesBlock), await box(card.locator('button', { hasText: 'Use "' }).first())], 14, 14);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 3, mobile: false });
    await sleep(600);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await park();
      await sleep(500);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true, fromSurface: true });
      fs.mkdirSync(path.join(OUT, theme), { recursive: true });
      fs.writeFileSync(P(theme, 'detail.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
    await page.emulateMedia({ colorScheme: 'light' });
    await sleep(600);
    console.log('dpr restored to', await page.evaluate(() => devicePixelRatio));
  }
  {
    // hero.png: main widened to ~900 so the page title + Onboard tab + Token-step
    // card frame at ~4:3. Nothing hidden, nothing added.
    await css(page, 'cap-hero', `main.max-w-2xl { max-width: ${HERO_MAIN_W}px !important; }`);
    await sleep(400);
    const r = frame([await box(page.locator('main > div.mb-6').first()), await box(page.locator('main > div.mb-5').first()), await box(card)], 24, 26, 28);
    console.log('hero rect', JSON.stringify(r), 'ratio', (r.width / r.height).toFixed(2));
    await bothThemes(async (theme) => {
      await shootRect(page, r, P(theme, 'hero.png'));
    });
    await css(page, 'cap-hero', null);
    await sleep(300);
  }

  // Commit the key (client-side only: builds the token, saves a local draft).
  await page.locator('main button', { hasText: 'Use "' }).click();
  await page.waitForFunction(() => /Your new Hotspot/i.test(document.body.innerText), null, { timeout: 10000 });
  const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem('heliumtools:mobile-onboard:drafts:v1') || '{}'));
  const gw = Object.values(drafts).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  console.log('draft gateway', gw.name, gw.gateway.slice(0, 12));
  if (gw.name !== pick) console.log('WARNING: committed name differs from picked chip');
  mock.gateway = gw.gateway;

  // Remount the wizard (tab away + back) so the intro lists the resumable draft.
  await tab('AP Setup Guide').click();
  await sleep(400);
  await tab('Onboard').click();
  await page.waitForFunction(() => /Resume onboarding/.test(document.body.innerText), null, { timeout: 10000 });

  // ---------- Location step (mocked /status: issued, not onboarded) ----------
  await card.locator('ul li button', { hasText: gw.name }).first().click();
  await page.waitForFunction(() => /Street address/.test(document.body.innerText), null, { timeout: 20000 });
  await page.locator('#onboard-address').fill(ADDRESS);
  await page.getByRole('button', { name: 'Find on map' }).click();
  await page.waitForFunction(() => /Found: /.test(document.body.innerText), null, { timeout: 20000 });
  await page.waitForFunction(() => /Total[\s\S]*DC \(\$/.test(document.querySelector('main').innerText), null, { timeout: 20000 });
  await waitMapStable(page);
  // A building-precision hit lands at z18 (the hex fills the building); one
  // level out shows the street grid around the cell. Center unchanged.
  const pickerMap = card.locator('div.relative.h-56').first();
  await mapZoom(page, pickerMap, 'Minus', 1);
  await waitMapStable(page);
  console.log('lat/lng', await card.locator('input.font-mono').evaluateAll((els) => els.map((e) => e.value)));
  {
    // viewport.png: scroll so the whole wizard card (fee card + CTA) sits in frame.
    const c = await box(card);
    const y = Math.max(0, Math.round(c.y + c.height + 24 - 960));
    console.log('viewport scroll', y);
    await bothThemes(async (theme) => {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await sleep(300);
      await shoot(page, 'viewport', P(theme, 'viewport.png'));
    }, { map: true });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  {
    // location-step.png: the full Location-step card (lead line, address + geocode
    // result, map with H3 cell, coordinates, fee card, CTA), main widened to ~900.
    await css(page, 'cap-loc', `main.max-w-2xl { max-width: ${HERO_MAIN_W}px !important; }`);
    await waitMapStable(page);
    const c = await box(card);
    console.log('location card', JSON.stringify(c));
    await bothThemes(async (theme) => {
      await crop(frame([c], 26, 26), P(theme, 'location-step.png'));
    }, { map: true });
    await css(page, 'cap-loc', null);
  }

  // ---------- AP Setup Guide tab: RadSec servers + Passpoint realms ----------
  await tab('AP Setup Guide').click();
  await page.waitForFunction(() => /RadSec servers/.test(document.body.innerText), null, { timeout: 10000 });
  await sleep(500);
  {
    const sections = card.locator(':scope > div.space-y-5 > div');
    const radsec = sections.filter({ hasText: 'RadSec servers' }).first();
    const passpoint = sections.filter({ hasText: 'Passpoint settings' }).first();
    const realms = passpoint.locator(':scope > div.rounded-lg.bg-surface-inset').first();
    const b = [await box(radsec), await box(realms)];
    await bothThemes(async (theme) => {
      await crop(frame(b, 20, 14, 12), P(theme, 'radsec-passpoint.png'));
    });
  }

  await page.evaluate(() => localStorage.removeItem('heliumtools:mobile-onboard:drafts:v1'));

  writeManifest(OUT, MANIFEST);
}, { timeoutMs: 480000 });
