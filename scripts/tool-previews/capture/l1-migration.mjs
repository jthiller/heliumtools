// L1 Migration (/l1-migration) — source captures for the landing-page preview art.
//
//   node capture/l1-migration.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/l1-migration/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses detail.png and success-banner.png
// (previews/l1-migration.js).
//
// Types a legacy Helium L1 (B58) address — the B58 form of the `main` showcase
// wallet — so the page derives and shows both the Helium and the Solana addresses.
// No wallet is connected.
//
// Outcome state: the tool's one result is the emerald "Migration successful!"
// StatusBanner. To depict it with NO side effect, a page.route() fulfills
// POST .../l1-migration/migrate locally with a mock body (the worker's exact
// success message, handlers/migrate.js) BEFORE "Seed Wallet" is clicked, so the
// request never leaves the browser. If the mock ever failed to match, lib.mjs's
// side-effect guard (path matches /migrat/) aborts the request, the page would show
// an error banner, and this script throws instead of shooting. Light and dark
// come from the same load via emulateMedia.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/l1-migration/', import.meta.url));
const ROUTE = '/l1-migration';
const WALLET = WALLETS.main; // Solana base58; its Helium B58 form is typed as the "legacy" input
const THEMES = ['light', 'dark'];
const P = (theme, f) => path.join(OUT, theme, f);
const SUCCESS_MSG = 'Migration successful!'; // worker/src/tools/l1-migration/handlers/migrate.js
const MOCK_BODY = { success: true, message: SUCCESS_MSG, wallet: WALLET, transactionsProcessed: 3 };

async function boxOf(loc) {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}
const box = (page, sel) => boxOf(page.locator(sel).first());
// Union of boxes, padded (CSS px), rounded.
function frame(boxes, padX, padTop, padBottom = padTop) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: Math.round(x0 - padX), y: Math.round(y0 - padTop), width: Math.round(x1 - x0 + 2 * padX), height: Math.round(y1 - y0 + padTop + padBottom) };
}
// Widen a rect symmetrically to at least `ratio` (w/h).
function atLeastRatio(r, ratio) {
  const w = Math.max(r.width, Math.round(r.height * ratio));
  return { x: Math.round(r.x - (w - r.width) / 2), y: r.y, width: w, height: r.height };
}

// Load the page and enter the legacy Helium address; returns the Helium B58.
async function populate(page) {
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wallet', { timeout: 30000 });
  // Derive the Helium B58 from the Solana key using the page's own converter.
  await page.fill('#wallet', WALLET);
  const heliumP = page.locator('main .grid.gap-px > div').nth(0).locator('p').nth(1);
  await page.waitForFunction((el) => el && /^1[1-9A-HJ-NP-Za-km-z]{40,}$/.test(el.textContent), await heliumP.elementHandle(), { timeout: 10000 });
  const helium = (await heliumP.textContent()).trim();
  // Now type the legacy L1 form, as an L1 holder would, so Solana is the derived side.
  await page.fill('#wallet', '');
  await page.locator('#wallet').pressSequentially(helium, { delay: 5 });
  await page.waitForFunction((sol) => document.querySelector('main a[href*="explorer.solana.com"]')?.textContent.includes(sol), WALLET, { timeout: 10000 });
  await restFocus(page);
  const txt = await page.locator('main').innerText();
  if (txt.includes('—') || /NaN|undefined/.test(txt)) throw new Error('page not populated: ' + txt);
  return helium;
}
async function restFocus(page) {
  await page.locator('#wallet').focus(); // keep the accent focus ring on the input
  await page.mouse.move(5, 940);         // park the cursor off every control
  await page.waitForTimeout(600);
}

// Mock the migrate POST locally, click "Seed Wallet", wait for the success banner.
async function showOutcome(page) {
  let mocked = 0;
  await page.route(/\/l1-migration\/migrate(\?.*)?$/, async (route) => {
    mocked++;
    console.log('[mock] fulfilled', route.request().method(), route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BODY) });
  });
  await page.locator('main button', { hasText: 'Seed Wallet' }).click();
  await page.locator('main', { hasText: SUCCESS_MSG }).waitFor({ timeout: 10000 });
  if (mocked !== 1) throw new Error('expected exactly one mocked migrate call, got ' + mocked);
  await page.waitForFunction(() => /Seed Wallet/.test(document.querySelector('main button')?.textContent || ''), null, { timeout: 5000 });
  await restFocus(page);
  const txt = await page.locator('main').innerText();
  if (/fail|error|—|NaN|undefined/i.test(txt)) throw new Error('unexpected outcome text: ' + txt);
}

