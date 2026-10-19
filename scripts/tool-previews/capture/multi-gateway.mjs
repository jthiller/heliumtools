// Add a Hotspot (/multi-gateway) — source captures for the landing-page preview art.
//
//   node capture/multi-gateway.mjs   (from scripts/tool-previews; frontend on BASE)
//   ONLY=detail,tooltip node capture/multi-gateway.mjs   (just those shots)
//
// Opens the live dashboard for one public EU868 gateway (no wallet), waits ~10
// minutes for the stream to fill the chart, hovers one device track and shoots
// light then dark into captures/multi-gateway/{light,dark}/, then rewrites
// captures/multi-gateway/manifest.json from the PNGs on disk (OUT_DIR overrides
// the directory). Nothing is clicked; the only input is the mouse hover. The
// landing card uses detail-band.png, packet-table.png and tooltip.png
// (previews/multi-gateway.js); a re-shoot moves the band and the rows, so
// re-check those rects after one.
//
// Approach: let the live stream fill the chart, then FREEZE the page at one
// real instant (Date.now pinned in the page, live worker broadcasts dropped
// on the main thread) so that:
//   - light and dark are pixel-identical snapshots of the same data,
//   - no new-packet pulse rings / ambient track-pulse bands are mid-animation
//     (every pulse is older than its duration before any shot),
//   - the freeze moment is chosen so the buffer span (now - earliest packet)
//     makes EventsBar's evenly spaced x-axis ticks land on whole minutes
//     ("5m ago, 4m ago, 3m ago, 2m ago, 1m ago, now").
// The freeze is a pause, not a fake: everything drawn is real data at that moment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { run, BASE } from '../lib.mjs';

const MAC = '647FDAFFFE02E8A7';
const ROUTE = `/multi-gateway?mac=${MAC}`;
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'captures', 'multi-gateway');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (name) => !ONLY || ONLY.has(name);

// Span windows (minutes) where 6 evenly spaced ticks all round to whole,
// evenly stepped minute labels (and the 1/5 tick is >= 60 s, so not "Ns ago").
// The backfill only covers ~3.5 min and most devices here uplink every 1-2 min,
// so the 10-minute window is the first one where a device track is long enough
// (~10 dots) for the hover band to read as a curve.
const ALL_WINDOWS = [[5.03, 5.40], [9.62, 10.38], [14.62, 15.38]];
const MIN_SPAN = 9; // minutes: skip the 5-minute window (tracks too short to read as a curve)
const WINDOWS = ALL_WINDOWS.filter(([, hi]) => hi > MIN_SPAN);

// Installed before page scripts: pinnable Date.now + a Worker wrapper that can
// drop live broadcasts (no requestId) while frozen. Also: spectrum "max" window.
const FREEZE_INIT = `(() => {
  const realNow = Date.now.bind(Date);
  window.__mg = { frozenNow: null, dropped: 0 };
  Date.now = () => (window.__mg.frozenNow != null ? window.__mg.frozenNow : realNow());
  const RW = window.Worker;
  class W extends RW {
    set onmessage(fn) {
      const wrapped = typeof fn === 'function' ? function (e) {
        const d = e && e.data;
        if (window.__mg.frozenNow != null && d && d.requestId == null && d.type !== 'worker_error') { window.__mg.dropped++; return; }
        return fn.call(this, e);
      } : fn;
      super.onmessage = wrapped;
    }
    get onmessage() { return super.onmessage; }
  }
  window.Worker = W;
  try { localStorage.setItem('multi-gateway:spectrum-timeframe', 'max'); } catch {}
})();`;

