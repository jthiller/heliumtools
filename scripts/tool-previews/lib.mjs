// Shared capture helpers for heliumtools tool-preview screenshots (shoot.mjs
// and the per-tool scripts in capture/).
// Usage from a capture script (capture/<slug>.mjs):
//   import { run, BASE } from '../lib.mjs';
//   await run(async ({ newPage, shoot, settle }) => { ... });
// Every script MUST go through run(): it enforces a hard timeout, closes Chrome,
// and calls process.exit so nothing hangs. writeManifest / mergeManifest keep
// the capture's manifest.json (bake.mjs reads each shot's css size from it).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE || 'http://localhost:5174'; // dev:remote on --port 5174 (README), proxied to the production API

// Public wallets the user supplied for populated states (read-only: they are
// only looked up or fake-connected, never signed for). Keyed by the state they
// give a capture, not by owner or place. These are the ONLY wallets a capture
// may use: the site owner chose them. Never add one found on-chain (e.g. a voter
// from a governance roster) or hard-code another address; ask the owner instead.
export const WALLETS = {
  main: 'BMJiAPZhttX1HU6LkoKedQzdnU1Km6CQcDJtQRCc84Hd',      // small mixed Mobile WiFi + IoT fleet
  large: '9ZyecMbUv6upM9y3nKLGQKj3iDqVAQRB3yQTNN89x5g6',     // large, mostly Mobile fleet
  nyc: 'nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux',        // large Mobile data-only fleet (vanity address)
  iotOnly: '2mwuyMhooEnqjsBuQKvjNuNv9Ju2xQUwutdTz6sZB8rJ',   // IoT-only fleet, all inactive
  mixed: '7yRY9vyMrd8eMWJVNPUhtZcGVKfvvPbgDvVLr4kv245F',     // mixed fleet
  empty: 'EfaMBZE2Yb4WetDBnCzdrDkZHJSv7vnoPcjykrKDK3kq',     // no Hotspots; DC balance + veHNT positions
  single: '79EgtsdW9mPgqWMZZqyNffDkhv1d9VHFGDaXDm4muU6n',    // one IoT Hotspot + veHNT positions, some expired
};

// Init script that installs a read-only fake Phantom provider for `address`, and
// sets the wallet adapter's autoConnect key so pages wrapped in SolanaProvider
// come up already "connected". Any signing call throws (nothing is ever signed).
export function fakeWalletScript(address) {
  return `(() => {
    const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function b58decode(s) {
      const bytes = [0];
      for (const c of s) {
        let carry = ALPHA.indexOf(c);
        if (carry < 0) throw new Error('bad b58');
        for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
      }
      for (const c of s) { if (c === '1') bytes.push(0); else break; }
      return new Uint8Array(bytes.reverse());
    }
    const addr = ${JSON.stringify(address)};
    const raw = b58decode(addr);
    const bytes = raw.length > 32 ? raw.slice(raw.length - 32) : raw;
    const publicKey = { toBytes: () => bytes, toBuffer: () => bytes, toBase58: () => addr, toString: () => addr, equals: (o) => o && o.toBase58 && o.toBase58() === addr };
    const listeners = {};
    const provider = {
      isPhantom: true,
      isConnected: false,
      publicKey,
      // Resolve after a beat so the wallet adapter's React listeners are attached first.
      connect: async () => { await new Promise((r) => setTimeout(r, 400)); provider.isConnected = true; return { publicKey }; },
      disconnect: async () => {},
      on: (e, f) => { (listeners[e] ||= []).push(f); },
      off: () => {}, removeListener: () => {}, removeAllListeners: () => {},
      signTransaction: async () => { throw new Error('preview capture: signing disabled'); },
      signAllTransactions: async () => { throw new Error('preview capture: signing disabled'); },
      signMessage: async () => { throw new Error('preview capture: signing disabled'); },
      signAndSendTransaction: async () => { throw new Error('preview capture: signing disabled'); },
      request: async () => { throw new Error('preview capture: request disabled'); },
    };
    Object.defineProperty(window, 'phantom', { value: { solana: provider }, configurable: true });
    Object.defineProperty(window, 'solana', { value: provider, configurable: true });
    try { localStorage.setItem('walletName', JSON.stringify('Phantom')); } catch {}
  })();`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pixel size of a PNG, read from its IHDR chunk.
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

// Write <dir>/manifest.json for a capture script. `shots` maps each file name to
// { dpr, kind, role, describes, ...extra } (`describes` may be a { light, dark }
// pair); every one found on disk under light/ and dark/ gets an entry whose
// cssWidth x cssHeight is the PNG's pixel size / dpr, which is how bake.mjs
// derives a capture's dpr. Entries already in the manifest for files this call
// does not cover are kept while their PNG exists (another pass owns them, e.g.
// a script's macros).
export function writeManifest(dir, { shots, ...meta }) {
  const file = path.join(dir, 'manifest.json');
  const covered = new Set();
  const fresh = [];
  for (const theme of ['light', 'dark']) {
    for (const [name, { dpr, describes, ...extra }] of Object.entries(shots)) {
      const rel = `${theme}/${name}`;
      covered.add(rel);
      if (!fs.existsSync(path.join(dir, rel))) {
        console.log('[manifest] missing', rel);
        continue;
      }
      const { width, height } = pngSize(path.join(dir, rel));
      fresh.push({
        file: rel, theme, ...extra,
        describes: typeof describes === 'string' ? describes : describes[theme],
        cssWidth: Math.round(width / dpr), cssHeight: Math.round(height / dpr), dpr,
      });
    }
  }
  let kept = [];
  try {
    kept = JSON.parse(fs.readFileSync(file, 'utf8')).shots.filter((s) => !covered.has(s.file) && fs.existsSync(path.join(dir, s.file)));
  } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...meta, shots: [...fresh, ...kept] }, null, 2) + '\n');
  console.log(`wrote ${file}: ${fresh.length} shots${kept.length ? `, kept ${kept.length}` : ''}`);
}

