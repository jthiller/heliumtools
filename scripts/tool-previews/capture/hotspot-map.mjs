// Hotspot Map (/hotspot-map) — source captures for the landing-page preview art.
//
//   node capture/hotspot-map.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/hotspot-map/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses map-perspective.png and
// detail.png (previews/hotspot-map.js).
//
// One page load: wallet lookup (nyc, 2,172 Mobile data-only Hotspots) -> preview list
// -> Add to Map (read-only POST /resolve) -> frame the whole New York cluster -> select a
// Hotspot in the densest block -> close it and hover a dot in the Midtown grid.
// Every state is shot in light and dark from the same load (emulateMedia; the
// basemap swaps style on the media change, so we wait for its tiles each time).
// No wallet is connected: the wallet is only typed into the page's own lookup field.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/hotspot-map/', import.meta.url));
const P = (theme, f) => path.join(OUT, theme, f);
const THEMES = ['light', 'dark'];
const WALLET = WALLETS.nyc;
const PULSE_PHASE = 0.12; // selected-Hotspot ring: radius 6+18p px, alpha 160(1-p) -> ~8.2 px at ~55% (its most legible phase)
const shots = [];
const rec = (file, theme, kind, describes, cssWidth, cssHeight, role) =>
  shots.push({ file: `${theme}/${file}`, theme, kind, describes, cssWidth: Math.round(cssWidth), cssHeight: Math.round(cssHeight), role });

// Page-side helpers: reach the deck.gl instance and the MapLibre map through React
// fibers, so we can read tile-load state, project points, and set the camera
// (through the page's own onViewStateChange, exactly what a drag/zoom does).
const HELPERS = `
window.__cap = (() => {
  const fiber = (el) => { if (!el) return null; const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  function* hooks(f) { let h = f && f.memoizedState; let n = 0; while (h && typeof h === 'object' && 'next' in h && n++ < 60) { yield h.memoizedState; h = h.next; } }
  const deck = () => { let f = fiber(document.getElementById('deckgl-overlay')); for (let i = 0; f && i < 25; i++, f = f.return) { for (const s of hooks(f)) { const d = s && s.current && s.current.deck; if (d && d.getViewports) return d; } } return null; };
  const map = () => { let f = fiber(document.querySelector('.maplibregl-map')); for (let i = 0; f && i < 25; i++, f = f.return) { for (const s of hooks(f)) { if (s && typeof s.getMap === 'function') return s.getMap(); if (s && s.map && typeof s.map.areTilesLoaded === 'function') return s.map; } } return null; };
  const data = () => { const d = deck(); const l = d && d.layerManager.getLayers().find((l) => l.id === 'hotspots'); return l ? l.props.data : []; };
  return { deck, map, data };
})();`;

