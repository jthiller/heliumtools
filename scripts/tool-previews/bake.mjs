// Bake landing tool-card prints: crop each real capture, resize, encode WebP.
//
//   node bake.mjs [slug...|all]  (default, or all: every tool with a preview config)
//
// Reads pages/public/src/pages/landing/previews/<slug>.js (default export), and
// for every print and theme crops captures/<slug>/<theme>/<file> by the print's
// rect (CSS px of the capture, scaled by the capture's dpr), resizes it to the
// print's `out` width and writes
// pages/public/src/assets/previews/<slug>/<id>-<theme>.webp. That covers the
// portrait `prints` and, for a featured card, the `featured` prints that have
// their own `src` (the others reuse a portrait print's file).
//
// Re-baking needs the local source captures (captures/ is git-ignored; see the
// README's Capture section). A print whose capture is missing is reported and
// its committed file is left alone. Files in a tool's folder that no print in
// its config names are deleted.
//
// Also checks, and exits 1 on: the byte budgets, a print's top edge (at rest and
// on hover) reaching into the card text, a rect running past its capture, an
// `out` wider than its crop, a capture missing from its manifest (unknown dpr),
// tone contrast (description ink >= 4.5:1 on both ground stops), a tone whose
// declared `hue` its grounds don't measure (or a neutral, `hue: null`, whose
// grounds have chroma), and the palette's neighbour rule (>= 30° of hue between
// cards that touch at 3, 2 and 1 columns, placed as landing/sections.js lays
// them out, featured cards spanning two columns; a neutral passes beside a
// hued card, two neutrals may not touch), a hole in the grid before its last
// row, and a featured card without a featured print set (or the reverse). The
// tone and palette checks run on every bake, which also lists the cards that
// get a running head at each width.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const LANDING_DIR = path.join(REPO, "pages/public/src/pages/landing");
const CONFIG_DIR = path.join(LANDING_DIR, "previews");
const ASSET_DIR = path.join(REPO, "pages/public/src/assets/previews");
const CAPTURES = path.join(HERE, "captures");
const THEMES = ["light", "dark"];
const QUALITY = 78;
const PRINT_BUDGET = 60 * 1024; // any single print
const THEME_BUDGET = 500 * 1024; // all tools, one theme (a visitor downloads one)
// Stage widths a composition is reported at: a desktop 3-column card and a
// 390px phone card for the portrait prints; a featured card spanning two
// desktop columns for the featured prints.
const STAGE_WIDTHS = { desktop: 340, phone: 358 };
const FEATURED_WIDTHS = { desktop: 698 };
const frameAt = (stageW) => Math.min(7, Math.max(4, stageW * 0.017));

const { fan, topEdge, STAGE_RATIO, FEATURED_RATIO, TOP_MARGIN } = await import(pathToFileURL(path.join(CONFIG_DIR, "layout.js")).href);
const { TONES, DESC_INK } = await import(pathToFileURL(path.join(CONFIG_DIR, "tones.js")).href);
const { PREVIEWS } = await import(pathToFileURL(path.join(CONFIG_DIR, "index.js")).href);
const { SECTIONS, placeCards, runningHeads } = await import(pathToFileURL(path.join(LANDING_DIR, "sections.js")).href);
const FEATURED_SLUGS = new Set(SECTIONS.flatMap((section) => section.tools).filter((t) => t.featured).map((t) => t.slug));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const NON_TOOL = new Set(["index.js", "tones.js", "layout.js"]);
const allSlugs = () =>
  fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".js") && !NON_TOOL.has(f)).map((f) => f.slice(0, -3)).sort();

const manifests = new Map();
function manifestShot(slug, theme, file) {
  if (!manifests.has(slug)) {
    const p = path.join(CAPTURES, slug, "manifest.json");
    manifests.set(slug, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { shots: [] });
  }
  return manifests.get(slug).shots.find((s) => s.file === `${theme}/${file}`);
}

const args = process.argv.slice(2).filter((a) => a !== "all");
const slugs = args.length ? args : allSlugs();
const warnings = [];