// In-page helpers (installed once per page after load; no reloads happen).
function installHelpers() {
  const H = {};
  H.host = () => document.querySelector('.flex-\\[7\\] > [data-chart-host]');
  H.props = () => {
    const canvas = H.host()?.querySelector('canvas');
    if (!canvas) return null;
    const fk = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$'));
    let f = canvas[fk];
    while (f && !(f.memoizedProps && f.memoizedProps.tracksById && f.memoizedProps.packets)) f = f.return;
    return f ? f.memoizedProps : null;
  };
  // PacketScatter's seenRef ({pulses, trackPulses}) via its hook list.
  H.seen = () => {
    const canvas = H.host()?.querySelector('canvas');
    if (!canvas) return null;
    const fk = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$'));
    let f = canvas[fk];
    while (f && !(f.memoizedProps && f.memoizedProps.tracksById)) f = f.return;
    let h = f?.memoizedState;
    while (h) {
      const v = h.memoizedState;
      if (v && v.current && v.current.trackPulses instanceof Map) return v.current;
      h = h.next;
    }
    return null;
  };
  H.span = () => {
    const p = H.props();
    if (!p || !p.xDomain) return null;
    return (Date.now() - p.xDomain[0]) / 60000;
  };
  // Mirror PacketScatter's scales (buildScales) for the current layout.
  H.geom = () => {
    const host = H.host();
    const canvas = host.querySelector('canvas');
    const props = H.props();
    const pts = props.packets.filter((p) => p._trackId && p._trackId !== 'joins' && p._trackId !== 'downlinks');
    let yMin = Infinity, yMax = -Infinity;
    for (const p of pts) { if (p.rssi < yMin) yMin = p.rssi; if (p.rssi > yMax) yMax = p.rssi; }
    yMin -= 3; yMax += 3;
    const r = canvas.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const w = r.width, h = r.height;
    const xLeft = w < 640 ? 68 : 78, xRight = w - 16, yTop = 8, yBottom = h;
    const xMin = props.xDomain[0], xMax = Date.now();
    const xs = (v) => xLeft + ((v - xMin) / (xMax - xMin)) * (xRight - xLeft);
    const ys = (v) => yTop + (1 - (v - yMin) / (yMax - yMin)) * (yBottom - yTop);
    return { pts, w, h, xLeft, xRight, xs, ys, cl: r.left, ct: r.top, offX: r.left - hr.left, offY: r.top - hr.top, hostW: hr.width, hostH: hr.height };
  };
  H.find = (key) => {
    const g = H.geom();
    const p = g.pts.find((q) => q.dev_addr === key.devAddr && q.fcnt === key.fcnt && q.timestamp === key.ts);
    if (!p) return null;
    return { x: g.cl + g.xs(p.timestamp), y: g.ct + g.ys(p.rssi), track: p._trackId };
  };
  // Rank (track, hovered dot) pairs. The tooltip opens to the RIGHT of the
  // hovered dot (dots left of 50% of the plot), so it should sit over as few of
  // that track's own dots/FCnt labels as possible (the panel is translucent and
  // labels show through) and leave the band's swing visible on either side.
  // No dot of the track may sit within 20 px of the y-axis, where its FCnt
  // label would collide with the "-80 dBm" axis labels. ttW/ttH ~ tooltip box.
  H.rank = ({ ttW = 200, ttH = 142 } = {}) => {
    const g = H.geom();
    const byTrack = new Map();
    for (const p of g.pts) { if (!byTrack.has(p._trackId)) byTrack.set(p._trackId, []); byTrack.get(p._trackId).push(p); }
    const plotW = g.xRight - g.xLeft;
    const out = [];
    for (const [id, arr] of byTrack) {
      if (arr.length < 5) continue;
      arr.sort((a, b) => a.timestamp - b.timestamp);
      const xs = arr.map((p) => g.xs(p.timestamp));
      const ysv = arr.map((p) => g.ys(p.rssi));
      const f0 = (xs[0] - g.xLeft) / plotW, f1 = (xs[xs.length - 1] - g.xLeft) / plotW;
      if (f1 - f0 < 0.6) continue;
      const axisCrowd = xs.some((x) => x < g.xLeft + 20);
      arr.forEach((h, hi) => {
        const fx = xs[hi], fy = ysv[hi];
        // HoverTooltip flips to the dot's left past 65% of the host width.
        const flip = fx + g.offX > g.hostW * 0.65;
        const L = flip ? fx - 12 - ttW : fx + 12, R = L + ttW;
        const T = Math.max(0, fy + g.offY - 48) - g.offY, B = T + ttH;
        const isCovered = arr.map((p, i) => {
          if (i === hi) return false;
          const x = xs[i], y = ysv[i];
          return x >= L - 16 && x <= R + 16 && y >= T - 16 && y <= B + 6;
        });
        const covered = isCovered.filter(Boolean).length;
        // Swing (sum of |dRSSI| between consecutive dots) left in view vs hidden.
        let visSwing = 0, hidSwing = 0, jump = 0, vmin = Infinity, vmax = -Infinity;
        arr.forEach((p, i) => {
          if (!isCovered[i]) { vmin = Math.min(vmin, p.rssi); vmax = Math.max(vmax, p.rssi); }
          if (!i) return;
          const d = Math.abs(p.rssi - arr[i - 1].rssi);
          if (isCovered[i] || isCovered[i - 1]) hidSwing += d;
          else { visSwing += d; jump = Math.max(jump, d); }
        });
        const drama = vmax - vmin;
        const spill = Math.max(0, B + g.offY - g.hostH);
        let clear = Infinity;
        for (const p of g.pts) if (p._trackId !== id) clear = Math.min(clear, Math.hypot(g.xs(p.timestamp) - fx, g.ys(p.rssi) - fy));
        const score = arr.length + (f1 - f0) * 10 + Math.min(visSwing, 60) * 0.5 + Math.min(drama, 24) * 0.3 + Math.min(jump, 14) * 0.3
          - hidSwing * 0.6 - covered * 8 - (axisCrowd ? 8 : 0) - spill * 0.5 - (clear < 3 ? 100 : 0);
        out.push({ id, n: arr.length, hi, flip, f0: +f0.toFixed(2), f1: +f1.toFixed(2), drama, jump, visSwing, hidSwing, covered, axisCrowd, spill: Math.round(spill), clear: Math.round(clear * 10) / 10, score: Math.round(score * 10) / 10, netId: h._netId, key: { devAddr: h.dev_addr, fcnt: h.fcnt, ts: h.timestamp } });
      });
    }
    return out.sort((a, b) => b.score - a.score);
  };
  H.tip = () => {
    const el = H.host()?.querySelector(':scope > div.pointer-events-none.absolute.z-20');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.innerText, x: r.left, y: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  H.ticks = () => [...document.querySelectorAll('.flex-\\[7\\] svg text')].map((t) => t.textContent).filter((s) => /ago|now/.test(s));
  window.__mgh = H;
}

const sel = {
  kpis: 'main > dl.grid.grid-cols-2',
  gatewayTable: 'main > div.-mx-4.overflow-hidden',
  inspector: 'div.-mx-4.mt-4.bg-surface-raised',
  charts: 'div.-mx-4.mt-4.bg-surface-raised > div.flex.flex-col.sm\\:flex-row',
  scatterCol: 'div.-mx-4.mt-4.bg-surface-raised > div.flex.flex-col.sm\\:flex-row > div:first-child',
  spectrumCol: 'div.-mx-4.mt-4.bg-surface-raised > div.flex.flex-col.sm\\:flex-row > div:last-child',
  // The table's box has a stable hook: its overflow class switches with width.
  packetTable: 'div.-mx-4.mt-4.bg-surface-raised [data-packet-table]',
};
const TALL_CSS = `.flex-\\[7\\] > [data-chart-host]{height:400px!important}`;
const HIDE_TIP_CSS = `.flex-\\[7\\] > [data-chart-host] > div.pointer-events-none.absolute.z-20{visibility:hidden!important}`;
// The scatter's NetID legend buttons take the pointer (they switch NetIDs);
// the hover shots move straight onto a dot, which can sit under one, so they
// pass the pointer through here. The legend is faded while a track is hovered.
const NOISE_CSS = `vite-error-overlay{display:none!important}
[data-chart-host] > ul[aria-label="NetIDs on the chart"] button{pointer-events:none!important}`;

await run(async ({ newPage, settle, shoot, shootRect, sleep }) => {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2, initScript: FREEZE_INIT });
  const macro = (want('detail') || want('tooltip')) ? await newPage({ colorScheme: 'light', width: 1180, height: 900, dpr: 3, initScript: FREEZE_INIT }) : null;
  const pages = [page, macro].filter(Boolean);
  for (const p of pages) p.on('response', (r) => { if (r.status() === 429) console.log('[429]', r.url().slice(0, 140)); });

  // Load both at once so they accumulate the same live stream.
  await Promise.all(pages.map((p) => p.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' })));
  await settle(page, 2500);
  for (const p of pages) {
    await p.waitForSelector('.flex-\\[7\\] > [data-chart-host] canvas', { timeout: 90000 });
    await p.addStyleTag({ content: NOISE_CSS });
    await p.evaluate(installHelpers);
  }

  // Wait for a span window, then freeze. Each page freezes on its own clock.
  async function waitAndFreeze(p, label) {
    let win = null;
    let lastLog = 0;
    for (;;) {
      const s = await p.evaluate(() => window.__mgh.span());
      if (s == null) { await sleep(1000); continue; }
      if (!win) {
        win = WINDOWS.find(([, hi]) => hi > s + 0.05);
        console.log(`[${label}] span at start ${s.toFixed(2)} min -> target window ${win}`);
      }
      if (Date.now() - lastLog > 20000) {
        lastLog = Date.now();
        const info = await p.evaluate(() => ({ n: window.__mgh.props().packets.length, head: document.querySelector('h3')?.parentElement?.innerText.replace(/\n/g, ' ') }));
        console.log(`[${label}] span ${s.toFixed(2)} min, ${info.n} packets | ${info.head}`);
      }
      if (s >= win[0] && s <= win[1]) {
        const r = await p.evaluate(() => {
          const props = window.__mgh.props();
          let maxTs = -Infinity;
          for (const q of props.packets) if (q.timestamp > maxTs) maxTs = q.timestamp;
          const now = Date.now();
          window.__mg.frozenNow = Math.max(now, maxTs + 250);
          return { frozenNow: window.__mg.frozenNow, span: window.__mgh.span(), skew: maxTs - now };
        });
        console.log(`[${label}] FROZEN at span ${r.span.toFixed(3)} min (latest packet skew ${r.skew} ms)`);
        if (r.span < win[0] || r.span > win[1]) console.log(`[${label}] WARNING: span drifted out of window`);
        return r;
      }
      if (s > win[1]) { win = null; continue; }
      await sleep(s < win[0] - 0.1 ? 2000 : 150);
    }
  }
  await Promise.all(pages.map((p, i) => waitAndFreeze(p, i === 0 ? 'main' : 'macro')));
  await sleep(3500); // every pulse (700 ms dots, 2 s track bands, 1.5 s row flash) has expired
  const facts = { head: '', tip: '', target: null };

  for (const [i, p] of pages.entries()) {
    const st = await p.evaluate(() => {
      const s = window.__mgh.seen();
      const now = performance.now();
      const ages = (m) => [...(m?.entries() ?? [])].map(([, t]) => Math.round(now - t));
      return { ticks: window.__mgh.ticks(), dropped: window.__mg.dropped, pulseAges: ages(s?.pulses), trackPulseAges: ages(s?.trackPulses), head: document.querySelector('h3')?.parentElement?.innerText.replace(/\n/g, ' ') };
    });
    if (!i) facts.head = st.head;
    console.log(`[${i ? 'macro' : 'main'}] ticks=${JSON.stringify(st.ticks)} dropped=${st.dropped} pulses=${JSON.stringify(st.pulseAges)} trackPulses=${JSON.stringify(st.trackPulseAges)} | ${st.head}`);
  }

  // ---------- pick the hover target (native layout on the main page) ----------
  await page.locator(sel.charts).scrollIntoViewIfNeeded();
  await sleep(300);
  let ranked = await page.evaluate(() => window.__mgh.rank());
  console.log('ranked (native):', JSON.stringify(ranked.slice(0, 6)));
  let target = ranked[0];
  if (!target) throw new Error('no hover candidate');

  async function hover(p, key, { settleMs = 650 } = {}) {
    await p.mouse.move(2, 2);
    await sleep(420);
    const t = await p.evaluate((key) => window.__mgh.find(key), key);
    if (!t) throw new Error('hover key not found ' + JSON.stringify(key));
    await p.mouse.move(t.x, t.y);
    await sleep(settleMs);
    const tip = await p.evaluate(() => window.__mgh.tip());
    const ok = tip && tip.text.includes(key.devAddr) && tip.text.includes(String(key.fcnt));
    if (!ok) throw new Error('hover miss: ' + (tip ? tip.text.split('\n')[0] : 'no tooltip'));
    return { ...t, tip };
  }
  const unhover = async (p) => { await p.mouse.move(2, 2); await sleep(450); };

  // Measure the real tooltip and re-rank with its size.
  {
    const h = await hover(page, target.key);
    facts.tip = h.tip.text.replace(/\n/g, ' ');
    console.log('tooltip size', Math.round(h.tip.width), 'x', Math.round(h.tip.height), '|', h.tip.text.replace(/\n/g, ' '));
    ranked = await page.evaluate((sz) => window.__mgh.rank(sz), { ttW: h.tip.width, ttH: h.tip.height });
    console.log('re-ranked (native):', JSON.stringify(ranked.slice(0, 4)));
    // Check the leader in the tall (400px) layout too.
    const tall = await page.addStyleTag({ content: TALL_CSS });
    await sleep(500);
    const rankedTall = await page.evaluate((sz) => window.__mgh.rank(sz), { ttW: h.tip.width, ttH: h.tip.height });
    await tall.evaluate((el) => el.remove());
    await sleep(500);
    const k = (r) => `${r.key.devAddr}:${r.key.fcnt}:${r.key.ts}`;
    const tallByKey = new Map(rankedTall.map((r) => [k(r), r]));
    const both = ranked.filter((r) => r.spill === 0 && tallByKey.get(k(r))?.clear >= 3).sort((a, b) => (b.score + tallByKey.get(k(b)).score) - (a.score + tallByKey.get(k(a)).score));
    target = both[0] ?? ranked[0];
    console.log('TARGET', JSON.stringify(target), 'tall:', JSON.stringify(tallByKey.get(k(target))));
    console.log('runners-up', JSON.stringify(both.slice(1, 4)));
    facts.target = target;
    await unhover(page);
  }

  const PAD = 18;
  const padded = (b, pad = PAD) => ({ x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad });
  const boxOf = (p, selector) => p.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
  }, selector);
  const vbox = (p, selector) => p.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  }, selector);
  // Viewport-relative clip (no fullPage), so the stationary mouse keeps its hover.
  const shootClip = (p, r, outPath) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    return p.screenshot({ path: outPath, clip: r, animations: 'disabled', caret: 'hide', timeout: 30000 });
  };

  // Rects computed once (frozen page => identical geometry in both themes).
  let viewportY = null, heroRect = null, detailRect = null;

  for (const theme of ['light', 'dark']) {
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });
    for (const p of pages) await p.emulateMedia({ colorScheme: theme });
    await sleep(1200);
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log(`--- ${theme} (body bg ${dark})`);

    // ===== native layout =====
    await unhover(page);
    if (want('full')) {
      // The packet table runs at its full height in the page (hundreds of
      // rows, mostly virtualization spacer), so cut it to its first 15 rows
      // for the full-page shot, then restore it.
      await page.evaluate((sel) => {
        const el = document.querySelector(sel.packetTable);
        const top = el.getBoundingClientRect().top;
        const rows = [...el.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length > 3);
        const h = Math.ceil(rows[Math.min(14, rows.length - 1)].getBoundingClientRect().bottom - top);
        el.dataset.prevStyle = el.getAttribute('style') || '';
        el.style.maxHeight = `${h}px`;
        el.style.height = `${h}px`;
        el.style.overflow = 'hidden';
        window.scrollTo(0, 0);
      }, sel);
      await sleep(400);
      await shoot(page, 'full', path.join(dir, 'full.png'));
      await page.evaluate((sel) => {
        const el = document.querySelector(sel.packetTable);
        el.setAttribute('style', el.dataset.prevStyle || '');
      }, sel);
    }
    if (want('kpis')) await shootRect(page, padded(await boxOf(page, sel.kpis)), path.join(dir, 'kpis.png'));
    if (want('gateway-table')) await shootRect(page, padded(await boxOf(page, sel.gatewayTable)), path.join(dir, 'gateway-table.png'));
    if (want('packet-table')) {
      const r = await page.evaluate((sel) => {
        const el = document.querySelector(sel.packetTable);
        el.scrollTop = 0;
        const b = el.getBoundingClientRect();
        const bottoms = [...el.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length > 3).map((tr) => tr.getBoundingClientRect().bottom).filter((y) => y - b.top <= 540);
        const bottom = bottoms[bottoms.length - 1];
        return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: Math.round(bottom - b.top) };
      }, sel);
      await shootRect(page, r, path.join(dir, 'packet-table.png'));
    }
    if (want('charts')) {
      await page.locator(sel.charts).scrollIntoViewIfNeeded();
      await sleep(300);
      await unhover(page);
      await shoot(page, sel.charts, path.join(dir, 'charts.png'));
    }
    if (want('scatter')) {
      await page.locator(sel.charts).scrollIntoViewIfNeeded();
      await sleep(300);
      await hover(page, target.key);
      await shootClip(page, await vbox(page, sel.scatterCol), path.join(dir, 'scatter.png'));
      await unhover(page);
    }
    if (want('viewport')) {
      if (viewportY == null) {
        viewportY = await page.evaluate((sel) => {
          const c = document.querySelector(sel.charts).getBoundingClientRect().bottom + scrollY;
          const wantY = c + 28 - innerHeight;
          const rows = [...document.querySelectorAll(`${sel.gatewayTable} tbody tr`)].map((r) => r.getBoundingClientRect().top + scrollY);
          const snap = rows.find((t) => t >= wantY);
          return Math.max(0, Math.round(snap ?? wantY));
        }, sel);
      }
      await page.evaluate((y) => window.scrollTo(0, y), viewportY);
      await sleep(400);
      await hover(page, target.key);
      await shoot(page, 'viewport', path.join(dir, 'viewport.png'));
      await unhover(page);
    }

    // ===== tall layout: hero family + spectrum =====
    if (want('hero') || want('spectrum')) {
      const tall = await page.addStyleTag({ content: `${TALL_CSS} ${sel.gatewayTable}{visibility:hidden!important}` });
      // Cap the packet table at its first 3 rows so the card closes with its own bottom edge.
      await page.evaluate((sel) => {
        const el = document.querySelector(sel.packetTable);
        el.scrollTop = 0;
        const top = el.getBoundingClientRect().top;
        const rows = [...el.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length > 3);
        const h = Math.ceil(rows[2].getBoundingClientRect().bottom - top);
        el.dataset.prevStyle = el.getAttribute('style') || '';
        el.style.maxHeight = `${h}px`;
        el.style.height = `${h}px`;
        el.style.overflow = 'hidden';
      }, sel);
      await sleep(700);
      await page.evaluate((sel) => {
        const b = document.querySelector(sel.inspector).getBoundingClientRect();
        window.scrollTo(0, b.top + scrollY - 60);
      }, sel);
      await sleep(500);
      if (want('spectrum')) {
        const pill = await page.addStyleTag({ content: `[role="group"][aria-label="Time window"]{visibility:hidden!important}` });
        await sleep(200);
        await shootClip(page, await vbox(page, sel.spectrumCol), path.join(dir, 'spectrum.png'));
        await pill.evaluate((el) => el.remove());
      }
      if (want('hero')) {
        if (!heroRect) {
          const b = await vbox(page, sel.inspector);
          heroRect = { x: Math.round(b.x - PAD), y: Math.round(b.y - PAD), width: Math.round(b.width + 2 * PAD), height: Math.round(b.height + 2 * PAD) };
          console.log('hero rect', JSON.stringify(heroRect));
        }
        await unhover(page);
        await shootClip(page, heroRect, path.join(dir, 'hero-clean.png'));
        const h = await hover(page, target.key);
        console.log(`[${theme}] hero hover`, h.tip.text.split('\n').slice(0, 4).join(' | '));
        await shootClip(page, heroRect, path.join(dir, 'hero.png'));
        const hide = await page.addStyleTag({ content: HIDE_TIP_CSS });
        await sleep(250);
        await shootClip(page, heroRect, path.join(dir, 'hero-band.png'));
        await hide.evaluate((el) => el.remove());
        await unhover(page);
      }
      await tall.evaluate((el) => el.remove());
      await page.evaluate((sel) => {
        const el = document.querySelector(sel.packetTable);
        el.setAttribute('style', el.dataset.prevStyle || '');
      }, sel);
      await sleep(500);
    }

    // ===== macro page (dpr 3): detail, band-only detail, tooltip fragment =====
    if (macro) {
      const tall = await macro.addStyleTag({ content: TALL_CSS });
      await sleep(600);
      await macro.locator(sel.charts).scrollIntoViewIfNeeded();
      await sleep(400);
      const h = await hover(macro, target.key);
      console.log(`[${theme}] macro hover`, h.tip.text.split('\n').slice(0, 4).join(' | '));
      if (!detailRect) {
        detailRect = await macro.evaluate(({ track }) => {
          const H = window.__mgh;
          const host = H.host();
          const col = host.parentElement.getBoundingClientRect();
          const hb = host.getBoundingClientRect();
          const g = H.geom();
          const tip = H.tip();
          const labelXs = g.pts.filter((p) => p._trackId === track).map((p) => g.cl + g.xs(p.timestamp));
          const tickBoxes = [...host.parentElement.querySelectorAll('svg text')].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
          const ok = (x) => labelXs.every((c) => Math.abs(c - x) > 20) && tickBoxes.every((r) => x < r.left - 8 || x > r.right + 8);
          // Keep the whole hovered track (its swing) in frame, then end between dots/labels.
          const lastX = Math.max(...labelXs);
          let target = Math.min(col.right, Math.max(tip.right + 250, lastX + 40, col.left + 640));
          let cut = null;
          for (let d = 0; d < 260 && cut == null; d += 2) {
            if (target + d <= col.right && ok(target + d)) cut = target + d;
            else if (ok(target - d)) cut = target - d;
          }
          cut = cut ?? col.right;
          return { x: Math.round(col.left), y: Math.round(hb.top), width: Math.round(cut - col.left), height: Math.round(col.bottom - hb.top) };
        }, { track: h.track });
        console.log('detail rect', JSON.stringify(detailRect));
      }
      if (want('detail')) {
        await shootClip(macro, detailRect, path.join(dir, 'detail.png'));
        const hide = await macro.addStyleTag({ content: HIDE_TIP_CSS });
        await sleep(250);
        await shootClip(macro, detailRect, path.join(dir, 'detail-band.png'));
        await hide.evaluate((el) => el.remove());
      }
      if (want('tooltip')) {
        // The real tooltip alone: chart canvas made transparent (still hit-testable,
        // so the hover holds) so the panel sits on the plain card surface.
        const clear = await macro.addStyleTag({ content: `.flex-\\[7\\] > [data-chart-host] > canvas{opacity:0!important}` });
        await sleep(300);
        const tip = await macro.evaluate(() => window.__mgh.tip());
        if (!tip) throw new Error('tooltip vanished');
        await shootClip(macro, { x: Math.round(tip.x - 16), y: Math.round(tip.y - 14), width: Math.round(tip.width + 32), height: Math.round(tip.height + 30) }, path.join(dir, 'tooltip.png'));
        await clear.evaluate((el) => el.remove());
      }
      await unhover(macro);
      await tall.evaluate((el) => el.remove());
    }
  }
  for (const [i, p] of pages.entries()) {
    const d = await p.evaluate(() => ({ dropped: window.__mg.dropped, ticks: window.__mgh.ticks() }));
    console.log(`[${i ? 'macro' : 'main'}] end: dropped ${d.dropped} live broadcasts while frozen; ticks ${JSON.stringify(d.ticks)}`);
  }
  await writeManifest(facts);
}, { timeoutMs: 20 * 60 * 1000 });

