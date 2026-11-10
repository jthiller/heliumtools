// LoRaWAN Traffic Map (/lorawan-traffic) — source captures for the landing-page preview art.
//
//   node capture/lorawan-traffic.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/lorawan-traffic/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses map-europe.png and
// operators.png (previews/lorawan-traffic.js).
//
// Read-only: the page takes no wallet and makes only GETs (the utilization
// index and one file per operator from api-iot.heliumtools.org, plus Helium's
// well-known operator names). Nothing is clicked. The shots are aggregate views
// only: the dot swarm and the operator list. No Hotspot is hovered or clicked,
// so no single Hotspot's name or key is in any shot. Operator names shown are
// the ones operators published in Helium's well-known list. The figures are
// live (the data is rebuilt once a day), so numbers change from one capture to
// the next; the crops frame the layout, not the digits.
//
// Main pass, 1440x960 at dpr 2, light then dark from one page state (emulateMedia;
// the basemap swaps style on the media change, so its tiles are awaited each time):
//   map-world.png    the map area right of the sidebar as the page frames it on load
//   map-europe.png   the same area with the camera on Europe, where the operators'
//                    colors mix most densely (the card's anchor)
// Macro pass, dpr 3:
//   filters.png      the filter card: title, time range, packet range, shown totals
//   operators.png    the operator picker's first rows: switch, color, name, OUI, counts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, writeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/lorawan-traffic/', import.meta.url));
const ROUTE = '/lorawan-traffic';
const THEMES = ['light', 'dark'];
const P = (theme, f) => path.join(OUT, theme, f);
const EUROPE = [[-10.5, 36], [31, 60.5]]; // [[west, south], [east, north]]
const OPERATOR_ROWS = 6;

// Page-side helpers (as in capture/hotspot-map.mjs): reach the deck.gl instance
// and the MapLibre map through React fibers, to read tile-load state and set
// the camera through the page's own onViewStateChange, exactly what a drag does.
const HELPERS = `
window.__cap = (() => {
  const fiber = (el) => { if (!el) return null; const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  function* hooks(f) { let h = f && f.memoizedState; let n = 0; while (h && typeof h === 'object' && 'next' in h && n++ < 60) { yield h.memoizedState; h = h.next; } }
  const deck = () => { let f = fiber(document.getElementById('deckgl-overlay')); for (let i = 0; f && i < 25; i++, f = f.return) { for (const s of hooks(f)) { const d = s && s.current && s.current.deck; if (d && d.getViewports) return d; } } return null; };
  const map = () => { let f = fiber(document.querySelector('.maplibregl-map')); for (let i = 0; f && i < 25; i++, f = f.return) { for (const s of hooks(f)) { if (s && typeof s.getMap === 'function') return s.getMap(); if (s && s.map && typeof s.map.areTilesLoaded === 'function') return s.map; } } return null; };
  return { deck, map };
})();`;

