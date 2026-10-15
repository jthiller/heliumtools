// The "tabletop" under a landing tool card: framed snapshots of the real tool,
// tilted and overlapping. Config + composition rules: ./previews/index.js;
// geometry (hover fan): ./previews/layout.js; styles: ./landing.css. Purely
// decorative (aria-hidden) — the card's link text comes from its <h3>.
import { fan, STAGE_RATIO } from "./previews/layout.js";

// Baked prints (scripts/tool-previews/bake.mjs). Eager URL imports: the files
// are fingerprinted by Vite, and only <img>/<source> fetch them, lazily.
const ASSETS = import.meta.glob("../../assets/previews/**/*.webp", { eager: true, import: "default" });
const assetUrl = (slug, id, theme) => ASSETS[`../../assets/previews/${slug}/${id}-${theme}.webp`];

// A wide print without its own `src` reuses the portrait print with that id
// (same baked file, placed differently).
function resolve(prints, wide) {
  const byId = new Map(prints.map((p) => [p.id, p]));
  return wide.map((p) => (p.src ? p : { ...byId.get(p.id), ...p }));
}

function Stage({ slug, prints, layout, eagerIds }) {
  const ratio = STAGE_RATIO[layout];
  const ready = prints.filter((p) => p.src && assetUrl(slug, p.id, "light") && assetUrl(slug, p.id, "dark"));
  if (import.meta.env.DEV && ready.length !== prints.length) {
    const missing = prints.filter((p) => !ready.includes(p)).map((p) => p.id);
    console.warn(`[landing] ${slug} (${layout}): no baked prints for ${missing.join(", ")}; run scripts/tool-previews/bake.mjs ${slug}`);
  }
  const topZ = Math.max(...ready.map((p) => p.z));
  return (
    <div className={`tc-stage is-${layout}`}>
      {ready.map((p) => {
        const isTop = p.z === topZ;
        const { fx, fy, fr, fs } = fan(p, isTop, ratio);
        const { w, h } = p.src.rect;
        const eager = eagerIds.has(p.id);
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
                fetchpriority={eager && isTop ? "high" : undefined}
                decoding="async"
              />
            </picture>
          </figure>
        );
      })}
    </div>
  );
}

// `wide`: landscape prints for a single-tool section's full-row card (shown by
// landing.css once the row is wide enough; the portrait stage is shown below
// that). `eager`: the card is in the first viewport, so its prints skip lazy
// loading — but only the ones both layouts use, since an eager image loads even
// while its stage is hidden.
export default function ToolPreview({ slug, prints = [], wide, eager = false }) {
  const wides = wide ? resolve(prints, wide) : null;
  const eagerIds = new Set(
    eager ? prints.map((p) => p.id).filter((id) => !wides || wides.some((p) => p.id === id)) : [],
  );
  return (
    <div className="tc-table" aria-hidden="true">
      <Stage slug={slug} prints={prints} layout="portrait" eagerIds={eagerIds} />
      {wides && <Stage slug={slug} prints={wides} layout="wide" eagerIds={eagerIds} />}
    </div>
  );
}
