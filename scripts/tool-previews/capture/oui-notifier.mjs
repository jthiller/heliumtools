// OUI Notifier (/oui-notifier/) — source captures for the landing-page preview art.
//
//   node capture/oui-notifier.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/oui-notifier/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses hero.png (previews/oui-notifier.js).
//
// Looks up OUI 6 (HeyIoT.xyz in helium/well-known: an active escrow burning ~$5/day
// with a mid-month top-up, so the 30-day chart reads as a clear burn-down sawtooth).
// Page A (dpr 2): every crop in light, then flipped to dark with emulateMedia
// (useDarkMode re-reads the recharts colors on the media change), same load. Then the
// same page re-types the OUI to 12 (a long 27-day drawdown and a late top-up) for an
// alternate hero.
// Page B (dpr 3): the hovered-chart macro (detail.png) in both themes.
//
// Hover geometry (measured at the 1100px viewport: plot 600x125 CSS, 20.7px per day).
// Recharts anchors the tooltip 10px right of the snapped point, with its top 10px below
// the pointer (flipped above the pointer when it would overflow the plot bottom).
//  - hero: pointer at the top of the plot over 9/24 (index 9) on the first burn-down, so the
//    tooltip floats in the empty space above the descending line (~19px clear of it).
//  - detail: pointer at the bottom of the plot over the top-up peak (index 17), so the
//    tooltip lands in the fill under the plateau line, right of the spike. (Hovering the
//    trough instead anchors the tooltip 10px right of it, on top of the rising spike.)
//
// Read-only: only the OUI, Label and Webhook inputs are typed into (label/webhook are
// cleared again right after their crop); nothing is clicked or submitted; no email is typed.
// No wallet is connected.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/oui-notifier/', import.meta.url));
const OUI = '6';
const ALT_OUI = '12';
const POINTS = 30;               // /balance returns one point per day for 30 days
const HERO_INDEX = 9;            // 9/24, on the first burn-down
const DETAIL_INDEX = 17;         // 10/2, the top-up peak
const ALT_INDEX = 18;            // OUI 12: 10/3, mid drawdown
const FAKE_LABEL = 'HeyIoT prod';
const FAKE_WEBHOOK = 'https://hooks.example.com/dc-alerts';
const shots = [];