const shots = [];
function rec(theme, file, kind, describes, rect, role) {
  shots.push({ file: `${theme}/${file}`, theme, kind, describes, cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height), role });
}

await run(async ({ newPage, shoot, shootRect, sleep }) => {
  for (const t of THEMES) fs.mkdirSync(path.join(OUT, t), { recursive: true });

  // ---- Main pass: 1440x960 @ dpr 2 ----
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  const helium = await populate(page);
  console.log('helium', helium);

  // Pre-action: the converter form as the user sees it before pressing Seed Wallet.
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(500);
    const form = frame([await box(page, 'label[for="wallet"]'), await box(page, 'main button')], 32, 28);
    await shootRect(page, form, P(theme, 'converter-form.png'));
    rec(theme, 'converter-form.png', 'element', 'Pre-action form: WALLET ADDRESS input holding a legacy Helium L1 B58 address (accent focus ring), the derived Helium / Solana address pair, and the teal Seed Wallet button', form, 'supporting');
  }

  // Outcome: mocked success → emerald "Migration successful!" banner at the top of the stack.
  await page.emulateMedia({ colorScheme: 'light' });
  await showOutcome(page);

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(500);

    await shoot(page, 'viewport', P(theme, 'viewport.png'));
    rec(theme, 'viewport.png', 'viewport', 'L1 Migration page at 1440x960 after a migration: page title, emerald "Migration successful!" banner, wallet input holding a legacy Helium B58 address (focused), derived Helium + Solana address panel, Seed Wallet button', { width: 1440, height: 960 }, 'backdrop');

    const titleBlock = await box(page, 'main > div:first-child');
    const banner = await box(page, 'main .space-y-6 > div:first-child'); // StatusBanner
    const label = await box(page, 'label[for="wallet"]');
    const input = await box(page, '#wallet');
    const grid = await box(page, 'main .grid.gap-px');
    const button = await box(page, 'main button');

    // Hero: the whole tool column — title, success banner, legacy-address input, derived pair, CTA.
    const hero = atLeastRatio(frame([titleBlock, button], 44, 40, 44), 4 / 3);
    await shootRect(page, hero, P(theme, 'hero.png'));
    rec(theme, 'hero.png', 'hero', 'The complete tool column after a migration: "Wallet Migration Tool" title, the emerald "Migration successful!" banner with check icon, the wallet input with a legacy Helium L1 address (accent focus ring), the derived Helium Address / Solana Address panel (Solana as a teal explorer link), and the Seed Wallet button', hero, 'hero');

    // Outcome: banner + input + address pair (no title, no button).
    const outcome = frame([banner, grid], 32, 28, 16); // 16 bottom: Seed Wallet starts 24px below
    await shootRect(page, outcome, P(theme, 'outcome.png'));
    rec(theme, 'outcome.png', 'element', 'Outcome stack: emerald "Migration successful!" banner over the legacy Helium B58 input and the derived Helium / Solana address pair', outcome, 'supporting');

    // Banner alone (its row: 24px gap to the input label below).
    const bn = frame([banner], 28, 22, 18);
    await shootRect(page, bn, P(theme, 'success-banner.png'));
    rec(theme, 'success-banner.png', 'element', 'The emerald success StatusBanner on its own: check-circle icon and "Migration successful!"', bn, 'supporting');

    // Address pair panel — the "one key, two encodings" result.
    const pair = frame([grid], 28, 16, 24); // 16 top: the input's focus ring sits 22px above
    await shootRect(page, pair, P(theme, 'address-pair.png'));
    rec(theme, 'address-pair.png', 'element', 'Derived address panel (full card width): HELIUM ADDRESS (147UN3…GEuzi, monospace) stacked over SOLANA ADDRESS (BMJiAP…84Hd, teal explorer link with arrow)', pair, 'supporting');

    // Wallet input with label.
    const inp = frame([label, input], 28, 20, 16); // 16 bottom: the address panel starts 24px below
    await shootRect(page, inp, P(theme, 'wallet-input.png'));
    rec(theme, 'wallet-input.png', 'element', 'WALLET ADDRESS label over the text input holding a legacy Helium L1 B58 address, with the accent focus ring', inp, 'supporting');

    // Full page, with the viewport trimmed to the content (the shell is min-h-screen).
    const contentBottom = await page.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return Math.ceil(m.bottom + scrollY); });
    await page.setViewportSize({ width: 1440, height: contentBottom });
    await sleep(300);
    const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
    await shoot(page, 'full', P(theme, 'full.png'));
    rec(theme, 'full.png', 'full', 'Full page after a migration (site header + tool column with the success banner); the page is short, so this is the whole tool at 1440 wide trimmed to its content', { width: 1440, height: fullH }, 'backdrop');
    await page.setViewportSize({ width: 1440, height: 960 });
    await sleep(300);
    await restFocus(page);
  }
  await page.context().close();

  // ---- Detail pass: dpr 3 macro of the address pair, inset inside the card on every side ----
  const dpage = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 3 });
  await populate(dpage);
  for (const theme of THEMES) {
    await dpage.emulateMedia({ colorScheme: theme });
    await sleep(500);
    const rows = dpage.locator('main .grid.gap-px > div');
    const heliumRow = await boxOf(rows.nth(0));
    const solRow = await boxOf(rows.nth(1));
    const link = await box(dpage, 'main a[href*="explorer.solana.com"]');
    // Right edge of the Helium B58 text itself (its <p> is full width), via a Range.
    const heliumTextRight = await rows.nth(0).locator('p').nth(1).evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right + scrollX; });
    const textRight = Math.max(heliumTextRight, link.x + link.width);
    const INSET = 6;                       // crop edge sits 6px inside the card on left/top/bottom
    const margin = 16 - INSET;             // = text-to-crop gap on those sides (row padding p-4 = 16)
    const x = Math.round(heliumRow.x + INSET);
    const y = Math.round(heliumRow.y + INSET);
    const right = Math.round(textRight + margin);
    const bottom = Math.round(solRow.y + solRow.height - INSET);
    if (right > heliumRow.x + heliumRow.width - INSET) throw new Error('detail crop would leave the card');
    const rect = { x, y, width: right - x, height: bottom - y };
    await shootRect(dpage, rect, P(theme, 'detail.png'));
    rec(theme, 'detail.png', 'detail', 'dpr-3 text macro from inside the address card (card fill bleeds on all four sides, the 1px row divider runs edge to edge): HELIUM ADDRESS label + monospace B58 line over SOLANA ADDRESS label + teal base58 explorer link and arrow', rect, 'detail');
  }
  await dpage.context().close();

  // Manifest (both themes).
  const order = ['hero.png', 'outcome.png', 'success-banner.png', 'converter-form.png', 'address-pair.png', 'wallet-input.png', 'detail.png', 'viewport.png', 'full.png'];
  shots.sort((a, b) => order.indexOf(a.file.split('/')[1]) - order.indexOf(b.file.split('/')[1]) || (a.theme === 'light' ? -1 : 1));
  const manifest = {
    slug: 'l1-migration',
    route: ROUTE,
    wallet: WALLET,
    notes: `Input is the legacy Helium L1 B58 form (${helium}) of the "main" showcase wallet ${WALLET}; the page derives both encodings client-side. The post-action state (hero, outcome, success-banner, viewport, full) shows the tool's real success StatusBanner with the worker's exact message "${SUCCESS_MSG}": the POST /l1-migration/migrate was fulfilled locally by a Playwright page.route mock ({ success: true, transactionsProcessed: 3 }) before Seed Wallet was clicked, so no request reached the worker and nothing was broadcast. converter-form.png is the pre-action form (no banner). detail.png (dpr 3) is cropped inside the address card, ending just past the address text, so it also serves as the tight text-width variant of address-pair.png. The input keeps its accent focus ring in every shot. The page is a single 768px column, so full.png is short and close to viewport.png.`,
    shots,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote', shots.length, 'shots');
}, { timeoutMs: 180000 });
