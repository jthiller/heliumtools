import { useEffect } from "react";
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import { useWebMcpTools } from "../webmcp/useWebMcpTools.js";
import { brandTools } from "./webmcpTools.js";
import {
  BEYOND_LOGO,
  BRAND_ASSET_ORIGIN,
  BRAND_ASSET_PATH,
  BRAND_PURPLE,
  CLEAR_SPACE,
  COLORWAYS,
  FAMILIES,
  LOGO_RULES,
  MIN_SIZE,
  OWNERSHIP,
  SUPPORTING_COLORS,
  TERMS,
  TYPE,
  ZIP,
  assetsFor,
  formatBytes,
} from "./brandAssets.js";

// Brand guidelines for the Helium marks. The logo files are static assets in
// pages/public/public/brand/ (served at /brand/<file>), so every preview on
// this page is the real hosted file and the copy-link buttons hand out the
// exact URL a visitor would embed elsewhere. brandAssets.js is the one place
// file names, dimensions, colorways, and rules are declared; the WebMCP tools
// read the same module, so the page and the agent view cannot drift apart.

// Fixed stage colors for logo previews. These are deliberately not theme
// tokens: a purple logo is previewed on white and a white logo on dark in
// both light and dark mode, because that is what each file is for.
const STAGE = {
  white: "#FFFFFF",
  paper: "#F4F3F0",
  purple: BRAND_PURPLE,
  dark: "#0F0F12",
  navy: "#241B5E",
};

// The roundel's symbol without its circle, for the "don't" example only. It
// is the compound path of helium-roundel-purple.svg with the outer-circle
// subpath removed, so the geometry is the real mark rather than a redraw.
// Never publish this shape as an asset: the whole point of the page is that
// it does not exist on its own.
const SYMBOL_WITHOUT_CIRCLE_PATH =
  "M265.985 109.285C278.222 97.0511 298.143 97.0511 310.379 109.285C322.614 121.519 322.614 141.436 310.379 153.67C303.291 160.757 293.591 163.964 283.743 162.547C283.295 162.472 282.773 162.472 282.325 162.547C279.415 162.174 276.357 162.547 273.447 163.89C269.343 165.754 266.433 169.186 265.015 173.14C263.598 177.019 263.673 181.42 265.538 185.373C276.058 208.126 271.209 235.354 253.451 253.108C235.694 270.862 208.461 275.711 185.705 265.192C181.601 263.328 177.199 263.253 173.245 264.745C169.365 266.162 166.082 269.072 164.217 273.1C163.023 275.711 162.576 278.396 162.725 281.081C162.65 281.604 162.65 282.126 162.725 282.648C164.367 292.644 161.084 302.864 153.921 310.025C141.685 322.259 121.764 322.259 109.528 310.025C103.559 304.057 100.351 296.225 100.351 287.795C100.351 279.441 103.634 271.533 109.528 265.566C116.616 258.479 126.315 255.271 136.164 256.688C136.313 256.688 136.462 256.688 136.686 256.688C137.73 256.912 138.775 257.061 139.894 257.061C142.207 257.061 144.52 256.613 146.684 255.569C150.712 253.705 153.548 250.422 155.04 246.618C156.532 242.664 156.532 238.188 154.593 234.085C144.073 211.334 148.922 184.105 166.68 166.351C184.436 148.597 211.669 143.749 234.425 154.266C238.455 156.132 242.931 156.206 246.811 154.789C250.691 153.371 254.048 150.463 255.914 146.434C257.33 143.301 257.704 139.944 257.182 136.737V136.662C255.54 126.665 258.823 116.446 265.985 109.285Z M234.948 234.608C248.527 221.031 248.527 199.025 234.948 185.448C221.369 171.871 199.359 171.871 185.779 185.448C172.201 199.025 172.201 221.031 185.779 234.608C199.359 248.185 221.369 248.185 234.948 234.608Z M322.093 165.382C340.671 146.807 340.671 116.744 322.093 98.1701C303.515 79.5953 273.447 79.5953 254.869 98.1701C248.005 105.032 243.677 113.537 241.887 122.414C208.237 109.732 169.589 117.789 143.849 143.525C118.108 169.26 110.05 207.902 122.808 241.62C113.855 243.41 105.35 247.737 98.4106 254.674C79.8327 273.249 79.8327 303.312 98.4106 321.887C116.989 340.461 147.057 340.461 165.635 321.887C172.573 314.949 176.975 306.295 178.692 297.344C189.137 301.223 200.03 303.162 210.848 303.162C234.948 303.162 258.748 293.838 276.431 276.158C302.022 250.572 310.155 212.154 297.695 178.51C306.573 176.646 315.154 172.319 322.093 165.382Z";