for (const slug of slugs) {
  const cfgPath = path.join(CONFIG_DIR, `${slug}.js`);
  if (!fs.existsSync(cfgPath)) {
    warnings.push(`${slug}: no config at ${path.relative(REPO, cfgPath)}`);
    continue;
  }
  const { default: cfg } = await import(pathToFileURL(cfgPath).href);
  const outDir = path.join(ASSET_DIR, slug);
  const totals = { light: 0, dark: 0 };
  const prints = cfg.prints;
  // A featured print without its own src reuses the portrait print with that id.
  const byId = new Map(prints.map((p) => [p.id, p]));
  const featured = (cfg.featured ?? []).map((p) => (p.src ? p : { ...byId.get(p.id), ...p, reused: true }));
  for (const p of cfg.featured ?? []) {
    if (!p.src && !byId.has(p.id)) warnings.push(`${slug}/featured ${p.id}: no src, and no portrait print with that id to reuse`);
    if (p.src && byId.has(p.id)) warnings.push(`${slug}/featured ${p.id}: has its own src but shares its id (and so its file) with a portrait print; rename it`);
  }
  if (FEATURED_SLUGS.has(slug) && !featured.length) warnings.push(`${slug}: featured in landing/sections.js but its config has no \`featured\` prints`);
  if (!FEATURED_SLUGS.has(slug) && featured.length) warnings.push(`${slug}: has \`featured\` prints but isn't featured in landing/sections.js; they'd never show`);
  // Every print with its own file: the portrait ones and the featured ones with a src.
  const baked = [...prints.map((p) => ({ ...p, stage: "portrait" })), ...featured.filter((p) => !p.reused).map((p) => ({ ...p, stage: "featured" }))];
  // The files this config owns: one per baked print, per theme.
  const expected = new Set(baked.flatMap((p) => THEMES.map((t) => `${p.id}-${t}.webp`)));
  console.log(`\n${slug}${prints.length ? "" : "  (no prints)"}`);

  // Lint: every print's on-card top edge stays TOP_MARGIN below the text, at
  // rest and in its hover pose (tilt and scale included), on each stage.
  for (const [stage, set, ratio] of [["", prints, STAGE_RATIO], ["featured ", featured, FEATURED_RATIO]]) {
    const topZ = Math.max(...set.map((p) => p.z));
    for (const p of set) {
      const rest = topEdge(p, ratio);
      const hover = topEdge(p, ratio, fan(p, p.z === topZ, ratio));
      for (const [state, top] of [["rest", rest], ["hover", hover]]) {
        if (top < TOP_MARGIN - 0.05) warnings.push(`${slug}/${stage}${p.id}: ${state} top edge at ${top.toFixed(1)}% of the stage, above the ${TOP_MARGIN}% keep-out; lower y, shrink w or ease the tilt`);
      }
    }
  }

  for (const p of baked) {
    const { file, rect } = p.src;
    for (const theme of THEMES) {
      const src = path.join(CAPTURES, slug, theme, file);
      const name = `${p.id}-${theme}.webp`;
      if (!fs.existsSync(src)) {
        warnings.push(`${slug}/${p.id}: missing capture ${path.relative(HERE, src)}; kept the committed ${name}`);
        if (fs.existsSync(path.join(outDir, name))) totals[theme] += fs.statSync(path.join(outDir, name)).size;
        continue;
      }
      const meta = await sharp(src).metadata();
      const shot = manifestShot(slug, theme, file);
      if (!p.src.dpr && !shot?.cssWidth) warnings.push(`${slug}/${p.id}-${theme}: ${theme}/${file} has no entry in captures/${slug}/manifest.json, so its dpr is unknown; baked at dpr 2 (re-run the capture script, or set src.dpr)`);
      const dpr = p.src.dpr ?? (shot?.cssWidth ? meta.width / shot.cssWidth : 2);
      const left = Math.round(rect.x * dpr);
      const top = Math.round(rect.y * dpr);
      let width = Math.round(rect.w * dpr);
      let height = Math.round(rect.h * dpr);
      if (left + width > meta.width || top + height > meta.height) {
        warnings.push(`${slug}/${p.id}-${theme}: rect runs past the ${(meta.width / dpr).toFixed(0)}x${(meta.height / dpr).toFixed(0)} capture; clamped`);
        width = Math.min(width, meta.width - left);
        height = Math.min(height, meta.height - top);
      }
      if (p.out > width) warnings.push(`${slug}/${p.id}-${theme}: out ${p.out}px exceeds the ${width}px crop; kept at ${width}px (no upscaling)`);

      fs.mkdirSync(outDir, { recursive: true });
      const info = await sharp(src)
        .extract({ left, top, width, height })
        .resize({ width: p.out, withoutEnlargement: true, kernel: "lanczos3" })
        .webp({ quality: p.q ?? QUALITY, effort: 6, smartSubsample: true })
        .toFile(path.join(outDir, name));
      totals[theme] += info.size;
      if (info.size > PRINT_BUDGET) warnings.push(`${slug}/${name}: ${kb(info.size)} is over the ${kb(PRINT_BUDGET)} per-print budget`);
      if (theme === "light") {
        // How big the capture renders: a source glyph of N px shows at N * scale.
        const widths = p.stage === "featured" ? FEATURED_WIDTHS : STAGE_WIDTHS;
        const uses = Object.entries(widths).map(([k, sw]) => {
          const shown = (p.w / 100) * sw - 2 * frameAt(sw);
          return `${p.stage === "featured" ? "featured " : ""}${k} ${(shown / rect.w).toFixed(2)}x (${(p.out / shown).toFixed(1)}x px)`;
        });
        console.log(`  ${p.id.padEnd(12)} ${String(info.width).padStart(4)}x${String(info.height).padEnd(4)}  shows at ${uses.join(", ")}`);
      }
      console.log(`    ${name.padEnd(24)} ${kb(info.size).padStart(9)}`);
    }
  }

  // Orphans: files in this tool's folder that its config no longer names.
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      if (!expected.has(f)) {
        fs.rmSync(path.join(outDir, f));
        console.log(`    removed orphan ${f}`);
      }
    }
    if (!fs.readdirSync(outDir).length) fs.rmdirSync(outDir);
  }
  for (const p of featured.filter((f) => f.reused)) {
    const shown = (p.w / 100) * FEATURED_WIDTHS.desktop - 2 * frameAt(FEATURED_WIDTHS.desktop);
    console.log(`  ${p.id.padEnd(12)} (portrait file)  shows at featured desktop ${(shown / p.src.rect.w).toFixed(2)}x (${(p.out / shown).toFixed(1)}x px)`);
  }
  if (prints.length) console.log(`  total  light ${kb(totals.light)}  dark ${kb(totals.dark)}`);
}

