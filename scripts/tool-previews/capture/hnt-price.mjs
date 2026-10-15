// HNT Price API (/hnt-price) — source captures for the landing-page preview art.
//
//   node capture/hnt-price.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/hnt-price/{light,dark}/*.png and manifest.json (OUT_DIR overrides
// the directory). The landing card uses current-json-response.png and detail.png
// (previews/hnt-price.js).
//
// One dpr-2 page load for everything except detail.png (a second, dpr-3 load).
// Light and dark come from the same load via emulateMedia.
//
// Consistency between themes: an init script wraps EventSource and Date.now so
// that, once a real SSE frame has landed, the stream can be FROZEN (later frames
// are dropped before the page sees them) and the clock pinned at frame time +
// 3.3 s. Every shot, in both themes and on both pages, then reads the same prices
// and "Last frame 3s ago". Nothing is invented: the frozen frame is a real one.
//
// Read-only: the only clicks are the page's own "Try /current" / "Try /instant"
// buttons, which are plain GETs that print the live JSON response.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, writeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/hnt-price/', import.meta.url));
const ROUTE = '/hnt-price';
const THEMES = ['light', 'dark'];
const CARD_RADIUS = 16; // Tailwind rounded-2xl; the manifest's cardRadius for the transparent crops

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "hnt-price",
  route: "/hnt-price",
  wallet: null,
  shots: {
    "hero.png": { dpr: 2, kind: "hero", role: "hero", describes: "Eyebrow PUBLIC API · NO KEY REQUIRED + H1 HNT Price API above the live ticker card: green Live pill, Last frame 3s ago, GET /HNT-PRICE/SSE, big market price $0.4229, DC mint price $0.4237, 42,368 DC per HNT, each with its short caption. 680px layout (16:10); site header, intro paragraph and the ticker stream footnote collapsed; ~31px above the eyebrow, room below for the card shadow. Opaque page background." },
    "hero-clean.png": { dpr: 2, kind: "hero", role: "hero", describes: "Same framing as hero.png at a 648px layout (narrowest width that keeps three columns) with the per-stat captions also hidden: only the Live pill, Last frame 3s ago, the three small labels and the numbers $0.4229 / $0.4237 / 42,368 remain, so they stay readable at 300-400px wide. Opaque page background." },
    "detail.png": { dpr: 3, kind: "detail", role: "detail", describes: "Macro at dpr 3 of the ticker market-price column, inset inside the card (no corners or dividers): green Live pill, Last frame 3s ago, MARKET PRICE label, large $0.4229 and its caption." },
    "live-ticker.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "The live SSE ticker card alone at desktop width (960px card) on a TRANSPARENT background with 32px margin (48px below) so the shadow-soft elevation survives: wide three-stat strip with Live pill, Last frame 3s ago, market price, DC mint price, DC per HNT and their captions; stream footnote hidden." },
    "live-ticker-clean.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "Same transparent ticker card with the per-stat captions also hidden: a slim strip of Live pill + $0.4229 / $0.4237 / 42,368. Good for tilting or stacking." },
    "current-json-response.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "GET /hnt-price/current endpoint card (732px card) on a transparent background: curl command, Try /current button and the complete real JSON response (spot, oracle, dc_per_hnt 42368, snapshot_at) with the panel max-height lifted; endpoint prose hidden." },
    "sse-code-snippet.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "GET /hnt-price/sse endpoint card on a transparent background: method badge, path, 500-subscriber pill and the EventSource JavaScript snippet (endpoint prose hidden)." },
    "two-prices.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "The two prices explainer card on a transparent background: spot.usd, oracle.usd and oracle.mint_price_usd rows with live values ($0.4229, $0.423, $0.4237) and the dc_per_usd peg note." },
    "payload-schema.png": { dpr: 2, kind: "element", role: "supporting", transparent: true, cardRadius: 16, cardInset: {"left": 32, "top": 32, "right": 32, "bottom": 48}, describes: "Payload schema table card on a transparent background: monospace field names, types and meanings for all 14 snapshot fields." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Populated page at 1440x960: header, eyebrow + H1 HNT Price API, intro paragraph, the live SSE ticker (green Live pill, Last frame 3s ago, market price $0.4229, DC mint price $0.4237, 42,368 DC per HNT, with captions and stream footnote) and the Base URL card with No API key / No registration / CORS open pills." },
    "full.png": { dpr: 2, kind: "full", role: "backdrop", describes: "Entire docs page: live ticker, base URL, four endpoint cards (/current and /instant with real Try-it JSON responses, /sse and /ws code), the two-prices explainer with live values, payload schema table, full-reference footer. The /current and /instant JSON panels end at their real max-height scroll (cut near dc_per_usd); use current-json-response.png for code." },
  },
};
const NOTES = (frame) => `Read-only page, no wallet. Live data from the real /sse stream. One SSE frame (market $${frame.spot.usd.toFixed(4)}, mint $${frame.oracle.mint_price_usd.toFixed(4)}, ${frame.dc_per_hnt.toLocaleString('en-US')} DC/HNT) was frozen for the whole capture by an init script that wraps EventSource (drops later frames) and pins Date.now 3.3 s after that frame, so every shot in BOTH themes, and the separate dpr-3 detail load, shows identical prices and 'Last frame 3s ago' / 'Oracle posted 2m ago'. The /current and /instant Try-it buttons (plain GETs) were clicked once each after the freeze, so the /current JSON matches the ticker. The page has no chart; its visual interest is the big live price readout and the code/JSON blocks. Light and dark from one load via emulateMedia. Element crops (live-ticker, live-ticker-clean, current-json-response, sse-code-snippet, two-prices, payload-schema) are RGBA with a transparent background: the card sits 32px in from the left/top/right edges and 48px from the bottom, its corners are rounded-2xl (${CARD_RADIUS} CSS px radius) with true alpha, and the shadow-soft falloff is kept. hero, hero-clean, detail, viewport and full are opaque. Temporary CSS only hides the site header, the intro paragraph, the ticker stream footnote, and the per-stat captions (hero-clean, live-ticker-clean), hides endpoint prose and lifts the JSON panel max-height (code crops), and widens main's side padding for the JSON crop; no UI was invented. full.png keeps the real page, including the JSON panels' max-height scroll cut.`;

