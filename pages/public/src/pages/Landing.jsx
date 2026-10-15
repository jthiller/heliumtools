import Header from "../components/Header.jsx";
import ToolPreview from "./landing/ToolPreview.jsx";
import { SECTIONS, strandedSlugs } from "./landing/sections.js";
import { PREVIEWS } from "./landing/previews/index.js";
import { TONES } from "./landing/previews/tones.js";
import "./landing/landing.css";

// The tool list itself lives in ./landing/sections.js (plain data, so the
// preview bake can check the palette against the same order). Layout and card
// docs: ./landing/CLAUDE.md.

// Tone tokens for both themes ride on the card as custom properties;
// landing.css picks the pair that matches prefers-color-scheme.
function toneStyle(tone) {
  const style = {};
  for (const [theme, prefix] of [["light", "--l-"], ["dark", "--d-"]]) {
    for (const [key, value] of Object.entries(tone[theme])) style[`${prefix}${key}`] = value;
  }
  return style;
}

// A tool without a preview config still gets a card (an empty stone ground)
// rather than taking the whole page down.
const NO_PREVIEW = { tone: TONES.network[2], prints: [] };
function previewFor(slug) {
  const preview = PREVIEWS[slug];
  if (!preview && import.meta.env.DEV) {
    console.warn(`[landing] no preview config for "${slug}"; add landing/previews/${slug}.js and register it in previews/index.js`);
  }
  return preview ?? NO_PREVIEW;
}

// The whole card is the link (no separate CTA); its accessible name is the
// <h3> (name + badge), the description is its description. The disabled
// Coming-soon card is a plain, unfocusable block. `eager`: in the first row,
// so its prints aren't lazy-loaded; `priority`: the page's first card, whose
// top print is fetched at high priority.
function ToolCard({ feature, eager, priority }) {
  const preview = previewFor(feature.slug);
  const nameId = `tool-${feature.slug}-name`;
  const descId = `tool-${feature.slug}-desc`;
  // The badge rides on the name's last word, so a wrapped name never strands it.
  const words = feature.name.split(" ");
  const last = words.pop();
  const body = (
    <>
      <div className="tc-text">
        <h3 id={nameId} className="tc-name font-display">
          {words.length > 0 && `${words.join(" ")} `}
          <span className="tc-nowrap">
            {last}
            {feature.badge && (
              <>
                {" "}
                <span className="tc-badge font-mono">{feature.badge}</span>
              </>
            )}
          </span>
        </h3>
        <p id={descId} className="tc-desc font-sans">
          {feature.description}
        </p>
      </div>
      <ToolPreview slug={feature.slug} prints={preview.prints} eager={eager} priority={priority} />
    </>
  );
  const common = { "data-tool": feature.slug, style: toneStyle(preview.tone) };
  if (feature.disabled) {
    return (
      <div {...common} className="tool-card is-disabled">
        {body}
      </div>
    );
  }
  return (
    <a {...common} href={feature.href} className="tool-card" aria-labelledby={nameId} aria-describedby={descId}>
      {body}
    </a>
  );
}

// Every card flows through one grid (.tc-grid in landing.css), so a section
// can start mid-row. A section is a named region with `display: contents`;
// each card sits in a two-row cell (heading slot over card) on the grid's
// shared row tracks, and the first card's cell carries the section heading in
// its slot. DOM order is reading order: a heading, then its section's cards.
//
// A card left in a row where the next section's heading starts (its own
// heading a row up) gets a running head in its slot: its section's title,
// muted and aria-hidden, shown only at the column count where it is stranded
// (landing.css switches tc-run-3 / tc-run-2 by the grid's width).
const STRANDED = { 3: strandedSlugs(3), 2: strandedSlugs(2) };
// Each card's place in the flow. The first row at the widest layout (3
// columns) loads its prints eagerly.
const FLOW_INDEX = new Map(SECTIONS.flatMap((section) => section.tools).map((tool, i) => [tool.slug, i]));
const EAGER_CARDS = 3;

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface">
      <Header />

      <main className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 sm:pb-11 lg:px-12">
        <div className="pb-2 pt-9 sm:pb-3 sm:pt-14">
          <p className="mb-4 font-mono text-[12.5px] font-medium uppercase leading-none tracking-[0.08em] text-content-secondary">
            Open-source operator tools
          </p>
          <h1 className="max-w-[16ch] font-display text-[length:clamp(30px,9.4vw,36px)] font-bold leading-[1.05] tracking-[-0.035em] text-content sm:text-[48px] lg:text-[52px]">
            Keep Helium running&nbsp;smoothly.
          </h1>
          <p className="mt-4 max-w-[56ch] text-base leading-[1.55] text-content-secondary sm:text-lg">
            Monitor escrow balances, claim rewards, map your Hotspot fleet, and
            migrate legacy wallets. Free, open-source, no login required.
          </p>
        </div>

        <div className="tc-grid">
          {SECTIONS.map((section) => {
            const headId = `section-${section.id}`;
            const descId = `section-${section.id}-desc`;
            return (
              <section key={section.id} className="tc-section" aria-labelledby={headId} aria-describedby={descId}>
                {section.tools.map((feature, i) => {
                  const index = FLOW_INDEX.get(feature.slug);
                  const runs = [3, 2].filter((cols) => STRANDED[cols].has(feature.slug));
                  return (
                    <div key={feature.slug} className="tc-cell">
                      {i === 0 && (
                        <div className="tc-head">
                          <h2 id={headId} className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-content">
                            {section.title}
                          </h2>
                          <p id={descId} className="mt-1 text-sm text-content-tertiary">
                            {section.description}
                          </p>
                        </div>
                      )}
                      {runs.length > 0 && (
                        <p
                          aria-hidden="true"
                          className={`tc-runhead ${runs.map((cols) => `tc-run-${cols}`).join(" ")} font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-content-tertiary`}
                        >
                          {section.title}
                        </p>
                      )}
                      <ToolCard feature={feature} eager={index < EAGER_CARDS} priority={index === 0} />
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </main>

      <footer className="border-t border-border px-4 py-8 sm:px-6">
        <p className="text-center text-sm text-content-tertiary">&copy; {new Date().getFullYear()} Helium Tools</p>
        <p className="mt-1.5 text-center text-xs text-content-tertiary">
          Agent-ready — every tool exposes <a href="https://webmachinelearning.github.io/webmcp/" target="_blank" rel="noopener noreferrer" className="underline hover:text-content-secondary">WebMCP</a> actions to AI agents in supporting browsers.
        </p>
      </footer>
    </div>
  );
}