// Add or replace these entries (matched by file) in <dir>/manifest.json and drop
// the files listed in `drop`; every other entry is left alone. `meta` (slug,
// route, wallet, notes) is set over the manifest's own; `seed` is used only when
// there is no manifest yet.
export function mergeManifest(dir, shots, { drop = [], meta = {}, seed = {} } = {}) {
  const file = path.join(dir, 'manifest.json');
  let prev = [];
  let manifest = seed;
  try {
    ({ shots: prev = [], ...manifest } = JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {}
  const mine = new Set([...shots.map((s) => s.file), ...drop]);
  fs.writeFileSync(file, JSON.stringify({ ...manifest, ...meta, shots: [...prev.filter((s) => !mine.has(s.file)), ...shots] }, null, 2) + '\n');
}

export async function run(fn, { timeoutMs = 240000 } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const timer = setTimeout(() => { console.error('capture: hard timeout'); process.exit(2); }, timeoutMs);
  try {
    const helpers = {
      browser,
      // colorScheme: 'light' | 'dark'. wallet: base58 address to fake-connect (optional).
      async newPage({ colorScheme = 'light', width = 1440, height = 960, dpr = 2, wallet, initScript } = {}) {
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme, reducedMotion: 'no-preference' });
        if (wallet) await ctx.addInitScript(fakeWalletScript(wallet));
        if (initScript) await ctx.addInitScript(initScript);
        // Side-effect guard: never let a capture send a transaction, claim, subscribe,
        // migrate, purchase, or broadcast. Blocked requests are logged. A capture that
        // wants to show a post-action state registers its own page.route() that
        // fulfills a MOCK response (later routes take precedence over this one).
        await ctx.route('**/*', (route) => {
          const req = route.request();
          if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') {
            const body = req.postData() || '';
            const url = req.url();
            if (/"method"\s*:\s*"(sendTransaction|sendRawTransaction|requestAirdrop)"/.test(body) ||
                /(claim|subscribe|broadcast|migrat|submit|purchase|order|webhook|verify|send)/i.test(new URL(url).pathname)) {
              console.log('[guard] blocked', req.method(), url.slice(0, 160));
              return route.abort('blockedbyclient');
            }
          }
          return route.fallback();
        });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
        page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
        return page;
      },
      sleep,
      // Wait for network to go mostly quiet, then a fixed settle (animations, count-ups).
      async settle(page, ms = 2500) {
        try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
        await sleep(ms);
      },
      // Screenshot a locator / selector / the viewport / the full page to outPath (PNG).
      async shoot(page, target, outPath, opts = {}) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const common = { path: outPath, animations: 'disabled', caret: 'hide', timeout: 30000, ...opts };
        if (target === 'viewport') return page.screenshot(common);
        if (target === 'full') return page.screenshot({ ...common, fullPage: true });
        const loc = typeof target === 'string' ? page.locator(target).first() : target;
        await loc.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
        return loc.screenshot(common);
      },
      // Screenshot an arbitrary page-coordinate rectangle (CSS px) — useful for crops spanning several elements.
      async shootRect(page, { x, y, width, height }, outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        return page.screenshot({ path: outPath, clip: { x, y, width, height }, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 30000 });
      },
    };
    await fn(helpers);
  } catch (e) {
    console.error('capture failed:', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    process.exit(process.exitCode || 0);
  }
}
