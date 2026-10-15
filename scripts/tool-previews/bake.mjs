// Bake landing tool-card prints: crop each real capture, resize, encode WebP.
//
//   node bake.mjs [slug...|all]  (default, or all: every tool with a preview config)
//
// Reads pages/public/src/pages/landing/previews/<slug>.js (default export), and
// for every print (portrait `prints` and, for a wide card, `wide` prints with
// their own `src`) and theme crops captures/<slug>/<theme>/<file> by the print's
// rect (CSS px of the capture, scaled by the capture's dpr), resizes it to the
// print's `out` width and writes
// pages/public/src/assets/previews/<slug>/<id>-<theme>.webp.
//
// Re-baking needs the local source captures (captures/ is git-ignored; see the
// README's Capture section). A print whose capture is missing is reported and
// its committed file is left alone. Files in a tool's folder that no print in
// its config names are deleted.
//
// Also checks, and exits 1 on: the byte budgets, a print's top edge (at rest and
// on hover) reaching into the card text, a rect running past its capture, an
// `out` wider than its crop, a capture missing from its manifest (unknown dpr),
// and tone contrast (description ink >= 4.5:1 on both ground stops).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const CONFIG_DIR = path.join(REPO, "pages/public/src/pages/landing/previews");
const ASSET_DIR = path.join(REPO, "pages/public/src/assets/previews");
const CAPTURES = path.join(HERE, "captures");
const THEMES = ["light", "dark"];
const QUALITY = 78;
const PRINT_BUDGET = 60 * 1024; // any single print
const THEME_BUDGET = 500 * 1024; // all tools, one theme (a visitor downloads one)
// Stage widths the composition is reported at: a desktop 3-column card, a 390px
// phone card, and the wide card's landscape stage at desktop.
const STAGE_WIDTHS = { portrait: { desktop: 381, phone: 358 }, wide: { desktop: 844 } };
const frameAt = (stageW) => Math.min(7, Math.max(4, stageW * 0.017));

const { fan, topEdge, STAGE_RATIO, TOP_MARGIN } = await import(pathToFileURL(path.join(CONFIG_DIR, "layout.js")).href);
const { TONES, DESC_INK } = await import(pathToFileURL(path.join(CONFIG_DIR, "tones.js")).href);

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

// Every layout's prints, resolved: a wide print without `src` reuses the
// portrait print of the same id (and its baked file).
function layouts(cfg) {
  const out = { portrait: cfg.prints };
  if (cfg.wide) {
    const byId = new Map(cfg.prints.map((p) => [p.id, p]));
    out.wide = cfg.wide.map((p) => (p.src ? p : { ...byId.get(p.id), ...p }));
  }
  return out;
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
  const all = layouts(cfg);
  // The files this config owns: one per print with its own src, per theme.
  const toBake = [...cfg.prints, ...(cfg.wide ?? []).filter((p) => p.src)];
  const expected = new Set(toBake.flatMap((p) => THEMES.map((t) => `${p.id}-${t}.webp`)));
  console.log(`\n${slug}${toBake.length ? "" : "  (no prints)"}`);

  // Lint: every print's on-card top edge stays TOP_MARGIN below the text, at
  // rest and in its hover pose (tilt and scale included).
  for (const [layout, prints] of Object.entries(all)) {
    const ratio = STAGE_RATIO[layout];
    const topZ = Math.max(...prints.map((p) => p.z));
    for (const p of prints) {
      if (!p?.src) {
        warnings.push(`${slug}/${layout}: a wide print names id "${p?.id}", which no portrait print has; give it a src`);
        continue;
      }
      const rest = topEdge(p, ratio);
      const hover = topEdge(p, ratio, fan(p, p.z === topZ, ratio));
      for (const [state, top] of [["rest", rest], ["hover", hover]]) {
        if (top < TOP_MARGIN - 0.05) warnings.push(`${slug}/${layout}/${p.id}: ${state} top edge at ${top.toFixed(1)}% of the stage, above the ${TOP_MARGIN}% keep-out; lower y, shrink w or ease the tilt`);
      }
    }
  }

  for (const p of toBake) {
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
        const uses = Object.entries(all).flatMap(([layout, prints]) => {
          const q = prints.find((x) => x.id === p.id);
          if (!q) return [];
          return Object.entries(STAGE_WIDTHS[layout]).map(([k, sw]) => {
            const shown = (q.w / 100) * sw - 2 * frameAt(sw);
            return `${layout === "wide" ? "wide " : ""}${k} ${(shown / rect.w).toFixed(2)}x (${(p.out / shown).toFixed(1)}x px)`;
          });
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
  if (toBake.length) console.log(`  total  light ${kb(totals.light)}  dark ${kb(totals.dark)}`);
}

// Tone contrast: the description (ink at DESC_INK alpha over the ground) must
// reach 4.5:1 on both gradient stops of every tone, in both themes.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (c) => {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
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
for (const t of THEMES) if (sums[t] > THEME_BUDGET) warnings.push(`all tools: ${t} totals ${kb(sums[t])}, over the ${kb(THEME_BUDGET)} budget`);
if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
  process.exitCode = 1;
}