// manifest.json from the PNGs on disk (cssWidth x cssHeight is how the bake
// derives each shot's dpr) plus what this run saw.
async function writeManifest({ head, tip, target }) {
  const devices = (head.match(/(\d+) devices/) || [])[1];
  const fc = target.key.fcnt;
  const trackLbl = `${target.netId} · ${target.key.devAddr} · ${target.id}`;
  const band = `one device track (${trackLbl}, ${target.n} uplinks) hovered at its newest dot FCnt ${fc}: shaded Catmull-Rom SNR band through its FCnt-labelled dots, other uplinks dimmed`;
  const DPR3 = new Set(['detail.png', 'detail-band.png', 'tooltip.png']);
  const SPEC = {
    'hero.png': ['hero', 'element-crop', `Whole Hotspot inspector card for gateway "Curved Canvas Trout" (EU868, ${devices} devices of live uplinks): header, NetID/Device/frame-type filter rows, RSSI-over-time scatter (plot raised to 400px) with ${band} and the packet tooltip; joins events bar; whole-minute x-axis to "now"; spectrum waterfall (EU868 867.1-868.5 MHz, hovered packet highlighted, others dimmed); first 3 rows of the live packet table, card closed with its own rounded bottom edge and shadow.`],
    'hero-band.png': ['supporting', 'element-crop', `Same frame as hero.png with the hover held but the tooltip hidden: the full ${band}, for layering the tooltip fragment (tooltip.png) separately.`],
    'hero-clean.png': ['supporting', 'element-crop', 'Same frame as hero.png with no hover: the dense, saturated multicolor field of every uplink colored by NetID family, full-brightness spectrum waterfall, joins bar, packet rows.'],
    'charts.png': ['supporting', 'element-crop', 'Chart row at native height, no hover: dense multicolor RSSI scatter, joins markers, whole-minute time axis to "now", plus the spectrum waterfall with its 1m/max window pill.'],
    'scatter.png': ['supporting', 'element-crop', `RSSI scatter + joins events bar alone at native height with the hover: ${band}, and the packet tooltip.`],
    'spectrum.png': ['supporting', 'element-crop', 'Spectrum waterfall as a portrait fragment (no hover, 1m/max pill hidden): every packet a colored tick at its EU868 channel, stacked by time, opacity by RSSI, frequency labels along the bottom.'],
    'packet-table.png': ['supporting', 'element-crop', 'Top of the live packet table: time ago, frame-type icon, NetID/operator, DevAddr, Helium OUI, FCnt, FPort, RSSI, SNR, frequency, SF/BW and size in monospace. Join Request rows show dashes (joins carry no DevAddr/FCnt); other dashes are non-Helium traffic with no Helium OUI.'],
    'gateway-table.png': ['supporting', 'element-crop', 'Gateway list card: gateways with connection dots, US915/EU868/AU915 region pills, MACs, animal-name public keys, uptime, last uplink, uplink/downlink counters and on-chain checkmarks; the inspected gateway row highlighted.'],
    'kpis.png': ['supporting', 'element-crop', 'Fleet totals set on the page (no cards), split by hairlines: Total Gateways, Connected, Uplinks, Downlinks.'],
    'viewport.png': ['backdrop', 'viewport', 'The dashboard at 1440x960: lower gateway list (selected row highlighted) above the inspector card with the hovered RSSI scatter (band + tooltip), events bar and spectrum waterfall, ending at the packet-table header.'],
    'full.png': ['backdrop', 'full-page', 'Whole Multi-Gateway page, no hover: site header, the page title with its "Add a Hotspot" button (setup panel closed), fleet totals, gateway list, inspector card (scatter with its floating NetID legend + events bar + spectrum) and the live packet table cut to its first 15 rows.'],
    'detail.png': ['detail', 'macro', `dpr-3 macro of the scatter hover: y-axis, ${band}, the packet tooltip (${tip}), joins lane and the whole time axis to "now"; spans the full scatter column so the entire track is in frame.`],
    'detail-band.png': ['detail', 'macro', 'Same dpr-3 rect as detail.png with the hover held and the tooltip hidden: the band alone with its FCnt labels.'],
    'tooltip.png': ['detail', 'macro', `The real scatter tooltip alone at dpr 3 (chart canvas made transparent underneath so it sits on the plain card surface, soft shadow included): ${tip}.`],
  };

  const shots = [];
  for (const theme of ['light', 'dark']) {
    for (const [file, [role, kind, describes]] of Object.entries(SPEC)) {
      const p = path.join(OUT, theme, file);
      if (!fs.existsSync(p)) { console.log('missing', theme, file); continue; }
      const m = await sharp(p).metadata();
      const dpr = DPR3.has(file) ? 3 : 2;
      shots.push({ file: `${theme}/${file}`, theme, kind, describes, cssWidth: Math.round(m.width / dpr), cssHeight: Math.round(m.height / dpr), dpr, role });
    }
  }
  const manifest = {
    slug: 'multi-gateway',
    route: ROUTE,
    wallet: null,
    notes: [
      `Live production data via the Vite dev proxy for gateway ${MAC} (EU868): the backfill plus the live WebSocket stream until the span window below (${head}). No wallet needed; nothing was clicked beyond hovering.`,
      'The page was FROZEN at one real instant before any shot: an init script pins Date.now and drops live worker broadcasts on the main thread, so light and dark are identical snapshots of the same data (same hovered FCnt, same band, same tooltip position, same table rows) and no new-packet pulse ring, ambient track-pulse band or row flash is mid-animation (all pulses had expired before the first shot).',
      'The freeze moment falls inside one of the span windows in WINDOWS: EventsBar spaces its 6 ticks evenly over the span and formatTimeTick rounds to whole minutes, so inside those windows the axis reads in even whole-minute steps with no skipped label (the app does not snap ticks itself; other spans produce uneven labels).',
      `Hover target picked automatically for the most visible RSSI swing with the fewest of the track's own dots under the app's 90%-opaque tooltip: FCnt ${fc}, the newest dot of ${trackLbl}, so the tooltip covers as little of the track's swing as possible (covered labels show faintly through the panel, as in the app). hero-band.png / detail-band.png hold the same hover with the tooltip hidden, tooltip.png is the tooltip alone, hero-clean.png is the same 400px framing without hover (saturated field).`,
      'Framing aids (no invented UI): scatter plot host raised 256px -> 400px for hero*/spectrum/detail*; packet table capped to its first 3 rows in hero* so the card ends with its own bottom edge; gateway list visibility-hidden during hero* so its shadow does not bleed in; spectrum 1m/max pill hidden in spectrum.png only; spectrum window set to its shipped "max" option via localStorage; any Vite dev error overlay hidden.',
      'Dashes in the Helium OUI column are real values (non-Helium traffic has no Helium OUI).',
    ].join(' '),
    shots,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote', shots.length, 'shots');
}
