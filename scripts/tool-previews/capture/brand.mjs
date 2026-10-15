// Brand Guidelines (/brand) — source captures for the landing-page preview art.
//
//   node capture/brand.mjs      (from scripts/tool-previews; frontend on BASE)
//
// Writes captures/brand/{light,dark}/*.png and manifest.json (OUT_DIR overrides
// the directory). The landing card uses hero.png and detail.png, plus mark.png on its
// wide layout (previews/brand.js).
//
// Static, frontend-only page: no wallet, no API. One page load; light and dark
// from the same load via emulateMedia (Tailwind darkMode "media"; every logo
// stage uses fixed colors, so only the page chrome changes between themes).
// Read-only: nothing is clicked. Crops only hide existing UI with temporary
// CSS (the site header, section intro paragraphs, family descriptions and
// file buttons for the logo matrix); nothing is added or redrawn.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, BASE, writeManifest } from '../lib.mjs';

const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : fileURLToPath(new URL('../captures/brand/', import.meta.url));
const ROUTE = '/brand';
const THEMES = ['light', 'dark'];

// manifest.json: the capture's meta and what each shot shows (the css sizes come
// from the PNGs). The text records the reference capture; live figures drift.
const MANIFEST = {
  slug: "brand",
  route: "/brand",
  wallet: null,
  notes: "Static, frontend-only page (no API, no wallet). One load; light and dark from the same load via emulateMedia (detail from a second dpr-3 load). Waited for every logo <img> to decode and for the Figtree 900 specimen face. Logo stages use fixed colors in both themes (purple/black on white, white on #0F0F12), so only the page chrome changes in dark; in dark the first hero tile shows the purple lockup on the dark card, as the page renders it. Nothing clicked. Crops use temporary CSS only: site header and section intro paragraphs hidden; neighbouring sections set visibility:hidden so card shadows do not bleed into padded crops; for hero.png the family descriptions and SVG/PNG file buttons are collapsed to make a tight 4x3 logo matrix (logo-files.png shows the same cards unmodified). No UI invented. Hero is a natural portrait (1024x1198); hero-stage.png is the wide landscape alternative. Six supporting crops (one over the 2-5 guide) because logo-files (the actual download UI) and mark (the 45° figure) are both distinct layerable pieces.",
  shots: {
    "viewport.png": { dpr: 2, kind: "viewport", role: "backdrop", describes: "Top of the page at 1440x960: header with breadcrumb, eyebrow BRAND GUIDELINES · DIRECT-LINK ASSETS, H1 The Helium marks, intro + third-party notice, the two big hero tiles (purple Helium lockup; white lockup on a Helium Purple panel), Download all ZIP · 274 KB row, and the top of The mark card" },
    "full.png": { dpr: 2, kind: "full", role: "backdrop", describes: "Entire page: hero tiles, The mark (roundel with 45° axis) + four principle cards, Logo family (4 marks x 3 colorways with SVG/PNG download + copy-link buttons), Do and don't grid, clear space and minimum size, Colorways + supporting palette, Figtree type specimen, Beyond the logo, Direct links (URL pattern + code blocks), Ownership and terms" },
    "hero.png": { dpr: 2, kind: "hero", role: "hero", describes: "Logo matrix: ASSETS / Logo family title over the four family cards (Helium Primary lockup, Helium Roundel Symbol, HeliumOS Product lockup, Helium Plus Product lockup), each with its three colorway stages (purple on white, black on white, white on near-black) and swatch + hex labels. Family descriptions and SVG/PNG file buttons collapsed via temporary CSS; natural portrait" },
    "hero-stage.png": { dpr: 2, kind: "element", role: "supporting", describes: "Wide banner: eyebrow + H1 The Helium marks over the two big hero tiles (purple Helium lockup on a white card; white lockup on a solid Helium Purple panel) and the Download all ZIP row (intro paragraphs and site header collapsed)" },
    "logo-files.png": { dpr: 2, kind: "element", role: "supporting", describes: "The Helium and Helium Roundel family cards exactly as they ship: name + pill, description, three colorway stages, swatch + hex, and per-file SVG/PNG download buttons with dimensions and byte size plus copy-link icons" },
    "mark.png": { dpr: 2, kind: "element", role: "supporting", describes: "LOGO / The mark: large purple roundel with the dashed 45° axis and 45° label, beside What the files contain, Orientation, and the sourced glossary (Roundel, Wordmark, Lockup)" },
    "do-dont.png": { dpr: 2, kind: "element", role: "supporting", describes: "USAGE / Do and don't: 3x3 grid of example tiles with green check / red x badges: use files as shipped, white on purple, black for one-color; don't drop the circle, rotate, stretch, recolor (orange-pink-purple gradient roundel), add effects (stroke + drop shadow), or sacrifice contrast (purple on navy)" },
    "palette.png": { dpr: 2, kind: "element", role: "supporting", describes: "COLOR / Colorways: Helium Purple #5F26FC, Black #000000, White #FFFFFF rows with swatches and copy buttons, plus the Supporting palette card (Primary Blue, Orange, Night, Off White, Light Gray, Border, Gray swatches with hex and usage)" },
    "typography.png": { dpr: 2, kind: "element", role: "supporting", describes: "TYPE / Typography: Figtree Black uppercase specimen A NETWORK BUILT BY PEOPLE, NOT TOWERS with the last clause in Helium Purple, body line, and the Family / Display / Headings / Body / Posters spec grid" },
    "detail.png": { dpr: 3, kind: "detail", role: "detail", describes: "Macro at dpr 3: one asset column of the Helium Roundel family: purple roundel on its white stage, Purple #5F26FC swatch label, and the SVG 421x421 · 2.5 KB / PNG 841x841 px · 29.5 KB download buttons with copy-link icons" },
  },
};