// The brand's type family, for the specimen only. heliumtools.org itself is not
// set in Figtree, so the page loads it on mount and drops it on unmount rather
// than adding a site-wide font request to index.html.
const FIGTREE_CSS = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;900&display=swap";
const FIGTREE_STACK = "Figtree, 'Helvetica Neue', Arial, system-ui, sans-serif";

function useStylesheet(href) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    return () => link.remove();
  }, [href]);
}

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-content transition hover:bg-surface-inset";

// ─── Shared pieces ────────────────────────────────────────────────────────────

function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="mb-4">
      {eyebrow && (
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-content">
        {title}
      </h2>
      {children && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-content-secondary">{children}</p>}
    </div>
  );
}

function Card({ className = "", children }) {
  return <section className={`rounded-2xl bg-surface-raised shadow-soft ${className}`}>{children}</section>;
}

function Pill({ children, tone = "default" }) {
  const tones = {
    default: "border-border text-content-secondary",
    accent: "border-accent/30 bg-accent-surface text-accent-text",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Recessed code panel. Recessed surfaces keep their border; raised cards do not. */
function CodeBlock({ code }) {
  return (
    <div className="relative rounded-lg border border-border bg-surface-inset">
      <div className="absolute right-2.5 top-2.5">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 pr-12 font-mono text-[12px] leading-relaxed text-content-secondary">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A fixed-color stage for previewing a logo file. Recessed, so it keeps a hairline. */
function Stage({ color, className = "", children }) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-xl border border-border ${className}`}
      style={{ backgroundColor: STAGE[color] }}
    >
      {children}
    </div>
  );
}

function Logo({ asset, alt, className }) {
  return <img src={asset.path} alt={alt} className={className} draggable="false" />;
}

/** Download button + copy-link for one hosted file. */
function FileButton({ asset }) {
  const dims = `${asset.width}×${asset.height}${asset.format === "png" ? " px" : ""}`;
  return (
    <div className="flex items-center gap-1.5">
      <a href={asset.path} download={asset.filename} className={BUTTON_CLASS}>
        <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {asset.format.toUpperCase()}
        <span className="font-normal text-content-tertiary">
          {dims} · {formatBytes(asset.bytes)}
        </span>
      </a>
      <CopyButton text={asset.url} label={`Copy link to ${asset.filename}`} />
    </div>
  );
}

// ─── The mark ─────────────────────────────────────────────────────────────────

// The symbol's two outer circles are centered near (288,131) and (133,290) in
// the roundel's 421-unit viewBox, point-symmetric about the center, which puts
// their axis at ~45°. The dashed line runs along that axis to the circle's edge.
function MarkFigure({ roundel }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px]">
      <Logo asset={roundel} alt="The Helium roundel, purple" className="h-full w-full" />
      <svg viewBox="0 0 421 421" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <line
          x1="62.9"
          y1="359.8"
          x2="357.3"
          y2="60.4"
          stroke="#FFFFFF"
          strokeOpacity="0.85"
          strokeWidth="2"
          strokeDasharray="7 7"
        />
        <text
          x="330"
          y="118"
          fill="#FFFFFF"
          fillOpacity="0.9"
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontSize="18"
          fontWeight="500"
        >
          45°
        </text>
      </svg>
    </div>
  );
}

function SymbolWithoutCircle({ className }) {
  return (
    <svg viewBox="0 0 421 421" className={className} aria-hidden="true">
      <path fillRule="evenodd" d={SYMBOL_WITHOUT_CIRCLE_PATH} fill={BRAND_PURPLE} />
    </svg>
  );
}

// ─── Do and don't ─────────────────────────────────────────────────────────────

function Example({ ok, title, body, stage, children }) {
  return (
    <figure className="flex flex-col gap-3">
      <Stage color={stage} className="relative h-36">
        {children}
        <span
          className={`absolute left-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${
            ok ? "bg-emerald-500" : "bg-rose-500"
          }`}
          aria-hidden="true"
        >
          {ok ? <CheckIcon className="h-3 w-3" strokeWidth={3} /> : <XMarkIcon className="h-3 w-3" strokeWidth={3} />}
        </span>
      </Stage>
      <figcaption>
        <div className="text-sm font-semibold text-content">
          <span className="sr-only">{ok ? "Do: " : "Don't: "}</span>
          {title}
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-content-secondary">{body}</p>
      </figcaption>
    </figure>
  );
}

// ─── Clear space ──────────────────────────────────────────────────────────────

function ClearSpaceFigure({ roundel }) {
  // The roundel is 80px, so half its diameter is 40px of padding on each side.
  return (
    <div className="flex justify-center py-2">
      <div className="relative rounded-[32px] border-2 border-dashed border-content-tertiary/60 p-10">
        <Logo asset={roundel} alt="" className="h-20 w-20" />
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-surface-raised px-1.5 font-mono text-[10px] text-content-tertiary">
          ½ D
        </span>
        <span className="absolute -left-4 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap bg-surface-raised px-1.5 font-mono text-[10px] text-content-tertiary">
          ½ D
        </span>
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-surface-raised px-1.5 font-mono text-[10px] text-content-tertiary">
          D = diameter
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const stageFor = { purple: "white", black: "white", white: "dark" };

const EMBED_HTML = `<img src="${BRAND_ASSET_ORIGIN}${BRAND_ASSET_PATH}/helium-logo-purple.svg" alt="Helium" height="32">`;
const EMBED_MD = `![Helium](${BRAND_ASSET_ORIGIN}${BRAND_ASSET_PATH}/helium-roundel-purple.svg)`;

export default function BrandGuidelines() {
  useWebMcpTools(() => brandTools, []);
  useStylesheet(FIGTREE_CSS);

  const roundel = assetsFor("roundel", "purple").svg;
  const heliumPurple = assetsFor("helium", "purple").svg;
  const heliumWhite = assetsFor("helium", "white").svg;
  const heliumBlack = assetsFor("helium", "black").svg;

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Brand Guidelines" />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="mb-2 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-accent-text">
            Brand guidelines · Direct-link assets
          </p>
          <h1 className="mb-3 font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-content sm:text-[44px]">
            The Helium marks
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-content-secondary">
            The official Helium logos, hosted here so you can link to them directly from docs,
            decks, sites, and app listings. Every file has a stable URL: drop it in an image tag
            or download the SVG. The rules are short and mostly about one thing. The symbol lives
            inside its circle, and the circle is never optional.
          </p>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-content-tertiary">
            heliumtools.org is a third-party site. The marks belong to Nova Labs and the Helium
            Foundation, and their <a href="#terms">terms</a> govern how the files may be used.
          </p>
        </div>

        <div className="space-y-12">
          {/* Hero stage */}
          <section>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="flex min-h-[200px] items-center justify-center p-10">
                <Logo asset={heliumPurple} alt="Helium logo, purple on white" className="h-14 w-auto sm:h-16" />
              </Card>
              <Card className="flex min-h-[200px] items-center justify-center p-10">
                <div
                  className="flex h-full w-full items-center justify-center rounded-xl px-8 py-10"
                  style={{ backgroundColor: STAGE.purple }}
                >
                  <Logo asset={heliumWhite} alt="Helium logo, white on Helium Purple" className="h-14 w-auto sm:h-16" />
                </div>
              </Card>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href={ZIP.path} download={ZIP.filename} className={BUTTON_CLASS}>
                <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Download all
                <span className="font-normal text-content-tertiary">ZIP · {formatBytes(ZIP.bytes)}</span>
              </a>
              <span className="text-xs text-content-tertiary">
                24 files: four marks, three colorways, SVG and PNG. Same names as the hosted URLs.
              </span>
            </div>
          </section>

          {/* The mark */}
          <section>
            <SectionTitle eyebrow="Logo" title="The mark">
              One shape. The Helium symbol is cut out of a solid circle, and every file ships the
              two together.
            </SectionTitle>
            <Card className="grid gap-8 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-center">
              <MarkFigure roundel={roundel} />
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-semibold text-content">What the files contain</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-content-secondary">
                    A solid circle with the symbol cut out of it, as one compound shape. There is no
                    separate symbol file, and there should not be one. In the white files the
                    background shows through the cut-out.
                  </p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-content">Orientation</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-content-secondary">
                    The symbol's two outer circles sit on a 45° axis rising from lower-left to
                    upper-right, the dashed line in the figure. That is the only orientation the mark
                    has.
                  </p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-content">Terms used on this page</div>
                  <dl className="mt-1.5 space-y-1.5">
                    {TERMS.map((t) => (
                      <div key={t.term} className="text-[14px] leading-relaxed">
                        <dt className="inline font-medium text-content">{t.term}. </dt>
                        <dd className="inline text-content-secondary">{t.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </Card>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {LOGO_RULES.principles.map((rule) => (
                <Card key={rule.id} className="p-6">
                  <h3 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-content">{rule.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-content-secondary">{rule.body}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* Logo family */}
          <section>
            <SectionTitle eyebrow="Assets" title="Logo family">
              Four marks, each in three colorways. SVG is the master and scales to any size; the PNG
              is there for places that cannot take vector art. Download a file, or copy its link
              and use it in place.
            </SectionTitle>
            <div className="space-y-5">
              {FAMILIES.map((family) => (
                <Card key={family.id} className="p-6">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 max-w-xl">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-content">
                          {family.name}
                        </h3>
                        <Pill>{family.kind}</Pill>
                      </div>
                      <p className="mt-1.5 text-[14px] leading-relaxed text-content-secondary">{family.description}</p>
                    </div>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-3">
                    {COLORWAYS.map((colorway) => {
                      const { svg, png } = assetsFor(family.id, colorway.id);
                      const isSymbol = family.id === "roundel";
                      return (
                        <div key={colorway.id} className="flex flex-col gap-3">
                          <Stage color={stageFor[colorway.id]} className="h-32 px-8">
                            <Logo
                              asset={svg}
                              alt={`${family.name} logo, ${colorway.label.toLowerCase()}`}
                              className={isSymbol ? "h-20 w-20" : "max-h-14 w-full object-contain"}
                            />
                          </Stage>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full border border-border"
                              style={{ backgroundColor: colorway.hex }}
                              aria-hidden="true"
                            />
                            <span className="text-sm font-medium text-content">{colorway.label}</span>
                            <span className="font-mono text-[11px] text-content-tertiary">{colorway.hex}</span>
                          </div>
                          <div className="flex flex-col gap-2">
                            <FileButton asset={svg} />
                            <FileButton asset={png} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* Do and don't */}
          <section>
            <SectionTitle eyebrow="Usage" title="Do and don't">
              The files are finished artwork. Place them, scale them proportionally, and pick the
              colorway that suits the background. Everything else is off the table.
            </SectionTitle>
            <Card className="p-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <Example
                  ok
                  stage="white"
                  title="Use the files as they ship"
                  body="Purple on white or a light neutral is the default. Place the file; never redraw or retouch it."
                >
                  <Logo asset={heliumPurple} alt="" className="h-10 w-auto" />
                </Example>
                <Example
                  ok
                  stage="purple"
                  title="White on purple and dark"
                  body="On Helium Purple, dark, and photographic backgrounds use the white files. The symbol shows through as the background."
                >
                  <Logo asset={heliumWhite} alt="" className="h-10 w-auto" />
                </Example>
                <Example
                  ok
                  stage="paper"
                  title="Black for one-color"
                  body="Where color is unavailable, such as single-ink print, use black on a light background."
                >
                  <Logo asset={heliumBlack} alt="" className="h-10 w-auto" />
                </Example>

                <Example ok={false} stage="white" title={LOGO_RULES.dont[0].title} body={LOGO_RULES.dont[0].body}>
                  <SymbolWithoutCircle className="h-24 w-24" />
                </Example>
                <Example ok={false} stage="white" title={LOGO_RULES.dont[1].title} body={LOGO_RULES.dont[1].body}>
                  <div className="h-20 w-20" style={{ transform: "rotate(45deg)" }} aria-hidden="true">
                    <Logo asset={roundel} alt="" className="h-20 w-20" />
                  </div>
                </Example>
                <Example ok={false} stage="white" title={LOGO_RULES.dont[2].title} body={LOGO_RULES.dont[2].body}>
                  <div className="h-20 w-20" style={{ transform: "scaleX(1.45)" }} aria-hidden="true">
                    <Logo asset={roundel} alt="" className="h-20 w-20" />
                  </div>
                </Example>
                <Example ok={false} stage="white" title={LOGO_RULES.dont[3].title} body={LOGO_RULES.dont[3].body}>
                  <div
                    className="h-20 w-20"
                    aria-hidden="true"
                    style={{
                      WebkitMaskImage: `url(${roundel.path})`,
                      maskImage: `url(${roundel.path})`,
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      backgroundImage: `linear-gradient(135deg, #FF8A3D 0%, #E0248F 55%, ${BRAND_PURPLE} 100%)`,
                    }}
                  />
                </Example>
                <Example ok={false} stage="white" title={LOGO_RULES.dont[4].title} body={LOGO_RULES.dont[4].body}>
                  <div
                    className="h-20 w-20 rounded-full"
                    style={{
                      boxShadow: "0 0 0 3px #FFFFFF, 0 0 0 6px #5E25FD",
                      filter: "drop-shadow(0 10px 10px rgba(0, 0, 0, 0.45))",
                    }}
                    aria-hidden="true"
                  >
                    <Logo asset={roundel} alt="" className="h-20 w-20" />
                  </div>
                </Example>
                <Example ok={false} stage="navy" title={LOGO_RULES.dont[5].title} body={LOGO_RULES.dont[5].body}>
                  <Logo asset={roundel} alt="" className="h-20 w-20" />
                </Example>
              </div>
            </Card>
          </section>

          {/* Clear space and size */}
          <section>
            <SectionTitle eyebrow="Usage" title="Clear space and minimum size">
              Both scale with the mark, so one rule covers a favicon and a billboard.
            </SectionTitle>
            <Card className="grid gap-8 p-6 sm:p-8 md:grid-cols-2 md:items-center">
              <ClearSpaceFigure roundel={roundel} />
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-semibold text-content">Clear space</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-content-secondary">{CLEAR_SPACE}</p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-content">Minimum size</div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">
                    <div className="border-l border-border pl-3">
                      <dt className="text-content-tertiary">Roundel</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-content">
                        {MIN_SIZE.roundel.px} px <span className="font-normal text-content-tertiary">screen</span> ·{" "}
                        {MIN_SIZE.roundel.mm} mm <span className="font-normal text-content-tertiary">print</span>
                      </dd>
                    </div>
                    <div className="border-l border-border pl-3">
                      <dt className="text-content-tertiary">Lockups</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-content">
                        {MIN_SIZE.lockup.px} px <span className="font-normal text-content-tertiary">wide</span> ·{" "}
                        {MIN_SIZE.lockup.mm} mm <span className="font-normal text-content-tertiary">print</span>
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[13px] leading-relaxed text-content-tertiary">{MIN_SIZE.note}</p>
                </div>
              </div>
            </Card>
          </section>

          {/* Color */}
          <section>
            <SectionTitle eyebrow="Color" title="Colorways">
              The logo files use one brand color, and the wider palette is deliberately restrained:
              the purple does the work against black, white, and grey. Pick a logo colorway by
              background, not by taste.
            </SectionTitle>
            <Card className="divide-y divide-border-muted">
              {COLORWAYS.map((colorway) => (
                <div key={colorway.id} className="flex items-start gap-4 px-6 py-4">
                  <span
                    className="mt-0.5 h-9 w-9 shrink-0 rounded-lg border border-border"
                    style={{ backgroundColor: colorway.hex }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-semibold text-content">
                        {colorway.id === "purple" ? "Helium Purple" : colorway.label}
                      </span>
                      <span className="font-mono text-[12px] text-content-secondary">{colorway.hex}</span>
                      <CopyButton text={colorway.hex} label={`Copy ${colorway.hex}`} />
                    </div>
                    <p className="mt-1 text-[14px] leading-relaxed text-content-secondary">{colorway.use}</p>
                    {colorway.note && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-content-tertiary">{colorway.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </Card>
            <Card className="mt-4 p-6">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">
                Supporting palette
              </p>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-7">
                {SUPPORTING_COLORS.map((c) => (
                  <div key={c.id}>
                    <span
                      className="block h-9 w-full rounded-lg border border-border"
                      style={{ backgroundColor: c.hex }}
                      aria-hidden="true"
                    />
                    <div className="mt-2 text-[13px] font-medium text-content">{c.label}</div>
                    <div className="font-mono text-[11px] text-content-tertiary">{c.hex}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-content-secondary">{c.use}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          {/* Type */}
          <section>
            <SectionTitle eyebrow="Type" title="Typography">
              One family does nearly all the work. This site is not set in it; the specimen below
              is.
            </SectionTitle>
            <Card className="p-6 sm:p-8">
              <p
                className="text-[34px] text-content sm:text-[48px]"
                style={{
                  fontFamily: FIGTREE_STACK,
                  fontWeight: 900,
                  lineHeight: 0.95,
                  letterSpacing: "-0.025em",
                  textTransform: "uppercase",
                }}
              >
                {TYPE.specimen.lead} <span style={{ color: BRAND_PURPLE }}>{TYPE.specimen.accent}</span>
              </p>
              <p
                className="mt-5 max-w-xl text-[18px] text-content-secondary"
                style={{ fontFamily: FIGTREE_STACK, fontWeight: 400, lineHeight: 1.2 }}
              >
                {TYPE.specimen.body}
              </p>
              <dl className="mt-7 grid gap-x-8 gap-y-3 border-t border-border-muted pt-5 text-[14px] sm:grid-cols-2">
                {[
                  ["Family", `${TYPE.family}. ${TYPE.weights}.`],
                  ["Display", TYPE.display],
                  ["Headings", TYPE.headings],
                  ["Body", TYPE.body],
                  ["Posters", TYPE.poster],
                ].map(([term, detail]) => (
                  <div key={term}>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">{term}</dt>
                    <dd className="mt-1 leading-relaxed text-content-secondary">{detail}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>

          {/* Beyond the logo */}
          <section>
            <SectionTitle eyebrow="Reference" title="Beyond the logo">
              The rest of the visual system lives in the Helium Design System. These are the four
              things to know before building anything branded.
            </SectionTitle>
            <Card className="grid gap-6 p-6 sm:grid-cols-2">
              {BEYOND_LOGO.map((item) => (
                <div key={item.title}>
                  <div className="text-sm font-semibold text-content">{item.title}</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-content-secondary">{item.body}</p>
                </div>
              ))}
            </Card>
          </section>

          {/* Direct links */}
          <section>
            <SectionTitle eyebrow="Integrate" title="Direct links">
              Every file lives at a predictable URL. Link to it from anywhere; there is no key, no
              login, and the files are served from Cloudflare's edge with CORS open.
            </SectionTitle>
            <Card className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="break-all font-mono text-sm text-content">
                  {BRAND_ASSET_ORIGIN}
                  {BRAND_ASSET_PATH}/
                  <span className="text-content-tertiary">{"{mark}-{color}.{format}"}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill tone="accent">Stable URLs</Pill>
                <Pill tone="accent">CORS open</Pill>
                <Pill tone="accent">No key</Pill>
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">mark</dt>
                  <dd className="mt-1 space-y-0.5 font-mono text-[12px] text-content">
                    {FAMILIES.map((f) => (
                      <div key={f.id}>{f.file}</div>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">color</dt>
                  <dd className="mt-1 space-y-0.5 font-mono text-[12px] text-content">
                    {COLORWAYS.map((c) => (
                      <div key={c.id}>{c.id}</div>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">format</dt>
                  <dd className="mt-1 space-y-0.5 font-mono text-[12px] text-content">
                    <div>svg</div>
                    <div>png</div>
                  </dd>
                </div>
              </dl>
              <CodeBlock code={EMBED_HTML} />
              <CodeBlock code={EMBED_MD} />
              <p className="text-[13px] leading-relaxed text-content-tertiary">
                Prefer the SVG wherever it is supported: it is smaller than the PNG and stays sharp at
                any size. The URLs are stable, so hot-linking is fine; if you need a copy under your
                own control, download the ZIP above.
              </p>
            </Card>
          </section>

          {/* Ownership and terms */}
          <section id="terms">
            <SectionTitle title="Ownership and terms" />
            <Card className="space-y-4 p-6">
              <p className="text-[15px] leading-relaxed text-content-secondary">{OWNERSHIP.summary}</p>
              <ul className="space-y-2">
                {OWNERSHIP.owners.map((owner) => (
                  <li key={owner.name} className="flex flex-wrap items-baseline gap-x-2.5 text-sm">
                    <span className="font-medium text-content">{owner.name}</span>
                    <a
                      href={owner.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-accent-text hover:opacity-80"
                    >
                      {owner.label}
                      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] leading-relaxed text-content-tertiary">
                This page is maintained by the Helium Tools project and is not a Nova Labs or Helium
                Foundation publication. Missing a format or a mark?{" "}
                <a
                  href="https://github.com/jthiller/heliumtools/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open an issue
                </a>
                .
              </p>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
