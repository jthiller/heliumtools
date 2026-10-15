// Mint Data Credits (/dc-mint) — source captures for the landing-page preview art.
//
//   node capture/dc-mint.mjs            (from scripts/tool-previews; frontend on BASE)
//   node capture/dc-mint.mjs sources    (only the source pass)
//   node capture/dc-mint.mjs macros     (only the card's macros)
//
// Writes captures/dc-mint/{light,dark}/*.png and manifest.json (OUT_DIR overrides
// the directory). The landing card uses quote-macro.png and wallet-macro.png
// (previews/dc-mint.js).
//
// Read-only: fake-connects the `nyc` showcase wallet (62.87 HNT + 45.9M DC) as a
// read-only Phantom, types amounts, switches tabs, and resolves OUI 1. It never
// clicks "Mint Data Credits" / "Burn HNT & Delegate" (signing is disabled anyway).
// Light and dark come from the same load via emulateMedia.
//
// Macros: from one more page state (50 typed into "HNT to burn" on the Mint DC tab),
// light then dark:
//   quote-macro.png   the burn -> receive quote panel at dpr 5, so the card can
//                     show its two amounts at ~2.8x and stay crisp on retina
//   wallet-macro.png  the Phantom wallet pill over the Wallet balance strip, dpr 5
// The quote is priced live, so its numbers change from one capture to the
// next. The card crops it to its two amounts (previews/dc-mint.js); the digits
// are monospace and right-aligned, so that rect holds while the DC amount keeps
// its digit count. Re-check it if the count changes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, WALLETS, writeManifest, mergeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/dc-mint/', import.meta.url));
const PHASE = process.argv[2]; // 'sources' | 'macros' | undefined (both)
if (PHASE && !['sources', 'macros'].includes(PHASE)) throw new Error(`unknown phase ${PHASE}: use sources or macros`);
const ROUTE = '/dc-mint';
const WALLET = WALLETS.nyc;
const THEMES = ['light', 'dark'];
const MINT_HNT = '50';
const DELEGATE_OUI = '1';
const DELEGATE_DC = '2000000';
const P = (theme, f) => path.join(OUT, theme, f);

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "dc-mint",
  route: "/dc-mint",
  wallet: "nycgFaZYkY9B7833tbU9y3LApRXXyTWL5r1RQNJR5Ux",
  notes: "Fake-connected the nyc showcase wallet (read-only Phantom): it is the one with both balances populated (62.8701 HNT + 45,936,375 DC; main has 1483 HNT but 0 DC). Mint tab: typed 50 HNT -> quote at the live oracle mint price (1 HNT = 42,221 DC, HNT $0.42). Delegate tab: OUI 1 resolves to the well-known Helium Foundation Console (IoT escrow 31.9M DC, auto-selected/highlighted); Burn HNT -> Delegate, Specify DC to deliver = 2,000,000. Nothing was clicked except the Delegate to OUI tab and inputs; no build/sign/broadcast requests were made. Light and dark from the same load via emulateMedia (Phantom wallet button stays purple in both). For the tight crops the page h1 + intro paragraph are set visibility:hidden so top padding is clean background (no layout shift). The page is a single narrow (max-w-lg, 480px card) form, so hero and delegate-card are portrait. Quirk of the real tool: in HNT mode the burn side USD (~$21.00) uses the 2-decimal hnt_usd while the DC side (~$21.11) uses dc_per_hnt, so the two dollar figures differ slightly; the delegate quote (DC target mode) reads ~$20.00 on both sides. Prices are live and will differ on re-capture.",
  shots: {
    "hero.png": { dpr: 2, kind: "crop", role: "hero", describes: "Mint DC tab: tab switcher + the populated mint card — connected Phantom wallet pill (nycg..R5Ux), wallet balance 62.8701 HNT / 45,936,375 DC, Specify HNT toggle, focused HNT-to-burn input (50), oracle-priced quote (You burn 50.0000 HNT ~$21.00 / You receive 2,111,050 DC ~$21.11, 1 HNT = 42,221 DC), recipient field, Mint Data Credits button. Intro title/paragraph hidden (visibility) so the top padding is clean page background." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Full 1440x960 viewport of /dc-mint on the Mint DC tab, populated (connected wallet, balances, 50 HNT typed, live DC quote)." },
    "full.png": { dpr: 2, kind: "full", role: "backdrop", describes: "Full page of /dc-mint on the Delegate to OUI tab: OUI 1 resolved to Helium Foundation Console (IoT escrow 31,942,791 DC selected), Burn HNT -> Delegate, 2,000,000 DC to deliver with quote (47.3698 HNT ~$20.00), Burn HNT & Delegate button." },
    "delegate-card.png": { dpr: 2, kind: "crop", role: "supporting", describes: "Delegate to OUI tab: tab switcher + full delegate card — wallet pill, OUI input (1), resolved OUI card (Helium Foundation Console, payer 112qB3Ya...1QpE, selected IoT escrow row 31,942,791 DC ~$319.43), two segmented toggles, DC-to-deliver input (2000000), burn quote, Burn HNT & Delegate button. Naturally tall portrait." },
    "burn-quote.png": { dpr: 2, kind: "crop", role: "supporting", describes: "The core HNT->DC conversion: Specify HNT / Specify DC segmented toggle, focused HNT-to-burn input (50, accent ring), and the quote panel (You burn 50.0000 HNT / You receive 2,111,050 DC / 1 HNT = 42,221 DC · HNT $0.42)." },
    "oui-resolved.png": { dpr: 2, kind: "crop", role: "supporting", describes: "OUI resolution: OUI Number or Payer Key input (1, Detected: OUI number) above the resolved target card — Name Helium Foundation Console, Payer, accent-highlighted IoT escrow row with 31,942,791 DC (~$319.43) and escrow address." },
    "wallet-balance.png": { dpr: 2, kind: "crop", role: "supporting", describes: "Connected Phantom wallet pill (purple, nycg..R5Ux) above the Wallet balance strip: 62.8701 HNT  45,936,375 DC (mono)." },
    "detail.png": { dpr: 3, kind: "crop", role: "detail", describes: "Macro (dpr 3) of the quote panel alone: You burn 50.0000 HNT (~$21.00) / You receive 2,111,050 DC (~$21.11) / 1 HNT = 42,221 DC · HNT $0.42." },
  },
};