// Tone contrast: the description (ink at DESC_INK alpha over the ground) must
// reach 4.5:1 on both gradient stops of every tone, in both themes.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c) => {
  const [r, g, b] = c.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
let worst = Infinity;
for (const [family, tones] of Object.entries(TONES)) {
  tones.forEach((tone, i) => {
    for (const theme of THEMES) {
      const ink = rgb(tone[theme].ink);
      for (const stop of ["g1", "g2"]) {
        const bg = rgb(tone[theme][stop]);
        const desc = ink.map((v, k) => v * DESC_INK[theme] + bg[k] * (1 - DESC_INK[theme]));
        const c = ratio(desc, bg);
        worst = Math.min(worst, c);
        if (c < 4.5) warnings.push(`tones ${family}[${i}] ${theme}: description ink is ${c.toFixed(2)}:1 on ${stop}, under 4.5:1`);
      }
    }
  });
}

// Tone hue: each tone declares the OKLCH hue it was generated at (`hue`), which
// the neighbour rule below reads, or `hue: null` for a neutral (the disabled
// stone). Every stop of a hued ground with visible chroma (>= NEUTRAL_C) must
// measure within 3° of its hue, so the declared hue can't drift from the
// colors; every stop of a neutral must stay under NEUTRAL_C, so a tone can't
// dodge the neighbour rule by being called neutral.
const NEUTRAL_C = 0.02;
function oklch(hex) {
  const [r, g, b] = rgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
for (const [family, tones] of Object.entries(TONES)) {
  tones.forEach((tone, i) => {
    const neutral = tone.hue === null;
    if (!neutral && typeof tone.hue !== "number") {
      warnings.push(`tones ${family}[${i}]: \`hue\` must be a number, or null for a neutral`);
      return;
    }
    for (const theme of THEMES) {
      for (const stop of ["g1", "g2"]) {
        const { c, h } = oklch(tone[theme][stop]);
        if (neutral && c >= NEUTRAL_C) warnings.push(`tones ${family}[${i}] ${theme} ${stop}: declared neutral (hue null) but has chroma ${c.toFixed(3)}, at or over ${NEUTRAL_C}; give it a hue`);
        if (!neutral && c >= NEUTRAL_C && hueGap(h, tone.hue) > 3) warnings.push(`tones ${family}[${i}] ${theme} ${stop}: measures h${h.toFixed(0)}, not its declared hue ${tone.hue}`);
      }
    }
  });
}

// Palette neighbour rule. Every card flows through one grid in sections.js
// order (landing.css .tc-grid: 3 columns from a ~1050px viewport and never
// more, 2 from ~680px, 1 below; a section may start mid-row; a featured card
// spans two columns wherever there are two), so cards of different sections
// share rows. sections.js placeCards() places them the way CSS grid does. At
// each column count, cards side by side and cards above/below each other
// (columns overlapping; at 1 column, the next card) differ by >= 30° of hue. A
// neutral (hue null) differs from a hued card by chroma, so that pair passes;
// two neutrals touching would be indistinguishable, so that fails. A hole (an
// empty cell before the last row, left when a featured card wraps) fails too.
const MIN_HUE_STEP = 30;
const flow = SECTIONS.flatMap((section) => section.tools.map((t) => t.slug));
for (const slug of flow) if (!PREVIEWS[slug]) warnings.push(`${slug}: in landing/sections.js but has no preview config in previews/index.js`);
const hueOf = (slug) => PREVIEWS[slug]?.tone?.hue;
const closest = {};
for (const cols of [3, 2, 1]) {
  const at = `at ${cols} column${cols > 1 ? "s" : ""}`;
  const cards = placeCards(cols);
  closest[cols] = Infinity;
  const lastRow = Math.max(...cards.map((c) => c.row));
  for (let row = 0; row < lastRow; row++) {
    const used = cards.filter((c) => c.row === row).reduce((n, c) => n + c.span, 0);
    if (used < cols) {
      const next = cards.find((c) => c.row === row + 1);
      warnings.push(`layout ${at}: row ${row + 1} has ${cols - used} empty cell${cols - used > 1 ? "s" : ""} (${next?.slug} wraps); reorder landing/sections.js`);
    }
  }
  const overlaps = (a, b) => a.col < b.col + b.span && b.col < a.col + a.span;
  for (const a of cards) {
    for (const b of cards) {
      const beside = b.row === a.row && b.col === a.col + a.span;
      const below = b.row === a.row + 1 && overlaps(a, b);
      if (!beside && !below) continue;
      const where = beside ? "left of" : "above";
      const [ha, hb] = [hueOf(a.slug), hueOf(b.slug)];
      if (ha === null && hb === null) {
        warnings.push(`palette ${at}: ${a.slug} is ${where} ${b.slug}, and both are neutral; give one a hue`);
        continue;
      }
      if (typeof ha !== "number" || typeof hb !== "number") continue;
      const gap = hueGap(ha, hb);
      closest[cols] = Math.min(closest[cols], gap);
      if (gap < MIN_HUE_STEP) warnings.push(`palette ${at}: ${a.slug} (h${ha}) is ${where} ${b.slug} (h${hb}), ${gap}° apart; neighbours need >= ${MIN_HUE_STEP}°`);
    }
  }
}

// Budget across every tool's committed assets (baked now or earlier).
const sums = { light: 0, dark: 0 };
if (fs.existsSync(ASSET_DIR)) {
  for (const slug of fs.readdirSync(ASSET_DIR)) {
    const dir = path.join(ASSET_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const theme = f.endsWith("-dark.webp") ? "dark" : f.endsWith("-light.webp") ? "light" : null;
      if (theme) sums[theme] += fs.statSync(path.join(dir, f)).size;
    }
  }
}
console.log(`\nAll tools  light ${kb(sums.light)}  dark ${kb(sums.dark)}  (budget ${kb(THEME_BUDGET)} per theme)`);
console.log(`Tones      lowest description contrast ${worst.toFixed(2)}:1`);
console.log(`Palette    closest neighbours: ${[3, 2, 1].map((c) => `${closest[c]}° at ${c} col`).join(", ")} (need >= ${MIN_HUE_STEP}°)`);
console.log(`Run heads  ${[3, 2, 1].map((c) => `${c} col: ${[...runningHeads(c)].join(", ") || "none"}`).join("; ")}`);
for (const t of THEMES) if (sums[t] > THEME_BUDGET) warnings.push(`all tools: ${t} totals ${kb(sums[t])}, over the ${kb(THEME_BUDGET)} budget`);
if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
  process.exitCode = 1;
}
