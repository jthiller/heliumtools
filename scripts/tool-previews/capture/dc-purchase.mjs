// Buy Data Credits (/dc-purchase) — source captures for the landing-page preview art.
//
//   node capture/dc-purchase.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/dc-purchase/{light,dark}/*.png and manifest.json (OUT_DIR
// overrides the directory). The landing card uses hero.png and order-progress.png
// (previews/dc-purchase.js).
//
// Read-only: types an OUI + USD amount (the form auto-resolves the OUI's live escrow
// balance via GET /dc-purchase/oui/<n>). Never submits the form / never POSTs /orders.
// No email is typed (task safety rule): the OPTIONAL email field is collapsed with CSS
// in the form shots instead, so no empty placeholder input shows.
// The order-status shots use a LOCAL MOCK of GET /dc-purchase/orders/<id> (page.route
// fulfill) — no order exists; they depict the tool's real OrderStatus UI post-checkout.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, writeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/dc-purchase/', import.meta.url));
const OUI = '2';
const USD = '250';
const THEMES = ['light', 'dark'];
const out = (theme, name) => path.join(OUT, theme, name);

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "dc-purchase",
  route: "/dc-purchase",
  wallet: null,
  notes: "No wallet: the tool is wallet-less. Form populated by typing OUI 2 and $250; OUI 2 resolved LIVE via GET /dc-purchase/oui/2 (escrow balance 661,982,009 DC = $6,619.82; the dpr-3 detail page re-served that same captured response locally to avoid a second prod hit). The form was never submitted, no POST /orders was made, Coinbase Onramp was never opened. No email address was typed (the task safety rule forbids it), so the OPTIONAL email field is collapsed with CSS in every form shot instead of showing an empty placeholder input. order-progress.png, order-complete.png and full.png show the real OrderStatus UI (/dc-purchase/order/<random uuid>) fed by a LOCAL page.route MOCK of GET /dc-purchase/orders/<id>; no order exists. Amounts are illustrative but consistent with live prices ($250 USDC at ~$0.4256/HNT -> 585.6124 HNT x 42,221 DC/HNT = 24,725,139 DC); payer/escrow are OUI 2's real keys; tx signatures are random base58 dummies that only appear in Solscan hrefs (the visible text is the link labels). Cosmetic CSS: balance-card wrapper overflow relaxed so its soft shadow is not shaved; hero hides the description paragraph and amber disclaimer and uses 40px side gutters. The tool is disabled on the landing page (Coming Soon).",
  shots: {
    "hero.png": { dpr: 2, kind: "hero", role: "hero", describes: "Eyebrow \"DATA CREDITS\" + h1 \"Buy Data Credits\" over the populated purchase form (OUI Number 2, Amount $250, Minimum $5 USD, Continue to Coinbase button) beside the live OUI 2 balance card ($6,619.82 / 661,982,009 DC, payer + escrow rows). 800px layout: form column (~332px) and card (340px) near-equal widths sharing a top edge; even 40px inset. Description paragraph, amber disclaimer and the optional email field collapsed via CSS." },
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Whole tool at 1440x960: site header, heading + description, form with OUI 2 and $250 entered, live OUI 2 balance card at right, amber USDC->HNT->DC disclaimer. Optional email field collapsed." },
    "full.png": { dpr: 2, kind: "full", role: "backdrop", describes: "Full-page Order Status page at 1440 wide (MOCKED completed order): heading \"Data Credit Purchase\", mint-green \"24,725,139 Data Credits Delivered\" banner, order details, all-green Progress panel, Transactions links, amber Note, \"Buy More Credits\" / \"View OUI Balance\" buttons." },
    "balance-card.png": { dpr: 2, kind: "element", role: "supporting", describes: "Resolved-OUI balance card alone: OUI 2, CURRENT BALANCE $6,619.82, 661,982,009 DC, inset footer with PAYER (copy icon) and ESCROW (Solscan link) rows; 28px padding keeps the soft shadow." },
    "purchase-form.png": { dpr: 2, kind: "element", role: "supporting", describes: "The purchase form alone (1024 layout): OUI NUMBER 2, AMOUNT (USD) $250, Minimum $5 USD, wide accent \"Continue to Coinbase\" button. Optional email field collapsed." },
    "mobile-stack.png": { dpr: 2, kind: "element", role: "supporting", describes: "Phone-width (430px) layout, strong portrait: balance card stacked above the form, down to the Continue to Coinbase button. Optional email field collapsed." },
    "order-progress.png": { dpr: 2, kind: "element", role: "supporting", describes: "Order Status Progress panel at phone width (single column, so it reads as a linear top-to-bottom pipeline; MOCKED order mid-flight): Checkout Started / Payment Confirmed / USDC Received / Swapping to HNT / Minting DC done (green dots), Delegating to OUI current (accent dot, bold), Complete pending (grey)." },
    "order-complete.png": { dpr: 2, kind: "element", role: "supporting", describes: "Order Status after completion (MOCKED order), portrait: mint-green \"24,725,139 Data Credits Delivered\" banner, details card (Order ID, $250.00, 585.6124 HNT received, 24,725,139 DC minted, OUI 2 payer key + escrow), all-green 2-column Progress panel, and the Transactions list (USDC Receipt / HNT Swap / DC Mint / Delegation links); stops above the amber Note." },
    "detail.png": { dpr: 3, kind: "detail", role: "detail", describes: "dpr-3 macro inside the balance card: OUI 2 / CURRENT BALANCE / $6,619.82 / 661,982,009 DC with an even 14px inset, all on the card surface (no edges)." },
  },
};