async function box(loc) {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
}
// Union of boxes, padded (CSS px), rounded.
function frame(boxes, padX, padTop, padBottom = padTop) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: Math.round(x0 - padX), y: Math.round(y0 - padTop), width: Math.round(x1 - x0 + 2 * padX), height: Math.round(y1 - y0 + padTop + padBottom) };
}

// For tight crops only: hide the page title + intro paragraph (visibility, so no
// layout shift) so a crop's top padding never catches a sliver of their text.
async function hideIntro(page, on) {
  await page.evaluate((on) => {
    for (const el of document.querySelectorAll('main > h1, main > p')) el.style.visibility = on ? 'hidden' : '';
  }, on);
}

async function loadReady(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => {
        const t = document.body.innerText;
        return /\d+\.\d{4} HNT/.test(t) && /[\d,]+ DC/.test(t) && t.includes('Exchange rate') && !t.includes('...');
      }, null, { timeout: 45000 });
      return;
    } catch (e) {
      console.log('not ready (attempt', attempt, ', status', resp && resp.status(), ') — waiting 40s');
      await new Promise((r) => setTimeout(r, 40000));
    }
  }
  throw new Error('page never populated');
}

async function sources({ newPage, shoot, shootRect, sleep }) {
  const page = await newPage({ colorScheme: 'light', wallet: WALLET, width: 1440, height: 960, dpr: 2 });
  await loadReady(page);

  // ---- Mint tab: type an HNT amount so the oracle-priced quote fills in.
  const hntInput = page.locator('input[placeholder="e.g. 0.5"]');
  await hntInput.click();
  await hntInput.pressSequentially(MINT_HNT, { delay: 60 });
  await page.waitForFunction(() => document.body.innerText.includes('You receive'), null, { timeout: 10000 });
  await page.mouse.move(5, 950);
  await sleep(500);

  const tabs = page.locator('main > div.mt-6.flex').first();
  const card = page.locator('main > div.rounded-2xl').first();
  const walletBtn = card.locator('.wallet-adapter-button').first();
  const balance = card.locator('div.rounded-lg.bg-surface-inset').filter({ hasText: 'Wallet balance' }).first();
  const amountField = hntInput.locator('..');
  const quote = card.locator('div.rounded-lg.border').filter({ hasText: 'You receive' }).first();
  const modeToggle = card.locator('div.flex.gap-1').filter({ hasText: 'Specify HNT' }).first();

  console.log('mint text:', (await card.innerText()).replace(/\s+/g, ' '));
  const [bTabs, bCard, bBtn, bBal, bAmt, bQuote, bToggle] = await Promise.all([tabs, card, walletBtn, balance, amountField, quote, modeToggle].map(box));

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(700);
    await shoot(page, 'viewport', P(theme, 'viewport.png'));
    await hideIntro(page, true);
    // Hero: tab switcher + the whole populated mint card, with breathing room.
    await shootRect(page, frame([bTabs, bCard], 48, 40), P(theme, 'hero.png'));
    // Connected wallet + balances.
    await shootRect(page, frame([bBtn, bBal], 24, 12), P(theme, 'wallet-balance.png'));
    // The burn quote: amount typed + oracle-priced HNT -> DC preview.
    await shootRect(page, frame([bToggle, bAmt, bQuote], 24, 12), P(theme, 'burn-quote.png'));
    await hideIntro(page, false);
  }

  // ---- Delegate tab: resolve OUI 1 and set a DC target to deliver.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Delegate to OUI', exact: true }).click();
  const ouiInput = page.locator('input[placeholder^="e.g. 1 or"]');
  await ouiInput.click();
  await ouiInput.pressSequentially(DELEGATE_OUI, { delay: 60 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await page.waitForFunction(() => document.body.innerText.includes('Helium Foundation Console'), null, { timeout: 20000 }).then(() => true, () => false);
    if (ok) break;
    console.log('OUI not resolved — retyping after 40s');
    await sleep(40000);
    await ouiInput.fill('');
    await sleep(800);
    await ouiInput.pressSequentially(DELEGATE_OUI, { delay: 60 });
  }
  const dcInput = page.locator('main input[placeholder="e.g. 100000"]');
  await dcInput.click();
  await dcInput.pressSequentially(DELEGATE_DC, { delay: 40 });
  await page.waitForFunction(() => document.body.innerText.includes('You receive'), null, { timeout: 10000 });
  await page.mouse.move(5, 950);
  await sleep(500);

  const resolved = card.locator('div.rounded-lg.border').filter({ hasText: 'Payer' }).first();
  const ouiField = ouiInput.locator('..');
  console.log('delegate text:', (await card.innerText()).replace(/\s+/g, ' '));
  const [bTabs2, bCard2, bRes, bOui] = await Promise.all([tabs, card, resolved, ouiField].map(box));

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(700);
    await shoot(page, 'full', P(theme, 'full.png'));
    await hideIntro(page, true);
    await shootRect(page, frame([bTabs2, bCard2], 48, 40), P(theme, 'delegate-card.png'));
    await shootRect(page, frame([bOui, bRes], 24, 12), P(theme, 'oui-resolved.png'));
    await hideIntro(page, false);
  }

  // ---- Detail at dpr 3: the burn quote panel, macro.
  const page3 = await newPage({ colorScheme: 'light', wallet: WALLET, width: 1440, height: 960, dpr: 3 });
  await loadReady(page3);
  const hnt3 = page3.locator('input[placeholder="e.g. 0.5"]');
  await hnt3.click();
  await hnt3.pressSequentially(MINT_HNT, { delay: 60 });
  await page3.waitForFunction(() => document.body.innerText.includes('You receive'), null, { timeout: 10000 });
  await hnt3.blur();
  await page3.mouse.move(5, 950);
  const quote3 = page3.locator('main div.rounded-lg.border').filter({ hasText: 'You receive' }).first();
  const bQ3 = await box(quote3);
  for (const theme of THEMES) {
    await page3.emulateMedia({ colorScheme: theme });
    await sleep(700);
    await shootRect(page3, frame([bQ3], 16, 14), P(theme, 'detail.png'));
  }

  writeManifest(OUT, MANIFEST);
}