const FREEZE_SCRIPT = `(() => {
  const realNow = Date.now.bind(Date);
  window.__realNow = realNow;
  window.__frozenNow = null;
  Date.now = () => (window.__frozenNow != null ? window.__frozenNow : realNow());
  window.__freezeStream = false;
  window.__frames = 0;
  const RealES = window.EventSource;
  class CaptureES extends RealES {
    constructor(url, opts) {
      super(url, opts);
      // Registered before the page assigns onmessage/onerror, so it runs first and
      // can swallow events while frozen.
      for (const type of ['message', 'error', 'open']) {
        this.addEventListener(type, (e) => {
          if (window.__freezeStream) { e.stopImmediatePropagation(); return; }
          if (type === 'message') {
            window.__frames += 1;
            window.__lastFrame = e.data;
            window.__lastFrameAt = realNow();
          }
        });
      }
    }
  }
  window.EventSource = CaptureES;
})();`;

async function pageBox(page, loc) {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}

/** Top of the first line box of an element's text (page coords). */
async function textTop(page, loc) {
  return loc.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getClientRects()[0].top + window.scrollY;
  });
}

async function waitLive(page) {
  await page.waitForFunction(() => {
    const s = document.querySelector('main > div.space-y-12 > section');
    if (!s || !window.__frames) return false;
    const t = s.textContent;
    return t.includes('Live') && (t.match(/\$\d/g) || []).length >= 2 && !t.includes('Unavailable') && /DC per HNT\s*[\d,]{4,}/.test(t);
  }, null, { timeout: 90000 });
}

async function freeze(page) {
  await page.evaluate(() => { window.__freezeStream = true; window.__frozenNow = window.__lastFrameAt + 3300; });
}
async function unfreeze(page) {
  await page.evaluate(() => { window.__freezeStream = false; window.__frozenNow = null; });
}

/**
 * Element crop on a transparent background: everything but the element is made
 * invisible (layout kept), html/body backgrounds cleared, and the clip padded so
 * the shadow-soft elevation survives. PNG has alpha.
 */
