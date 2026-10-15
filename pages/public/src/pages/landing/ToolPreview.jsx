// The "tabletop" under a landing tool card: framed snapshots of the real tool,
// tilted and overlapping. Config + composition rules: ./previews/index.js;
// geometry (hover fan): ./previews/layout.js; styles: ./landing.css. Purely
// decorative (aria-hidden) — the card's link text comes from its <h3>.
import { fan, depthOf, STAGE_RATIO, FEATURED_RATIO } from "./previews/layout.js";

// Baked prints (scripts/tool-previews/bake.mjs). Eager URL imports: the files
// are fingerprinted by Vite, and only <img>/<source> fetch them, lazily.
const ASSETS = import.meta.glob("../../assets/previews/**/*.webp", { eager: true, import: "default" });
const assetUrl = (slug, id, theme) => ASSETS[`../../assets/previews/${slug}/${id}-${theme}.webp`];

// A featured print without its own `src` reuses the portrait print with that
// id (the same baked file), placed anew.
export function resolveFeatured(prints, featured) {
  const byId = new Map(prints.map((p) => [p.id, p]));
  return featured.map((p) => (p.src ? p : { ...byId.get(p.id), ...p }));
}

function Stage({ slug, prints, variant, eagerIds, priority }) {
  const ready = prints.filter((p) => p.src && assetUrl(slug, p.id, "light") && assetUrl(slug, p.id, "dark"));
  if (import.meta.env.DEV && ready.length !== prints.length) {
    const missing = prints.filter((p) => !ready.includes(p)).map((p) => p.id);
    console.warn(`[landing] ${slug}: no baked prints for ${missing.join(", ")}; run scripts/tool-previews/bake.mjs ${slug}`);
  }
  const ratio = variant === "featured" ? FEATURED_RATIO : STAGE_RATIO;
  const topZ = Math.max(...ready.map((p) => p.z));
  return (
    <div className={`tc-table is-${variant}`} aria-hidden="true">
      <div className="tc-stage">
        {ready.map((p) => {
          const isTop = p.z === topZ;
          const eager = eagerIds.has(p.id);
          const depth = depthOf(p, ready);
          const { fx, fy, fr, fs } = fan(p, isTop, ratio, depth);
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
                "--d": depth,
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
                  fetchpriority={priority && eager && isTop ? "high" : undefined}
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

// `featured`: the wide print set of a featured card (landing.css shows it while
// the card spans two grid columns, the portrait stage otherwise). `eager`: the
// card is in the first row, so its prints skip lazy loading — but only the ones
// both stages use, since an eager image loads even while its stage is hidden.
// `priority`: the page's first card; its top print is fetched at high priority.
export default function ToolPreview({ slug, prints = [], featured, eager = false, priority = false }) {
  const wide = featured ? resolveFeatured(prints, featured) : null;
  const eagerIds = new Set(eager ? prints.map((p) => p.id).filter((id) => !wide || wide.some((p) => p.id === id)) : []);
  return (
    <>
      <Stage slug={slug} prints={prints} variant="portrait" eagerIds={eagerIds} priority={priority} />
      {wide && <Stage slug={slug} prints={wide} variant="featured" eagerIds={eagerIds} priority={priority} />}
    </>
  );
}