// Page-coordinate rect of an element.
async function rectOf(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  });
}
const pad = (r, px, py = px) => ({ x: Math.max(0, r.x - px), y: Math.max(0, r.y - py), width: r.width + 2 * px, height: r.height + 2 * py });
function union(...rs) {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
}
const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

// Base58 dummy tx signature (88 chars) — only ever lands in a Solscan href of the mocked order.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeSig = () => Array.from(crypto.randomBytes(88), (b) => B58[b % 58]).join('');

// Cosmetic CSS shared by the form shots:
//  - the balance card's wrapper is overflow-hidden, which shaves the card's own soft shadow
//  - the OPTIONAL email field is collapsed (we never type an email address)
const FORM_CSS = `
  main div.order-1:has(> .shadow-soft){overflow:visible!important}
  main form > div:has(#email){display:none!important}
`;

async function populateForm(page, sleep, cached) {
  if (cached) {
    // Re-serve the live resolve captured on the first page (same data, no extra prod hit).
    await page.route(`**/api/dc-purchase/oui/${OUI}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: cached }));
  }
  await page.goto(BASE + '/dc-purchase', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#oui', { timeout: 20000 });
  let body = cached || null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const respP = page.waitForResponse((r) => r.url().includes(`/dc-purchase/oui/${OUI}`), { timeout: 20000 }).catch(() => null);
    await page.fill('#oui', '');
    await page.fill('#oui', OUI);
    await page.fill('#usd', USD);
    const resp = await respP;
    if (resp && resp.status() === 429) { console.log('429 on resolve, waiting 45s'); await sleep(45000); continue; }
    const ok = await page.waitForSelector('text=Current Balance', { timeout: 20000 }).then(() => true).catch(() => false);
    if (ok) { if (resp && !cached) body = await resp.text().catch(() => null); break; }
    console.log('resolve did not populate, waiting 45s'); await sleep(45000);
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(2, 2);
  await page.addStyleTag({ content: FORM_CSS });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200); // card fade/translate transition
  return body;
}

await run(async ({ newPage, settle, shoot, shootRect, sleep }) => {
  let resolveBody = null;

  {
    // ---------- 1. The purchase form, OUI resolved, amount entered ----------
    const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
    resolveBody = await populateForm(page, sleep, null);
    await settle(page, 500);
    console.log('balance card:', (await page.locator('.shadow-soft').first().innerText()).replace(/\n/g, ' | '));

    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(500);
      await shoot(page, 'viewport', out(theme, 'viewport.png'));
      await shootRect(page, round(pad(await rectOf(page, '.shadow-soft'), 28)), out(theme, 'balance-card.png'));
    }

    // ---------- 2. Purchase form alone (1024 layout) ----------
    // Amber disclaimer below the form hidden (visibility only) so the padded crop doesn't catch its edge.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: 'main .bg-amber-50{visibility:hidden!important}' });
    await sleep(700);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(400);
      await shootRect(page, round(pad(await rectOf(page, 'main form'), 32)), out(theme, 'purchase-form.png'));
    }

    // ---------- 3. Hero: h1 + form beside the balance card, one balanced pair ----------
    // Generic description paragraph and the amber disclaimer collapsed; side gutters set to
    // 40px so the clip has an even 40px inset. At 800px the form column (~332px) and the
    // 340px card are near-equal widths and share a top edge (the layout's own alignment).
    const HERO_W = 800;
    await page.setViewportSize({ width: HERO_W, height: 900 });
    const heroCss = await page.addStyleTag({ content: `
      main > div.mb-10 > p.text-lg{display:none!important}
      main .bg-amber-50{display:none!important}
      main{padding-left:40px!important;padding-right:40px!important}
    ` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(900);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(400);
      const head = await rectOf(page, 'main > div.mb-10');
      const form = await rectOf(page, 'main form');
      const card = await rectOf(page, '.shadow-soft');
      const P = 40;
      const top = head.y - P;
      const bottom = Math.max(form.y + form.height, card.y + card.height) + P;
      const r = round({ x: 0, y: top, width: HERO_W, height: bottom - top });
      console.log('hero rect', theme, JSON.stringify(r));
      await shootRect(page, r, out(theme, 'hero.png'));
    }

    // ---------- 4. Phone-width stack: balance card above the form (the layout's own order) ----------
    await page.setViewportSize({ width: 430, height: 932 });
    await heroCss.evaluate((el) => el.remove());
    await page.addStyleTag({ content: 'main{padding-left:24px!important;padding-right:24px!important}' });
    await sleep(800);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(400);
      const card = await rectOf(page, '.shadow-soft');
      const btn = await rectOf(page, 'main form button[type=submit]');
      const y = card.y - 24;
      const r = round({ x: 0, y, width: 430, height: btn.y + btn.height + 24 - y });
      console.log('stack rect', theme, JSON.stringify(r));
      await shootRect(page, r, out(theme, 'mobile-stack.png'));
    }
    await page.context().close();
  }

  {
    // ---------- 5. Detail (dpr 3): tight macro of the balance block, inset inside the card ----------
    const d = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 3 });
    await populateForm(d, sleep, resolveBody);
    for (const theme of THEMES) {
      await d.emulateMedia({ colorScheme: theme });
      await sleep(500);
      // Text bounds of OUI 2 / CURRENT BALANCE / $x / n DC (Range = glyph extents, not the block width).
      const t = await d.locator('.shadow-soft > div:first-child').evaluate((el) => {
        const rects = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          rects.push(...[...rg.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
        }
        const x = Math.min(...rects.map((q) => q.left)), y = Math.min(...rects.map((q) => q.top));
        const r = Math.max(...rects.map((q) => q.right)), b = Math.max(...rects.map((q) => q.bottom));
        return { x: x + scrollX, y: y + scrollY, width: r - x, height: b - y };
      });
      const r = round(pad(t, 14)); // 14px stays inside the card (20px padding) and clear of its 12px corner radius
      console.log('detail rect', theme, JSON.stringify(r));
      await shootRect(d, r, out(theme, 'detail.png'));
    }
    await d.context().close();
  }

  {
    // ---------- 6. Order status (MOCKED GET /orders/<id>; no order is created) ----------
    const orderId = crypto.randomUUID();
    // payer/escrow come only from the live OUI resolve above; no key is hard-coded here.
    const resolved = resolveBody ? JSON.parse(resolveBody) : null;
    const { payer, escrow } = resolved ?? {};
    if (!payer || !escrow) throw new Error(`OUI ${OUI} did not resolve live (no payer/escrow); re-run`);
    // $250 of USDC -> ~585.61 HNT at ~$0.4256 -> x 42,221 DC/HNT (live mint price) ≈ 24.7M DC
    const sigs = { usdcSig: fakeSig(), swapSig: fakeSig(), mintSigs: [fakeSig()], delegateSig: fakeSig() };
    let mockStatus = 'delegating';
    const o = await newPage({ colorScheme: 'light', width: 430, height: 932, dpr: 2 });
    await o.route('**/api/dc-purchase/orders/**', (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const done = mockStatus === 'complete';
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          orderId, status: mockStatus, oui: Number(OUI), payer, escrow,
          usdRequested: 250, usdcAmountReceived: 250000000,
          hntAmountReceived: '58561237400', dcDelegated: '24725139',
          coinbaseTransactionId: null,
          txs: { usdcSig: sigs.usdcSig, swapSig: sigs.swapSig, mintSigs: sigs.mintSigs, delegateSig: done ? sigs.delegateSig : null },
          errorCode: null, errorMessage: null, updatedAt: new Date().toISOString(),
        }),
      });
    });
    await o.goto(`${BASE}/dc-purchase/order/${orderId}`, { waitUntil: 'domcontentloaded' });
    await o.waitForSelector('text=HNT Received', { timeout: 20000 });
    await o.evaluate(() => document.fonts.ready);
    await o.mouse.move(2, 2);
    await sleep(1200);
    const progressSel = 'main .bg-surface-inset';
    // Phone width (<640px): the Progress grid is a single column, so the 7 steps read as a
    // linear top-to-bottom pipeline (at sm+ it is a 2-column grid that reads row by row).
    for (const theme of THEMES) {
      await o.emulateMedia({ colorScheme: theme });
      await sleep(500);
      await shootRect(o, round(pad(await rectOf(o, progressSel), 16)), out(theme, 'order-progress.png'));
    }

    mockStatus = 'complete';
    await o.setViewportSize({ width: 1440, height: 960 });
    await o.waitForSelector('text=Data Credits Delivered', { timeout: 15000 });
    await o.waitForSelector('text=Delegation', { timeout: 15000 });
    await o.evaluate(() => window.scrollTo(0, 0));
    await sleep(1200);
    for (const theme of THEMES) {
      await o.emulateMedia({ colorScheme: theme });
      await sleep(500);
      // Banner through the Transactions list, stopping above the amber Note.
      const banner = await rectOf(o, 'main .space-y-8 > div:first-child');
      const txs = await rectOf(o, 'main .space-y-8 > div.space-y-3');
      const r = round(pad(union(banner, txs), 32));
      console.log('order-complete rect', theme, JSON.stringify(r));
      await shootRect(o, r, out(theme, 'order-complete.png'));
      // Full Order Status page as a second backdrop.
      await shoot(o, 'full', out(theme, 'full.png'));
    }
    await o.context().close();
  }

  writeManifest(OUT, MANIFEST);
}, { timeoutMs: 420000 });