// Page-coordinate box of an element (CSS px).
async function box(page, sel) {
  return page.evaluate((s) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) throw new Error('missing ' + s);
    const b = el.getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
  }, sel);
}
const union = (...bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.width)), btm = Math.max(...bs.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
};
// Hide (visibility only, so layout is untouched) everything in <main> that is
// not one of the kept elements, an ancestor of one, or inside one. Stops the
// neighbouring cards' soft shadows bleeding into a padded crop.
async function isolate(page, sels) {
  await page.evaluate((sels) => {
    const keep = sels.flatMap((s) => [...document.querySelectorAll(s)]);
    const walk = (el) => {
      for (const c of el.children) {
        if (keep.includes(c)) continue;
        if (keep.some((k) => c.contains(k))) walk(c);
        else c.setAttribute('data-cap-hide', '');
      }
    };
    walk(document.querySelector('main'));
  }, sels);
}
async function unisolate(page) {
  await page.evaluate(() => document.querySelectorAll('[data-cap-hide]').forEach((e) => e.removeAttribute('data-cap-hide')));
}
const pad = (b, px, py = px) => ({
  x: Math.max(0, Math.round(b.x - px)), y: Math.max(0, Math.round(b.y - py)),
  width: Math.round(b.width + 2 * px), height: Math.round(b.height + 2 * py),
});

// Tag sections once so crops can address them by name.
const TAG_SECTIONS = `(() => {
  const names = ['hero-stage','mark','family','do-dont','clear-space','colorways','type','beyond','links','terms'];
  document.querySelectorAll('main > div.space-y-12 > section').forEach((s, i) => s.setAttribute('data-cap', names[i] || 's' + i));
})()`;

async function ready(page) {
  await page.waitForFunction(() => document.querySelectorAll('main > div.space-y-12 > section').length >= 10, null, { timeout: 30000 });
  // Every logo <img> decoded, and the Figtree specimen face (loaded on mount) in.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return document.fonts.check('900 48px Figtree') && [...document.fonts].some((f) => f.family.includes('Figtree') && f.weight === '900' && f.status === 'loaded');
  }, null, { timeout: 30000 });
  await page.evaluate(TAG_SECTIONS);
}