async function shootAlpha(page, loc, outPath, { pad = 32, padBottom = 48 } = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.evaluate((el) => el.setAttribute('data-cap', ''));
  const style = await page.addStyleTag({ content:
    'html,body,#root,div.min-h-screen{background:transparent!important}' +
    'body *{visibility:hidden!important}' +
    '[data-cap],[data-cap] *{visibility:visible!important}' });
  await page.waitForTimeout(250);
  const b = await pageBox(page, loc);
  const clip = { x: Math.round(b.x - pad), y: Math.round(b.y - pad), width: Math.round(b.width + 2 * pad), height: Math.round(b.height + pad + padBottom) };
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  if (clip.x < 0 || clip.x + clip.width > vw) throw new Error(`alpha clip outside page for ${outPath}: ${JSON.stringify(clip)} vw=${vw}`);
  await page.screenshot({ path: outPath, clip, fullPage: true, omitBackground: true, animations: 'disabled', caret: 'hide', timeout: 30000 });
  await style.evaluate((el) => el.remove());
  await loc.evaluate((el) => el.removeAttribute('data-cap'));
  return clip;
}

async function shootClip(page, clip, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, clip, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 30000 });
  return clip;
}

await run(async ({ newPage, shoot, sleep }) => {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2, initScript: FREEZE_SCRIPT });
  const p3 = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 3, initScript: FREEZE_SCRIPT });
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await p3.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await waitLive(page);
  await waitLive(p3);

  const ticker = page.locator('main > div.space-y-12 > section').first();
  console.log('ticker live:', (await ticker.innerText()).replace(/\s+/g, ' ').slice(0, 220));

  // Live "Try it" responses (GET only).
  const cardFor = (p) => page.locator('section.rounded-2xl').filter({ has: page.locator(`span.font-mono:text-is("/hnt-price${p}")`) }).first();
  const current = cardFor('/current');
  const instant = cardFor('/instant');
  const sse = cardFor('/sse');

  async function tryIt(card, label) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await card.getByRole('button', { name: label }).click();
      await page.waitForFunction((el) => {
        const t = el.textContent;
        return t.includes('"snapshot_at"') || t.includes('Rate limited') || t.includes('failed');
      }, await card.elementHandle(), { timeout: 30000 }).catch(() => {});
      const txt = await card.innerText();
      if (txt.includes('"snapshot_at"')) { console.log(label, 'ok'); return true; }
      console.log(label, 'not ok, waiting 45s:', txt.slice(-160));
      await sleep(45000);
    }
    return false;
  }

  // Freeze both pages on the same real frame.
  let synced = false;
  for (let i = 0; i < 8 && !synced; i++) {
    await freeze(page); await freeze(p3);
    const a = await page.evaluate(() => window.__lastFrame);
    const b = await p3.evaluate(() => window.__lastFrame);
    // Prefer a frame whose market price shows four decimals ($0.4218, not $0.423),
    // matching the four-decimal mint price beside it.
    const usd = JSON.parse(a)?.spot?.usd;
    const fourDp = usd != null && /\.\d{4}$/.test(new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(usd));
    if (a === b && (fourDp || i >= 5)) { synced = true; break; }
    console.log('not yet: same frame', a === b, 'four decimals', fourDp, usd);
    await unfreeze(page); await unfreeze(p3);
    const fa = await page.evaluate(() => window.__frames), fb = await p3.evaluate(() => window.__frames);
    await Promise.all([
      page.waitForFunction((n) => window.__frames > n, fa, { timeout: 60000 }).catch(() => {}),
      p3.waitForFunction((n) => window.__frames > n, fb, { timeout: 60000 }).catch(() => {}),
    ]);
    await sleep(1500);
  }
  console.log('frozen frame synced across pages:', synced, (await page.evaluate(() => window.__lastFrame)).slice(0, 200));
  await sleep(1300); // let RelativeTime tick onto the frozen clock

  // Try-it panels after the freeze, so /current returns the same snapshot the ticker shows.
  if (!(await tryIt(current, 'Try /current'))) throw new Error('/current never populated');
  if (!(await tryIt(instant, 'Try /instant'))) throw new Error('/instant never populated');
  await page.mouse.move(2, 2);
  console.log('ticker frozen:', (await ticker.innerText()).replace(/\s+/g, ' ').slice(0, 260));

  const twoPrices = page.locator('section.rounded-2xl').filter({ hasText: 'oracle.mint_price_usd' }).filter({ hasText: 'dc_per_usd' }).first();
  const schema = page.locator('section.rounded-2xl').filter({ has: page.locator('table') }).first();
  const eyebrow = page.locator('main > div.mb-10 > p').first();

  const NO_FOOTNOTE = 'main > div.space-y-12 > section:first-child > div.border-t{display:none!important}';
  const NO_CAPTIONS = 'main > div.space-y-12 > section:first-child div.grid > div > div.text-xs{display:none!important}';
  const HERO_CHROME = 'header{display:none!important} main > div.mb-10 > p.max-w-2xl{display:none!important}';
  const CODE_ONLY = 'section.rounded-2xl > p.text-\\[15px\\]{display:none!important} pre.max-h-80{max-height:none!important;overflow:visible!important}';

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });

    await shoot(page, 'viewport', path.join(dir, 'viewport.png'));
    await shoot(page, 'full', path.join(dir, 'full.png'));

    // Transparent element crops at the desktop layout.
    let s = await page.addStyleTag({ content: NO_FOOTNOTE });
    await sleep(300);
    await shootAlpha(page, ticker, path.join(dir, 'live-ticker.png'));
    const s2 = await page.addStyleTag({ content: NO_CAPTIONS });
    await sleep(300);
    await shootAlpha(page, ticker, path.join(dir, 'live-ticker-clean.png'));
    await s2.evaluate((el) => el.remove());
    await s.evaluate((el) => el.remove());

    await shootAlpha(page, twoPrices, path.join(dir, 'two-prices.png'));
    await shootAlpha(page, schema, path.join(dir, 'payload-schema.png'));

    s = await page.addStyleTag({ content: CODE_ONLY });
    await sleep(300);
    await shootAlpha(page, sse, path.join(dir, 'sse-code-snippet.png'));
    // Narrower card for the JSON (less empty panel to its right); main's side
    // padding widened to 40px so the 32px transparent margin fits inside the page.
    await page.setViewportSize({ width: 812, height: 960 });
    const narrow = await page.addStyleTag({ content: 'main{padding-left:40px!important;padding-right:40px!important}' });
    await sleep(500);
    await shootAlpha(page, current, path.join(dir, 'current-json-response.png'));
    await narrow.evaluate((el) => el.remove());
    await s.evaluate((el) => el.remove());

    // Hero: eyebrow + title + live ticker, at a 680 px layout (16:10); hero-clean at
    // 648 px, the narrowest width that keeps the three-column ticker. Site header,
    // intro paragraph and the ticker's stream footnote collapsed.
    async function hero(width, extraCss, name, PT = 28, PB = 44) {
      await page.setViewportSize({ width, height: 960 });
      const st = await page.addStyleTag({ content: HERO_CHROME + NO_FOOTNOTE + extraCss });
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
      const tk = await pageBox(page, ticker);
      const top = await textTop(page, eyebrow);
      const PX = Math.min(28, tk.x);
      const clip = { x: Math.round(tk.x - PX), y: Math.max(0, Math.round(top - PT)), width: Math.round(tk.width + 2 * PX), height: 0 };
      clip.height = Math.round(tk.y + tk.height + PB - clip.y);
      console.log(theme, name, JSON.stringify(clip));
      await shootClip(page, clip, path.join(dir, name));
      await st.evaluate((el) => el.remove());
      return clip;
    }
    await hero(680, '', 'hero.png');
    await hero(648, NO_CAPTIONS, 'hero-clean.png', 28, 48);
    await page.setViewportSize({ width: 1440, height: 960 });
  }

  // Detail at dpr 3 from the second, identically frozen page: status row +
  // market-price column, inset inside the card so no corner or divider shows.
  const t3 = p3.locator('main > div.space-y-12 > section').first();
  for (const theme of THEMES) {
    await p3.emulateMedia({ colorScheme: theme });
    await sleep(600);
    await t3.scrollIntoViewIfNeeded();
    const b = await pageBox(p3, t3);
    const col = await pageBox(p3, t3.locator('div.grid > div').first());
    const I = 6;
    const clip = { x: Math.round(b.x + I), y: Math.round(b.y + I), width: Math.round(col.x + col.width + 20 - b.x - I), height: Math.round(col.y + col.height + 18 - b.y - I) };
    await shootClip(p3, clip, path.join(OUT, theme, 'detail.png'));
    console.log(theme, 'detail', JSON.stringify(clip), (await t3.innerText()).replace(/\s+/g, ' ').slice(0, 120));
  }

  const frame = JSON.parse(await page.evaluate(() => window.__lastFrame));
  writeManifest(OUT, { ...MANIFEST, notes: NOTES(frame) });
}, { timeoutMs: 600000 });
