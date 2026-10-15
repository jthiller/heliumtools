// The "tabletop" under a landing tool card: framed snapshots of the real tool,
// tilted and overlapping. Config + composition rules: ./previews/index.js;
// geometry (hover fan): ./previews/layout.js; styles: ./landing.css. Purely
// decorative (aria-hidden) — the card's link text comes from its <h3>.
import { fan, STAGE_RATIO } from "./previews/layout.js";

// Baked prints (scripts/tool-previews/bake.mjs). Eager URL imports: the files
// are fingerprinted by Vite, and only <img>/<source> fetch them, lazily.
const ASSETS = import.meta.glob("../../assets/previews/**/*.webp", { eager: true, import: "default" });
const assetUrl = (slug, id, theme) => ASSETS[`../../assets/previews/${slug}/${id}-${theme}.webp`];

// `eager`: the card is in the first row, so its prints skip lazy loading.
// `priority`: the page's first card; its top print is fetched at high priority.
export default function ToolPreview({ slug, prints = [], eager = false, priority = false }) {
  const ready = prints.filter((p) => p.src && assetUrl(slug, p.id, "light") && assetUrl(slug, p.id, "dark"));
  if (import.meta.env.DEV && ready.length !== prints.length) {
    const missing = prints.filter((p) => !ready.includes(p)).map((p) => p.id);
    console.warn(`[landing] ${slug}: no baked prints for ${missing.join(", ")}; run scripts/tool-previews/bake.mjs ${slug}`);
  }
  const topZ = Math.max(...ready.map((p) => p.z));
  return (
    <div className="tc-table" aria-hidden="true">
      <div className="tc-stage">
        {ready.map((p) => {
          const isTop = p.z === topZ;
          const { fx, fy, fr, fs } = fan(p, isTop, STAGE_RATIO);
          const { w, h } = p.src.rect;
          return (
            <figure
              key={p.id}
              className="tc-print"
              style={{
                "--x": `${p.x}%`,
                "--y": `${p.y}%`,
                "--w": `${p.w}%`,
                "--r": `${p.r}deg`,
                "--z": p.z,
                "--fx": `${fx}cqw`,
                "--fy": `${fy}cqw`,
                "--fr": `${fr}deg`,
                "--fs": fs,
              }}
            >
              <picture>
                <source media="(prefers-color-scheme: dark)" srcSet={assetUrl(slug, p.id, "dark")} />
                <img
                  src={assetUrl(slug, p.id, "light")}
                  width={p.out}
                  height={Math.round((p.out * h) / w)}
                  alt=""
                  loading={eager ? "eager" : "lazy"}
                  fetchpriority={priority && isTop ? "high" : undefined}
                  decoding="async"
                />
              </picture>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