await run(async ({ newPage, shoot, shootRect, sleep }) => {
  for (const t of THEMES) fs.mkdirSync(path.join(OUT, t), { recursive: true });
  const shots = {};

  const mapReady = async (page, extra = 1200) => {
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

  // Every operator's file in, nothing still loading, nothing failed.
  const load = async (page) => {
    await page.addInitScript(HELPERS);
    await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'LoRaWAN traffic by operator' }).waitFor({ timeout: 60000 });
    await page.getByText(/^Showing \d+ of \d+ operators$/).first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('label')].filter((l) => l.querySelector('input[type="checkbox"]'));
      return rows.length > 0 && !/Loading operators/.test(document.body.innerText) && !rows.some((l) => /…|loading/.test(l.innerText));
    }, null, { timeout: 180000 });
    const txt = await page.locator('body').innerText();
    if (/Could not load|unreachable|answered with an error|NaN|undefined/i.test(txt)) throw new Error('page not ready: ' + txt.slice(0, 400));
    await page.mouse.move(720, 30); // over the site header: no map hover
    await mapReady(page);
  };

  // ---- Main pass: the map, dpr 2 ----
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  await load(page);

  // The map area clear of the floating sidebar (412px wide) and the page header.
  const area = await page.evaluate(() => {
    const el = document.getElementById('deckgl-overlay').getBoundingClientRect();
    const side = document.querySelector('h1').closest('.rounded-xl').getBoundingClientRect();
    const x = Math.ceil(side.right + 16);
    return { x, y: Math.ceil(el.top), width: Math.floor(el.right - x), height: Math.floor(el.height), elLeft: el.left, elTop: el.top, elWidth: el.width, elHeight: el.height };
  });
  const clip = { x: area.x, y: area.y, width: area.width, height: area.height };

  const setView = async (vs) => {
    await page.evaluate((vs) => {
      const d = window.__cap.deck();
      const cur = d.getViewports()[0];
      const viewState = { longitude: cur.longitude, latitude: cur.latitude, zoom: cur.zoom, pitch: 0, bearing: 0, ...vs, transitionDuration: 0 };
      d.props.onViewStateChange({ viewState, interactionState: {}, viewId: 'default-view', oldViewState: null });
    }, vs);
    await sleep(500);
  };
  // Fit a lng/lat box inside the clear map area (Web-Mercator math against deck's 512-px world).
  const frame = async (bounds, pad = 0.04) => {
    const vs = await page.evaluate(({ area, bounds, pad }) => {
      const mx = (lng) => (lng + 180) / 360;
      const my = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
      const [[w, s], [e, n]] = bounds;
      const scale = Math.min(area.width * (1 - 2 * pad) / (mx(e) - mx(w)), area.height * (1 - 2 * pad) / (my(s) - my(n)));
      const rcx = area.x - area.elLeft + area.width / 2, rcy = area.y - area.elTop + area.height / 2;
      const cx = (mx(w) + mx(e)) / 2 + (area.elWidth / 2 - rcx) / scale, cy = (my(s) + my(n)) / 2 + (area.elHeight / 2 - rcy) / scale;
      return { longitude: cx * 360 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI, zoom: Math.log2(scale / 512) };
    }, { area, bounds, pad });
    await setView(vs);
    return vs;
  };

  const counts = (await page.locator('h1').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').innerText()).replace(/\s+/g, ' ');
  const views = [
    ['map-world.png', null, 'The map area right of the sidebar as the page frames it on load: every operator on, 30d, the whole network'],
    ['map-europe.png', EUROPE, 'The same area with the camera on Europe: dots of every operator, sized by packets delivered, over the labelled basemap'],
  ];
  for (const [file, bounds, describes] of views) {
    const vs = bounds ? await frame(bounds) : null;
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(400);
      await mapReady(page, 900);
      await shootRect(page, clip, P(theme, file));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await mapReady(page, 300);
    shots[file] = { dpr: 2, kind: 'crop', role: bounds ? 'anchor' : 'supporting', describes: `${describes}${vs ? ` (zoom ${vs.zoom.toFixed(2)})` : ''}. ${counts.slice(0, 200)}` };
  }

  // ---- Macro pass: the panels, dpr 3 ----
  const macro = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 3 });
  await load(macro);
  const filters = macro.locator('h1').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const rows = macro.locator('label:has(input[type="checkbox"])');
  if ((await rows.count()) < OPERATOR_ROWS) throw new Error('operator rows missing');
  const rowsRect = await macro.evaluate((n) => {
    const all = [...document.querySelectorAll('label')].filter((l) => l.querySelector('input[type="checkbox"]')).slice(0, n);
    const a = all[0].getBoundingClientRect();
    const b = all[all.length - 1].getBoundingClientRect();
    // The rows' own box: the list is clipped by its card, so nothing is added around it.
    return { x: Math.floor(a.left), y: Math.floor(a.top), width: Math.ceil(a.width), height: Math.floor(b.bottom - a.top) };
  }, OPERATOR_ROWS);
  const listBox = await macro.locator('label:has(input[type="checkbox"])').first().locator('xpath=..').boundingBox();
  if (rowsRect.y + rowsRect.height > listBox.y + listBox.height + 1) {
    // Fewer rows fit the list at this height: keep whole rows only.
    rowsRect.height = Math.floor(listBox.y + listBox.height - rowsRect.y);
    console.log('[operators] list shows fewer than', OPERATOR_ROWS, 'rows; cropped to', rowsRect.height, 'px');
  }
  const rowsText = (await rows.evaluateAll((els, n) => els.slice(0, n).map((e) => e.innerText.replace(/\s+/g, ' ')).join(' | '), OPERATOR_ROWS)).slice(0, 300);
  for (const theme of THEMES) {
    await macro.emulateMedia({ colorScheme: theme });
    await sleep(500);
    await shoot(macro, filters, P(theme, 'filters.png'));
    await shootRect(macro, rowsRect, P(theme, 'operators.png'));
  }
  shots['filters.png'] = { dpr: 3, kind: 'element', role: 'supporting', describes: `Macro (dpr 3): the filter card. ${counts.slice(0, 220)}` };
  shots['operators.png'] = { dpr: 3, kind: 'crop', role: 'print', describes: `Macro (dpr 3): the operator picker's first rows (switch, color, well-known name or OUI number, shown / all Hotspots, packets). ${rowsText}` };

  writeManifest(OUT, {
    slug: 'lorawan-traffic',
    route: ROUTE,
    wallet: 'None (network-wide public data; no wallet, no Hotspot hovered or clicked)',
    shots,
  });
});