await run(async ({ newPage, settle, shoot, sleep }) => {
  // ---------- helpers ----------
  const mainText = (page) => page.evaluate(() => document.querySelector('main').innerText);
  const ready = () => {
    const t = document.querySelector('main').innerText;
    return !!document.querySelector('.recharts-area-area') && /\$\d/.test(t) && /at \$[\d.,]+\/day/.test(t) && !/—/.test(t.split('ESCROW ACCOUNT')[0]);
  };
  async function tag(page) {
    await page.evaluate(() => {
      const chartCard = document.querySelector('.recharts-wrapper').closest('.rounded-xl');
      chartCard.setAttribute('data-cap', 'chart');
      document.querySelector('main .grid.sm\\:grid-cols-2.gap-px').setAttribute('data-cap', 'metrics');
      chartCard.nextElementSibling.setAttribute('data-cap', 'account');
      document.querySelector('aside > div').setAttribute('data-cap', 'subscribe');
      document.querySelector('label[for=oui]').parentElement.setAttribute('data-cap', 'lookup');
    });
  }
  async function lookup(page) {
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) console.log('[resp]', r.status(), r.url().slice(0, 120));
    });
    for (let attempt = 1; ; attempt++) {
      await page.goto(`${BASE}/oui-notifier/`, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForFunction(() => document.querySelectorAll('#oui-options option').length > 10, null, { timeout: 30000 });
        await page.fill('#oui', OUI);
        await page.waitForSelector('.recharts-area-area', { timeout: 30000 });
        await page.waitForFunction(ready, null, { timeout: 30000 });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        console.log('lookup not ready, waiting 45s and retrying:', String(e).slice(0, 120));
        await sleep(45000);
      }
    }
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await settle(page, 2000);
    await tag(page);
    // Hide-on-demand: neighbours of a crop get visibility:hidden (layout unchanged).
    await page.addStyleTag({ content: 'html.cap-solo [data-cap=lookup], html.cap-solo [data-cap=account] { visibility: hidden !important; }' });
  }
  const box = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height };
  }, sel);
  const union = (...bs) => {
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    const r = Math.max(...bs.map((b) => b.x + b.width)), btm = Math.max(...bs.map((b) => b.y + b.height));
    return { x, y, width: r - x, height: btm - y };
  };
  const pad = (b, p, py = p) => ({ x: Math.round(b.x - p), y: Math.round(b.y - py), width: Math.round(b.width + 2 * p), height: Math.round(b.height + 2 * py) });
  function record(file, meta, w, h) {
    shots.push({ file: path.relative(OUT, file), ...meta, cssWidth: Math.round(w), cssHeight: Math.round(h) });
  }
  // Viewport-relative clip after scrolling the region into view (no fullPage resize,
  // so the recharts hover state survives).
  async function rect(page, r, file, meta) {
    // Only scroll when the region is not already fully in view: a scroll moves the
    // content under a parked mouse and would drop an active chart hover.
    const inView = await page.evaluate((q) => q.y >= scrollY && q.y + q.height <= scrollY + innerHeight, r);
    if (!inView) {
      await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, r.y - 40));
      await sleep(250);
    }
    const sy = await page.evaluate(() => scrollY);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, clip: { x: r.x, y: r.y - sy, width: r.width, height: r.height }, animations: 'disabled', caret: 'hide' });
    record(file, meta, r.width, r.height);
  }
  // Plot area (the data min..max band; the y domain is dataMin..dataMax), viewport + page coords.
  const plot = (page) => page.evaluate(() => {
    const s = document.querySelector('.recharts-surface').getBoundingClientRect();
    const c = document.querySelector('.recharts-area-curve').getBBox();
    return { vx: s.x + c.x, vy: s.y + c.y, x: s.x + c.x + scrollX, y: s.y + c.y + scrollY, width: c.width, height: c.height, sBottom: s.y + s.height + scrollY, sRight: s.x + s.width + scrollX };
  });
  const xAt = (p, i) => p.x + (i / (POINTS - 1)) * p.width;
  // Hover the point at `index` with the pointer at `yFrac` of the plot height (0 = top).
  async function hoverChart(page, index, yFrac) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await page.mouse.move(2, 2);
      await sleep(300);
      const p = await plot(page);
      const x = p.vx + (index / (POINTS - 1)) * p.width;
      const y = p.vy + Math.min(Math.max(yFrac, 0.01), 0.99) * p.height;
      await page.mouse.move(x - 30, y, { steps: 4 });
      await sleep(150);
      await page.mouse.move(x, y, { steps: 8 });
      const ok = await page.waitForFunction(() => {
        const w = document.querySelector('.recharts-tooltip-wrapper');
        return !!document.querySelector('.recharts-active-dot') && w && getComputedStyle(w).visibility !== 'hidden';
      }, null, { timeout: 3000 }).then(() => true).catch(() => false);
      if (ok) {
        await sleep(600);
        const tip = await page.evaluate(() => document.querySelector('.recharts-tooltip-wrapper').innerText.replace(/\s+/g, ' '));
        console.log('hover', index, yFrac, '->', tip);
        return;
      }
      console.log('hover attempt', attempt, 'did not show tooltip; retrying');
    }
    throw new Error('chart tooltip never appeared');
  }
  async function setTheme(page, theme) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(1500);
  }
  const solo = (page, on) => page.evaluate((v) => document.documentElement.classList.toggle('cap-solo', v), on);
  async function setFormFakes(page, on) {
    await page.fill('#label', on ? FAKE_LABEL : '');
    await page.fill('#webhook', on ? FAKE_WEBHOOK : '');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await sleep(300);
  }

  for (const t of ['light', 'dark']) fs.mkdirSync(path.join(OUT, t), { recursive: true });

  // ---------- page A: dpr 2 ----------
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  await lookup(page);
  for (const theme of ['light', 'dark']) {
    const dir = path.join(OUT, theme);
    await page.setViewportSize({ width: 1440, height: 960 });
    await setTheme(page, theme);
    await page.mouse.move(2, 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    await shoot(page, 'viewport', path.join(dir, 'viewport.png'));
    record(path.join(dir, 'viewport.png'), { theme, kind: 'viewport', role: 'backdrop', describes: 'Whole OUI Notifier page at 1440x960 with OUI 6 looked up: escrow balance, days remaining, 30-day balance history chart, payer/escrow keys, and the Get Notified subscribe sidebar.' }, 1440, 960);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    await shoot(page, 'full', path.join(dir, 'full.png'));
    record(path.join(dir, 'full.png'), { theme, kind: 'full', role: 'backdrop', describes: 'Full-length populated OUI Notifier page, down to the $35 halt-floor notice.' }, 1440, docH);

    await rect(page, pad(await box(page, '[data-cap=chart]'), 24), path.join(dir, 'chart.png'), { theme, kind: 'element', role: 'supporting', describes: 'Wide 30-Day History area chart of the DC escrow balance: a steady burn-down, a sharp mid-month top-up, then burn-down again (sawtooth). No hover.' });

    await setFormFakes(page, true);
    await rect(page, pad(await box(page, '[data-cap=subscribe]'), 24), path.join(dir, 'subscribe.png'), { theme, kind: 'element', role: 'backdrop', describes: `Get Notified subscribe card (portrait), never submitted: Label "${FAKE_LABEL}" and Webhook "${FAKE_WEBHOOK}" filled with fake values, the Email input still shows its you@example.com placeholder (no email is ever typed), bell Subscribe button; alerts at 14, 7 and 1 days remaining.` });
    await setFormFakes(page, false);

    await rect(page, pad(await box(page, '[data-cap=account]'), 24), path.join(dir, 'account.png'), { theme, kind: 'element', role: 'supporting', describes: 'Payer key (monospace, with copy button) and escrow account Solscan link for the OUI.' });
    await rect(page, pad(union(await box(page, '[data-cap=lookup]'), await box(page, '[data-cap=chart]')), 28), path.join(dir, 'lookup.png'), { theme, kind: 'element', role: 'supporting', describes: 'The lookup flow as one stack: OUI number input (6), Balance / Days Remaining tiles and the 30-day chart.' });

    // Narrower viewport: left column ~648px so the big numbers read large against the chart.
    await page.setViewportSize({ width: 1100, height: 960 });
    await sleep(1200);
    await solo(page, true);
    await page.mouse.move(2, 2);
    await rect(page, pad(await box(page, '[data-cap=metrics]'), 28), path.join(dir, 'metrics.png'), { theme, kind: 'element', role: 'supporting', describes: 'Two metric tiles: escrow Balance in USD with the DC amount, and Days Remaining in green with the daily burn rate.' });
    await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, (await box(page, '[data-cap=metrics]')).y - 80));
    await sleep(300);
    await hoverChart(page, HERO_INDEX, 0.0);
    await rect(page, pad(union(await box(page, '[data-cap=metrics]'), await box(page, '[data-cap=chart]')), 32), path.join(dir, 'hero.png'), { theme, kind: 'hero', role: 'hero', describes: 'Balance ($) + Days Remaining (green) tiles above the 30-day escrow balance chart: burn-down, mid-month top-up spike, burn-down again. Hovered on the first burn-down (9/24) with the tooltip floating in the empty space above the line, hiding none of it.' });
    await page.mouse.move(2, 2);
    await solo(page, false);
  }

  // ---------- page A, alternate hero: OUI 12 (long drawdown, late top-up) ----------
  try {
    const before = await mainText(page);
    await page.fill('#oui', ALT_OUI);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForFunction((b) => {
      const t = document.querySelector('main').innerText;
      return t !== b && /\$1,\d{3}/.test(t) && /at \$[\d.,]+\/day/.test(t) && !/—/.test(t.split('ESCROW ACCOUNT')[0]);
    }, before, { timeout: 40000 });
    await settle(page, 2500);
    await tag(page);
    for (const theme of ['light', 'dark']) {
      const dir = path.join(OUT, theme);
      await setTheme(page, theme);
      await solo(page, true);
      await page.mouse.move(2, 2);
      await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, (await box(page, '[data-cap=metrics]')).y - 80));
      await sleep(300);
      await hoverChart(page, ALT_INDEX, 0.0);
      await rect(page, pad(union(await box(page, '[data-cap=metrics]'), await box(page, '[data-cap=chart]')), 32), path.join(dir, 'hero-alt.png'), { theme, kind: 'hero', role: 'supporting', describes: 'Alternate hero from OUI 12, same crop as hero.png: bigger numbers (~$1,330 balance, ~45 days remaining at ~$28/day) over a long 27-day drawdown that drains to the bottom of the plot, then a sharp top-up near the right edge. Hovered mid-drawdown with the tooltip above the line.' });
      await page.mouse.move(2, 2);
      await solo(page, false);
    }
  } catch (e) {
    console.log('alternate hero skipped:', String(e).slice(0, 200));
  }

  // ---------- page B: dpr 3 macro ----------
  const pageB = await newPage({ colorScheme: 'light', width: 1100, height: 960, dpr: 3 });
  await lookup(pageB);
  for (const theme of ['light', 'dark']) {
    const dir = path.join(OUT, theme);
    await setTheme(pageB, theme);
    await pageB.mouse.move(2, 2);
    await pageB.evaluate((t) => window.scrollTo(0, t), Math.max(0, (await box(pageB, '[data-cap=chart]')).y - 80));
    await sleep(300);
    await hoverChart(pageB, DETAIL_INDEX, 1.0);
    const p = await plot(pageB);
    let x0 = xAt(p, 13.0);
    // Never slice an x-axis date label at the left edge: if one straddles x0, start before it.
    const ticks = await pageB.evaluate(() => [...document.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((t) => {
      const b = t.getBoundingClientRect();
      return { l: b.left + scrollX, r: b.right + scrollX };
    }));
    for (const t of ticks) if (t.l < x0 && t.r > x0 - 6) x0 = t.l - 16;
    const x1 = p.sRight + 18;
    const r = { x: Math.round(x0), y: Math.round(p.y - 30), width: Math.round(x1 - x0), height: Math.round(p.sBottom + 8 - (p.y - 30)) };
    await rect(pageB, r, path.join(dir, 'detail.png'), { theme, kind: 'detail', role: 'detail', describes: 'dpr-3 macro of the chart: the end of the burn-down into the 10/1 trough, the sharp top-up spike and the full plateau to 10/14; hovered on the 10/2 peak ($236.02) with the active dot on the spike top and the tooltip sitting in the fill under the plateau line.' });
  }

  const manifest = {
    slug: 'oui-notifier',
    route: '/oui-notifier/',
    wallet: null,
    notes: `No wallet needed. OUI ${OUI} (HeyIoT.xyz) looked up by typing into the OUI input: live escrow balance ~$181 (18.1M DC), ~29 days remaining at ~$5/day; the 30-day chart is a burn-down, a top-up on 10/2, then burn-down again. Light and dark come from the same load via emulateMedia. hero/metrics/hero-alt are shot at a 1100px viewport (left column 648px) with the OUI input and payer/escrow rows hidden (visibility only) for clean margins. hero hovers 9/24 with the pointer at the top of the plot so the tooltip floats above the line; detail (second, dpr-3 page) hovers the 10/2 top-up peak with the pointer at the bottom so the tooltip sits in the fill under the plateau. The trough itself was not used for detail: recharts anchors the tooltip 10px right of the hovered point, which on the 10/1 trough puts it over the rising spike. hero-alt is the same crop after re-typing the OUI to ${ALT_OUI} (~$1,330, ~45 days, ~$28/day): a long drawdown filling ~75% of the plot height, then a top-up near the right edge; an option if the art director wants a more dramatic drain-then-refill silhouette. subscribe.png has fake Label/Webhook values typed in (never submitted, cleared right after) but the Email field keeps its placeholder because the capture rules forbid typing an email, so it is a backdrop rather than a floating layer. The logged-in "Manage Alerts" subscriptions table was not captured (needs a real verified subscription). Chart dates render in the machine's local timezone, as the tool does.`,
    shots,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('done', shots.length);
}, { timeoutMs: 480000 });