await run(async ({ newPage, settle, shoot, shootRect, sleep }) => {
  const page = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 2 });
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await settle(page, 1200);
  await ready(page);

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(700);
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });

    await shoot(page, 'viewport', path.join(dir, 'viewport.png'));
    await shoot(page, 'full', path.join(dir, 'full.png'));

    // Crops: drop the site header and the section intro paragraphs so each
    // piece is its eyebrow + title + card(s).
    const crop = await page.addStyleTag({ content:
      'header{display:none!important}' +
      'section[data-cap] > div.mb-4 > p.max-w-2xl{display:none!important}' +
      '[data-cap-hide]{visibility:hidden!important}' });
    await sleep(400);

    // Hero: the logo matrix. Four marks x three colorways, each family card
    // reduced to its name + pill, the three stages and the colorway labels
    // (descriptions and the SVG/PNG file buttons collapsed).
    {
      const hide = await page.addStyleTag({ content:
        'section[data-cap="family"] .space-y-5 > section .max-w-xl > p{display:none!important}' +
        'section[data-cap="family"] .space-y-5 > section .flex.flex-col.gap-2{display:none!important}' +
        'section[data-cap="family"] .space-y-5 > section > div.mb-5{margin-bottom:16px!important}' });
      await isolate(page, ['section[data-cap="family"]']);
      await sleep(400);
      const b = await box(page, 'section[data-cap="family"]');
      const r = pad(b, 32, 28);
      console.log(theme, 'hero', JSON.stringify(r));
      await shootRect(page, r, path.join(dir, 'hero.png'));
      await unisolate(page);
      await hide.evaluate((el) => el.remove());
      await sleep(300);
    }

    // The two family cards as they ship, with the download / copy-link buttons:
    // what a visitor actually uses on this page.
    {
      await isolate(page, ['section[data-cap="family"] .space-y-5 > section:nth-child(-n+2)']);
      const cards = await page.$$eval('section[data-cap="family"] .space-y-5 > section', (els) => els.slice(0, 2).map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
      }));
      const r = pad(union(...cards), 28, 28);
      await shootRect(page, r, path.join(dir, 'logo-files.png'));
      await unisolate(page);
    }

    // Hero stage: title block + the two big lockup tiles + Download all.
    {
      const hide = await page.addStyleTag({ content: 'main > div.mb-10 > p:not(:first-child){display:none!important}' });
      await isolate(page, ['main > div.mb-10', 'section[data-cap="hero-stage"]']);
      await sleep(300);
      const r = pad(union(await box(page, 'main > div.mb-10'), await box(page, 'section[data-cap="hero-stage"]')), 32, 32);
      await shootRect(page, r, path.join(dir, 'hero-stage.png'));
      await unisolate(page);
      await hide.evaluate((el) => el.remove());
      await sleep(300);
    }

    // The mark: big roundel with the 45-degree axis + its explanation card.
    {
      await isolate(page, ['section[data-cap="mark"] > div.mb-4', 'section[data-cap="mark"] > section']);
      const r = pad(union(await box(page, 'section[data-cap="mark"] > div.mb-4'), await box(page, 'section[data-cap="mark"] > section')), 28, 28);
      await shootRect(page, r, path.join(dir, 'mark.png'));
      await unisolate(page);
    }

    // Do and don't: 3 do + 6 don't examples.
    {
      await isolate(page, ['section[data-cap="do-dont"]']);
      const r = pad(await box(page, 'section[data-cap="do-dont"]'), 28, 28);
      await shootRect(page, r, path.join(dir, 'do-dont.png'));
      await unisolate(page);
    }

    // Palette: the three logo colorways + the supporting palette.
    {
      await isolate(page, ['section[data-cap="colorways"]']);
      const r = pad(await box(page, 'section[data-cap="colorways"]'), 28, 28);
      await shootRect(page, r, path.join(dir, 'palette.png'));
      await unisolate(page);
    }

    // Typography: Figtree Black specimen.
    {
      await isolate(page, ['section[data-cap="type"]']);
      const r = pad(await box(page, 'section[data-cap="type"]'), 28, 28);
      await shootRect(page, r, path.join(dir, 'typography.png'));
      await unisolate(page);
    }

    await crop.evaluate((el) => el.remove());
    await sleep(300);
  }

  // Detail at dpr 3: one colorway column of the Helium Roundel family
  // (stage, swatch + hex, SVG and PNG download + copy-link buttons).
  {
    const p3 = await newPage({ colorScheme: 'light', width: 1440, height: 960, dpr: 3 });
    await p3.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
    await settle(p3, 800);
    await ready(p3);
    for (const theme of THEMES) {
      await p3.emulateMedia({ colorScheme: theme });
      await sleep(600);
      const col = await p3.$$eval('section[data-cap="family"] .space-y-5 > section', (els) => {
        const c = els[1].querySelector('.grid > div');
        const b = c.getBoundingClientRect();
        return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
      });
      const r = pad(col, 18, 18);
      console.log(theme, 'detail', JSON.stringify(r));
      await shootRect(p3, r, path.join(OUT, theme, 'detail.png'));
    }
    await p3.close();
  }

  writeManifest(OUT, MANIFEST);
}, { timeoutMs: 240000 });