await run(async ({ newPage, settle, shoot, shootRect, sleep }) => {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) console.log('[http]', r.status(), r.url().slice(0, 140)); });
  await page.addInitScript(HELPERS);

  const setTheme = async (theme) => { await page.emulateMedia({ colorScheme: theme }); await sleep(400); };
  const mapReady = async (extra = 1500) => {
    const t0 = Date.now();
    let ok = 0;
    while (Date.now() - t0 < 45000) {
      const s = await page.evaluate(() => { const m = window.__cap.map(); return m ? (m.isStyleLoaded() && m.areTilesLoaded() && m.loaded()) : null; }).catch(() => null);
      if (s) { if (++ok >= 3) break; } else ok = 0;
      await sleep(300);
    }
    if (ok < 3) console.log('[warn] map not fully loaded after', Date.now() - t0, 'ms');
    await sleep(extra);
  };
  const basemapName = () => page.evaluate(() => { const m = window.__cap.map(); const s = m && m.getStyle(); return s ? (s.name || '') + ' ' + String(s.sprite || '').slice(-40) : ''; });
  // Wait until deck's viewport matches the overlay's on-screen size (after hiding/showing chrome).
  const deckSized = async () => {
    for (let i = 0; i < 40; i++) {
      const ok = await page.evaluate(() => { const d = window.__cap.deck(); const vp = d && d.getViewports()[0]; const r = document.getElementById('deckgl-overlay').getBoundingClientRect(); return vp && Math.abs(vp.width - r.width) < 1 && Math.abs(vp.height - r.height) < 1; });
      if (ok) return;
      await sleep(150);
    }
    console.log('[warn] deck viewport never matched overlay size');
  };
  const setView = async (vs) => {
    await page.evaluate((vs) => {
      const d = window.__cap.deck();
      const cur = d.getViewports()[0];
      const viewState = { longitude: cur.longitude, latitude: cur.latitude, zoom: cur.zoom, pitch: cur.pitch || 0, bearing: cur.bearing || 0, ...vs, transitionDuration: 0 };
      d.props.onViewStateChange({ viewState, interactionState: {}, viewId: 'default-view', oldViewState: null });
    }, vs);
    await sleep(500);
  };
  // Fit a lng/lat box inside `rect` (page CSS px) with `pad` (fraction of rect) on every side,
  // centred vertically on the box and horizontally on `centerLng` (clamped so the box never
  // leaves the padded rect). Pure Web-Mercator math against deck's 512-px world.
  const frame = async ({ rect, bounds, pad = 0.07, centerLng = null }) => {
    const vs = await page.evaluate(({ rect, bounds, pad, centerLng }) => {
      const el = document.getElementById('deckgl-overlay').getBoundingClientRect();
      const mx = (lng) => (lng + 180) / 360;
      const my = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
      const [[w, s], [e, n]] = bounds;
      const dx = mx(e) - mx(w), dy = my(s) - my(n);
      const scale = Math.min(rect.width * (1 - 2 * pad) / dx, rect.height * (1 - 2 * pad) / dy);
      const zoom = Math.log2(scale / 512);
      const ty = (my(s) + my(n)) / 2;
      let tx = centerLng != null ? mx(centerLng) : (mx(w) + mx(e)) / 2;
      const halfW = rect.width * (1 - 2 * pad) / 2 / scale;
      tx = Math.min(tx, mx(w) + halfW); tx = Math.max(tx, mx(e) - halfW);
      const rcx = rect.x - el.left + rect.width / 2, rcy = rect.y - el.top + rect.height / 2;
      const cx = tx + (el.width / 2 - rcx) / scale, cy = ty + (el.height / 2 - rcy) / scale;
      return { longitude: cx * 360 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI, zoom };
    }, { rect, bounds, pad, centerLng });
    await setView(vs);
    return vs;
  };
  // Report where the fleet actually landed (page px) so framing can be checked from the log.
  const extents = (label) => page.evaluate(() => {
    const d = window.__cap.deck(); const vp = d.getViewports()[0];
    const r = document.getElementById('deckgl-overlay').getBoundingClientRect();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const h of window.__cap.data()) { if (!h.coords || h.coords[1] < -80) continue; const [x, y] = vp.project([h.coords[1], h.coords[0]]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0: Math.round(x0 + r.left), x1: Math.round(x1 + r.left), y0: Math.round(y0 + r.top), y1: Math.round(y1 + r.top), zoom: +vp.zoom.toFixed(2) };
  }).then((e) => console.log('[extents]', label, JSON.stringify(e)));
  const hideLabels = () => page.evaluate(() => {
    const m = window.__cap.map(); window.__labelVis = {};
    for (const l of m.getStyle().layers) if (l.type === 'symbol') { window.__labelVis[l.id] = m.getLayoutProperty(l.id, 'visibility') || 'visible'; m.setLayoutProperty(l.id, 'visibility', 'none'); }
  }).then(() => sleep(300));
  const restoreLabels = () => page.evaluate(() => {
    const m = window.__cap.map();
    for (const [id, v] of Object.entries(window.__labelVis || {})) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v);
  }).then(() => sleep(300));
  // The selected-Hotspot pulse is driven by Date.now(); hold it at one phase so the ring reads the same in both themes.
  const freezePulse = (phase) => page.evaluate((phase) => { if (!window.__realNow) window.__realNow = Date.now; const t = Math.floor(window.__realNow() / 1500) * 1500 + Math.round(phase * 1500); Date.now = () => t; }, phase).then(() => sleep(400));
  const unfreezePulse = () => page.evaluate(() => { if (window.__realNow) Date.now = window.__realNow; });
  const project = (lng, lat) => page.evaluate(({ lng, lat }) => {
    const d = window.__cap.deck(); const vp = d.getViewports()[0]; const [x, y] = vp.project([lng, lat]);
    const r = document.getElementById('deckgl-overlay').getBoundingClientRect();
    return { x: x + r.left, y: y + r.top };
  }, { lng, lat });
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const parkMouse = () => page.mouse.move(720, 36); // over the site header: no map hover

  // The desktop results list (max-h 340px, scrolls). Scroll it so `topIndex` is the first row and
  // nudge a few px so both the top and the bottom cut fall inside a row's padding, never through text.
  const LIST = '.md\\:flex.absolute .flex-1.overflow-y-auto'; // (the detail card is overflow-y-auto too)
  const scrollList = (topIndex) => page.evaluate(({ sel, topIndex }) => {
    const list = document.querySelector(sel);
    const rows = [...list.children];
    const lr = list.getBoundingClientRect();
    const tops = rows.map((r) => r.getBoundingClientRect().top - lr.top + list.scrollTop);
    const hs = rows.map((r) => r.getBoundingClientRect().height);
    const base = tops[topIndex];
    let best = 0;
    for (let d = 0; d <= 9; d++) {
      const bottom = base + d + list.clientHeight;
      const i = tops.findIndex((t, k) => bottom > t && bottom <= t + hs[k]);
      const off = i < 0 ? 0 : bottom - tops[i];
      if (off <= 1 || off >= hs[i] - 9) { best = d; break; }
    }
    list.scrollTop = base + best;
    return { scrollTop: list.scrollTop, nudge: best, clientHeight: list.clientHeight, rowH: hs[topIndex] };
  }, { sel: LIST, topIndex });
  // First index from which `n` consecutive rows have no badge overflow (long names push the
  // "Wallet 1" pill under the key column at the stock 380px width).
  // A badge is "squeezed" when it grows once it is not allowed to shrink (flex-shrink 0).
  const cleanStart = (n, from = 0) => page.evaluate(({ sel, n, from }) => {
    const rows = [...document.querySelector(sel).children];
    const bad = rows.map((r) => {
      const f = r.firstElementChild && r.firstElementChild.firstElementChild;
      if (!f) return false;
      return [...f.children].slice(1).some((c) => { // skip the name (it truncates by design); the Wallet pill is truncate too
        const w0 = c.getBoundingClientRect().width; const prev = c.style.flexShrink;
        c.style.flexShrink = '0'; const w1 = c.getBoundingClientRect().width; c.style.flexShrink = prev;
        return w1 - w0 > 0.5;
      });
    });
    for (let i = from; i < rows.length - n; i++) if (!bad.slice(i, i + n).some(Boolean)) return i;
    return from;
  }, { sel: LIST, n, from });

  // ---------- 1. Load the page + look up the wallet ----------
  await page.goto(BASE + '/hotspot-map', { waitUntil: 'domcontentloaded' });
  await settle(page, 1500);
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  const walletField = page.locator('input[placeholder^="Af2uu"]:visible');
  const addBtn = page.getByRole('button', { name: /^Add \d+ to Map$/ });
  for (let attempt = 0; attempt < 3; attempt++) {
    await walletField.fill(WALLET);
    await page.getByRole('button', { name: 'Search Wallet' }).click();
    const r = await Promise.race([
      addBtn.waitFor({ timeout: 60000 }).then(() => 'ok'),
      page.locator('.text-rose-700:visible').waitFor({ timeout: 60000 }).then(() => 'err'),
    ]);
    if (r === 'ok') break;
    console.log('[wallet] error:', await page.locator('.text-rose-700:visible').innerText(), '- waiting 45s');
    await sleep(45000);
  }
  await parkMouse();
  await mapReady(800);

  // ---------- 2. Wallet preview card ----------
  const preview = page.locator('div.rounded-xl', { has: page.getByText(/^Found \d+ hotspots/) }).first();
  for (const theme of THEMES) {
    await setTheme(theme);
    await mapReady(600);
    const bb = await preview.boundingBox();
    await shoot(page, preview, P(theme, 'wallet-preview.png'));
    rec('wallet-preview.png', theme, 'element', 'Wallet lookup result card: green "Found 2172 hotspots (2172 Mobile)" banner, optional label field, a checkbox list of animal-named Hotspots with MOBILE badges, and the Back / Deselect All / teal "Add 2172 to Map" footer' + (theme === 'dark' ? ' (in dark mode the banner text is dark green on dark teal and nearly illegible: real UI, re-tint before using)' : ''), bb.width, bb.height, 'supporting');
  }
  await setTheme('light');

  // ---------- 3. Add to map (read-only /resolve) ----------
  await addBtn.click();
  await page.getByText(/^Fit all$/).first().waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !/\b\d+ \/ \d+\b/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => console.log('[warn] progress bar still showing'));
  await page.waitForFunction(() => window.__cap.data().length > 0, null, { timeout: 30000 });
  await mapReady(1000);
  // The search field is cleared on "Add to Map"; put the searched wallet back so the form reads as used, not empty.
  await walletField.fill(WALLET);
  await blur();
  await parkMouse();

  const stats = await page.evaluate(() => {
    const all = window.__cap.data().filter((d) => d.coords);
    const pts = all.filter((d) => d.coords[1] > -80); // drop the lone West Coast outlier
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
    const lats = pts.map((d) => d.coords[0]); const lngs = pts.map((d) => d.coords[1]);
    let best = null;
    for (const a of pts) {
      let n = 0;
      for (const b of pts) { if (Math.abs(a.coords[0] - b.coords[0]) < 0.0032 && Math.abs(a.coords[1] - b.coords[1]) < 0.0042) n++; }
      if (!best || n > best.n) best = { n, entityKey: a.entityKey, name: a.name, coords: a.coords };
    }
    const types = {};
    for (const d of all) for (const v of Object.values(d.networkDetails || {})) types[v.deviceType] = (types[v.deviceType] || 0) + 1;
    return {
      n: all.length, nyc: pts.length,
      box: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      massLng: (q(lngs, 0.05) + q(lngs, 0.95)) / 2,
      p10: [[q(lngs, 0.1), q(lats, 0.1)], [q(lngs, 0.9), q(lats, 0.9)]],
      best, types,
    };
  });
  console.log('[stats]', JSON.stringify(stats));

  // ---------- 4. Populated tool: viewport + full + results list ----------
  const overlay = await page.locator('#deckgl-overlay').boundingBox();
  const mapArea = { x: 396 + 28, y: overlay.y + 24, width: 1440 - 424 - 64, height: overlay.height - 48 };
  await frame({ rect: mapArea, bounds: stats.box, pad: 0.05, centerLng: stats.massLng });
  await extents('viewport');
  const listStart = await cleanStart(6);
  console.log('[list] clean start', listStart, JSON.stringify(await scrollList(listStart)));
  const resultsPanel = page.locator('div.rounded-xl', { has: page.getByText(/^Fit all$/) }).first();
  for (const theme of THEMES) {
    await setTheme(theme);
    await mapReady(2000);
    console.log('[style]', theme, await basemapName());
    await shoot(page, 'viewport', P(theme, 'viewport.png'));
    rec('viewport.png', theme, 'viewport', 'Whole tool at 1440x960: header with network counts (0 IoT / 2172 Mobile / 2172 hotspots), floating sidebar (Entity Keys | Wallet tabs with the searched wallet in the field and an enabled teal Search Wallet button, then the Hotspots list with All/IoT/Mobile filter pills), and the whole New York swarm of 2,172 violet Mobile Hotspot dots framed in the open map area', 1440, 960, 'backdrop');
    await shoot(page, 'full', P(theme, 'full.png'));
    rec('full.png', theme, 'full', 'Full page, kept on purpose though it is pixel-identical to viewport.png: the tool is a fixed full-screen (h-screen) layout with no page scroll, so the full-page capture equals the viewport', 1440, 960, 'backdrop');
  }
  await setTheme('light');

  // Results list crop: stock width (380) overflows the first row's badges and wraps "Fit all",
  // so widen the sidebar to 412px for this crop only and cap the list at exactly 5 whole rows.
  {
    const ROWS = 5;
    const start = await cleanStart(ROWS, 1);
    const widen = await page.addStyleTag({ content: '.md\\:flex.absolute { width: 412px !important; }' });
    await sleep(300);
    const h = await page.evaluate(({ sel, start, ROWS }) => {
      const list = document.querySelector(sel);
      const rows = [...list.children].slice(start, start + ROWS);
      return rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0);
    }, { sel: LIST, start, ROWS });
    const cap = await page.addStyleTag({ content: `${LIST} { max-height: ${h}px !important; }` });
    await sleep(300);
    await page.evaluate(({ sel, start }) => { const list = document.querySelector(sel); const r = list.children[start]; list.scrollTop = r.offsetTop - list.firstElementChild.offsetTop; }, { sel: LIST, start });
    console.log('[list crop] start', start, 'height', h);
    for (const theme of THEMES) {
      await setTheme(theme);
      await mapReady(800);
      const bb = await resultsPanel.boundingBox();
      await shoot(page, resultsPanel, P(theme, 'results-list.png'));
      rec('results-list.png', theme, 'element', 'Hotspots results panel (sidebar widened to 412px for this crop so the header and badges sit on one line): Hotspots · Fit all · Share, the All 2172 / IoT 0 / Mobile 2172 filter pills, and five whole rows of animal-named Hotspots with MOBILE + "Wallet 1" badges, coordinates and truncated entity keys', bb.width, bb.height, 'supporting');
    }
    await cap.evaluate((el) => el.remove());
    await widen.evaluate((el) => el.remove());
    await setTheme('light');
    await scrollList(listStart);
    await sleep(300);
  }

  // ---------- 5. Hero: the clean map, framed on the whole New York cluster ----------
  {
    const hide = await page.addStyleTag({ content: 'header, .md\\:flex.absolute, .maplibregl-ctrl-top-right, .maplibregl-ctrl-top-left { display: none !important; }' });
    await sleep(600);
    await deckSized();
    const HW = 1000, HH = 750;
    const box = await page.locator('#deckgl-overlay').boundingBox();
    const rect = { x: Math.round(box.x + (box.width - HW) / 2), y: Math.round(box.y + (box.height - HH) / 2), width: HW, height: HH };
    await frame({ rect, bounds: stats.box, pad: 0.07, centerLng: stats.massLng });
    await extents('hero rect=' + JSON.stringify(rect));
    for (const theme of THEMES) {
      await setTheme(theme);
      await mapReady(1200);
      await hideLabels();
      await mapReady(1200);
      await shootRect(page, rect, P(theme, 'hero.png'));
      rec('hero.png', theme, 'map', 'Hero: the bare map (site header, sidebar, map controls and basemap place labels hidden) framed on the whole New York fleet with ~7% margin: 2,172 Mobile Hotspots as violet white-rimmed dots tracing Manhattan\'s avenues, fanning across Brooklyn and Queens, up into the Bronx and out to Staten Island; attribution is outside the crop', HW, HH, 'hero');
    }
    await restoreLabels();
    // Perspective variant: the swarm with the map pitched/rotated (right-drag in the tool), labels on.
    {
      const core = await frame({ rect, bounds: stats.p10, pad: 0.04 });
      await setView({ ...core, longitude: core.longitude + 0.012, zoom: core.zoom + 0.3, pitch: 52, bearing: -24 });
      for (const theme of THEMES) {
        await setTheme(theme);
        await mapReady(2200);
        await shootRect(page, rect, P(theme, 'map-perspective.png'));
        rec('map-perspective.png', theme, 'map', 'The New York swarm with the map pitched 52° and rotated -24° (the tool\'s right-drag rotate/tilt): dots on the street grid receding toward the horizon over labelled Manhattan, Brooklyn and Queens; chrome hidden', HW, HH, 'supporting');
      }
      await setView({ pitch: 0, bearing: 0 });
    }
    await hide.evaluate((el) => el.remove());
    await setTheme('light');
    await sleep(600);
    await deckSized();
  }

  // ---------- 6. Selected Hotspot: detail card + pulsing ring at street level ----------
  const best = stats.best;
  const key4 = `${best.entityKey.slice(0, 4)}...${best.entityKey.slice(-4)}`;
  const row = page.locator(`${LIST} > button`, { hasText: key4 }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click(); // flyToHotspot: select + recentre (read-only)
  await parkMouse();
  await sleep(1500);
  const detailCard = page.locator('div.rounded-xl:visible', { has: page.locator('h3') }).first();
  await detailCard.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /Onboarded/.test(document.querySelector('.md\\:flex.absolute')?.innerText || ''), null, { timeout: 30000 }).catch(() => console.log('[warn] onboard date never arrived'));
  // Selected row second from the top of the list, with clean top/bottom cuts.
  const selIndex = await page.evaluate((sel) => [...document.querySelector(sel).children].findIndex((r) => r.className.includes('border-l-accent')), LIST);
  console.log('[selected]', best.name, 'row', selIndex, JSON.stringify(await scrollList(Math.max(0, selIndex - 1))));
  // Put the selected dot in the middle of the open map area right of the sidebar.
  const placeSelected = async (zoom) => {
    await setView({ longitude: best.coords[1], latitude: best.coords[0], zoom });
    const shift = await page.evaluate(() => {
      const d = window.__cap.deck(); const vp = d.getViewports()[0];
      const [lng, lat] = vp.unproject([vp.width / 2 - 198, vp.height / 2]);
      return { longitude: lng, latitude: lat };
    });
    await setView(shift);
  };
  {
    await placeSelected(13.7);
    for (const theme of THEMES) {
      await setTheme(theme);
      await mapReady(2000);
      await freezePulse(PULSE_PHASE);
      const bb = await detailCard.boundingBox();
      await shoot(page, detailCard, P(theme, 'detail-card.png'));
      rec('detail-card.png', theme, 'element', `Selected-Hotspot detail card: lat/lng + H3 hex index header, name "${best.name}" with MOBILE + Wallet 1 badges, copyable Key and Owner, device type (wifiDataOnly) and the on-chain Onboarded date`, bb.width, bb.height, 'supporting');
      const pt = await project(best.coords[1], best.coords[0]);
      const MW = 880, MH = 620;
      const r = { x: Math.round(Math.min(1440 - MW, Math.max(396, pt.x - MW / 2))), y: Math.round(Math.min(960 - MH, Math.max(overlay.y, pt.y - MH / 2))), width: MW, height: MH };
      await shootRect(page, r, P(theme, 'map-closeup.png'));
      rec('map-closeup.png', theme, 'map', 'Neighbourhood close-up (zoom 13.7) of the densest New York block: dozens of violet Hotspot dots on the street grid, the selected one ringed by its violet pulse (animation held at the same phase in both themes)', MW, MH, 'supporting');
      await unfreezePulse();
    }
    await setTheme('light');
    // Whole tool with the selection: zoom in a little so the ring separates from its neighbours.
    await placeSelected(14.2);
    for (const theme of THEMES) {
      await setTheme(theme);
      await mapReady(2000);
      await freezePulse(PULSE_PHASE);
      // Cursor resting on the selected dot (as after clicking it on the map): its tooltip names the selection.
      const sp = await project(best.coords[1], best.coords[0]);
      await page.mouse.move(sp.x - 25, sp.y + 25);
      await sleep(150);
      await page.mouse.move(sp.x, sp.y, { steps: 5 });
      await sleep(700);
      const tipText = () => page.locator('div.pointer-events-none.absolute.z-50').first().innerText({ timeout: 2000 }).catch(() => '');
      for (const [dx, dy] of [[-3, 0], [0, -3], [-3, -3], [3, 3], [-4, 2]]) {
        if ((await tipText()).includes(best.name)) break;
        await page.mouse.move(sp.x + dx, sp.y + dy, { steps: 2 });
        await sleep(500);
      }
      console.log('[selected tooltip]', theme, JSON.stringify(await tipText()));
      await shoot(page, 'viewport', P(theme, 'viewport-selected.png'));
      await parkMouse();
      rec('viewport-selected.png', theme, 'viewport', `Whole tool with a Hotspot selected: detail card ("${best.name}") stacked above the results list (selected row highlighted second from the top), map at zoom 14.2 over Midtown/Kips Bay with the selected dot ringed by its pulse in the middle of the open map and the cursor resting on it, so its hover tooltip names it`, 1440, 960, 'backdrop');
      await unfreezePulse();
    }
    await setTheme('light');
  }

  // ---------- 7. Hover tooltip macro over the Midtown grid (dpr 3), nothing selected ----------
  {
    await page.locator('.md\\:flex.absolute button:has(svg)').first().click(); // detail card close (X)
    await sleep(800);
    await setView({ longitude: -73.985, latitude: 40.752, zoom: 14.3 });
    await mapReady(1200);
    // Pick the dot whose surroundings (where the tooltip and the crop fall) hold the most dots.
    const target = await page.evaluate(() => {
      const d = window.__cap.deck(); const vp = d.getViewports()[0];
      const r = document.getElementById('deckgl-overlay').getBoundingClientRect();
      const pr = window.__cap.data().filter((h) => h.coords && h.name).map((h) => { const [x, y] = vp.project([h.coords[1], h.coords[0]]); return { x, y, name: h.name, coords: h.coords }; });
      let pick = null;
      for (const a of pr) {
        if (a.x < 560 || a.x > vp.width - 480 || a.y < 160 || a.y > vp.height - 200) continue;
        let n = 0, under = 0;
        for (const b of pr) {
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx > -150 && dx < 380 && dy > -120 && dy < 150) n++;
          if (dx > 8 && dx < 260 && dy > -16 && dy < 60) under++; // would be hidden under the tooltip
        }
        const score = n - 0.6 * under;
        if (!pick || score > pick.score) pick = { ...a, score, n, under };
      }
      return pick && { ...pick, x: pick.x + r.left, y: pick.y + r.top };
    });
    console.log('[hover]', JSON.stringify(target));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 3, mobile: false });
    await sleep(1500);
    // Playwright's own screenshot re-applies the context's dpr 2, so capture through CDP to keep dpr 3.
    const shotCdp = async (r, file) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 }, fromSurface: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    };
    for (const theme of THEMES) {
      await setTheme(theme);
      await mapReady(1800);
      await page.mouse.move(target.x - 30, target.y - 30);
      await sleep(200);
      await page.mouse.move(target.x, target.y, { steps: 6 });
      await sleep(900);
      const tip = page.locator('div.pointer-events-none.absolute.z-50').first();
      const tb = await tip.boundingBox();
      if (!tb) { console.log('[warn] no tooltip'); continue; }
      const r = { x: Math.round(target.x - 150), y: Math.round(tb.y - 95), width: 0, height: 0 };
      r.width = Math.round(tb.x + tb.width + 130 - r.x);
      r.height = Math.round(Math.max(tb.y + tb.height, target.y) + 86 - r.y); // ends just above the 'Madison Square Fountain' label
      await shotCdp(r, P(theme, 'detail.png'));
      rec('detail.png', theme, 'detail', `Macro (dpr 3): the cursor-hover tooltip on a Midtown Manhattan dot — "${target.name}" with MOBILE + Wallet 1 badges, lat/lng and truncated entity key — floating over the dense field of violet Hotspot dots on the street grid (hovered dot tinted by deck.gl's sky-blue autoHighlight)`, r.width, r.height, 'detail');
      await parkMouse();
      await sleep(300);
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    slug: 'hotspot-map',
    route: '/hotspot-map',
    wallet: WALLET,
    notes: `Loaded via the Wallet tab (wallet ${WALLET}, the "nyc" showcase wallet: ${stats.n} Mobile data-only Hotspots, ${JSON.stringify(stats.types)}), preview -> "Add to Map" (read-only POST /hotspot-map/resolve). "Add to Map" clears the search field, so the searched wallet was typed back in for the populated shots (the Search Wallet button then shows enabled). The wallet has one far outlier in Los Angeles, so the tool's own fit-to-bounds frames the whole continent; the camera was re-framed (through the page's own onViewStateChange, same as a user zoom/pan) to the full bounding box of the other ${stats.nyc} Hotspots — Inwood/Bronx to Staten Island/Coney Island — with margin on every side, centred horizontally on the fleet's mass. All dots are violet because the fleet is Mobile-only (IoT renders emerald); no coverage-sector fans because it has no wifiOutdoor Hotspots. hero.png and map-perspective.png hide the site header, sidebar and MapLibre controls via injected CSS; hero.png also hides the basemap's symbol (place-label) layers so town names do not compete with the dots. results-list.png widens the sidebar to 412px and caps the list at five whole rows (CSS only) so its header and badges read cleanly. The selected-Hotspot pulse ring is driven by Date.now(); it was held at the same phase (${PULSE_PHASE}) for every shot that shows it, in both themes. detail.png is the native hover tooltip at dpr 3 (CDP device-metrics override, taken last on the same load) with nothing selected. full.png is intentionally identical to viewport.png (fixed full-screen layout). DO NOT use dark/wallet-preview.png's "Found 2172 hotspots" banner as-is: the app has no dark variant for that text, so it is dark green on dark teal and nearly illegible — crop it out or re-tint it in compositing; the light version is fine.`,
    shots,
  }, null, 2));
  console.log('[done]', shots.length, 'shots');
}, { timeoutMs: 600000 });