// ---- Macros the landing card uses (dpr 5). Nothing is clicked, built, signed or sent.
const MACRO_DPR = 5;
const MACRO_PAD = 16; // page background kept around each element, CSS px
const mpad = (b, p = MACRO_PAD) => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
const munion = (a, b) => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
const snap = (r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });

async function macros({ newPage, settle, sleep, shootRect }) {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: MACRO_DPR, wallet: WALLET });
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Wallet balance').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => /\d\.\d{4} HNT\s+[\d,]+ DC/.test(document.body.innerText), null, { timeout: 30000 });
  await page.getByPlaceholder('e.g. 0.5').fill(MINT_HNT);
  await page.getByText('You receive').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.activeElement?.blur()); // no caret or focus ring in the shots
  await settle(page, 1500);

  const quote = page.locator('div.bg-surface-inset', { has: page.getByText('You receive') }).last();
  const balance = page.locator('div.bg-surface-inset', { has: page.getByText('Wallet balance') }).first();
  const pill = page.locator('.wallet-adapter-button').first();
  await quote.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  const abs = (b) => ({ ...b, y: b.y + scrollY }); // boundingBox is viewport-relative; shootRect clips the full page
  const rects = {
    'quote-macro.png': snap(mpad(abs(await quote.boundingBox()))),
    'wallet-macro.png': snap(mpad(abs(munion(await pill.boundingBox(), await balance.boundingBox())))),
  };
  const text = (await quote.innerText()).replace(/\s+/g, ' ').trim();

  const shots = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(800);
    for (const [file, r] of Object.entries(rects)) {
      await shootRect(page, r, P(theme, file));
      shots.push({
        file: `${theme}/${file}`,
        theme,
        kind: 'crop',
        describes:
          file === 'quote-macro.png'
            ? `Macro (dpr ${MACRO_DPR}) of the Mint DC quote panel alone, live-priced at capture: ${text}.`
            : `Macro (dpr ${MACRO_DPR}) of the connected Phantom wallet pill (nycg..R5Ux) over the Wallet balance strip (HNT + DC, mono).`,
        cssWidth: r.width,
        cssHeight: r.height,
        role: 'detail',
      });
      console.log('wrote', `${theme}/${file}`, `${r.width}x${r.height} css`);
    }
  }
  mergeManifest(OUT, shots, { seed: { slug: MANIFEST.slug, route: MANIFEST.route, wallet: MANIFEST.wallet } });
  console.log('quote:', text);
}

await run(async (h) => {
  if (PHASE !== 'macros') await sources(h);
  if (PHASE !== 'sources') await macros(h);
}, { timeoutMs: 360000 + 240000 });
