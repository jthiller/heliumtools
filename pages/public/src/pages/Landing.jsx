import { useCallback, useEffect, useRef } from "react";
import Header from "../components/Header.jsx";
import ToolPreview from "./landing/ToolPreview.jsx";
import { SECTIONS, placeCards, headingSlots } from "./landing/sections.js";
import { PREVIEWS } from "./landing/previews/index.js";
import { TONES, SECTION_RULES } from "./landing/previews/tones.js";
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

// Mouse parallax: while a mouse moves over a card, its prints drift away from
// the pointer, the top print the most (landing.css .tc-drift `translate`;
// amounts and depths in ./landing/previews/layout.js). The pointer's offset from
// the card centre (-1..1 per axis, flipped) is the target; one animation-frame
// loop per card eases --px / --py toward it (exponential, DRIFT_MS time
// constant) and stops once settled, back at 0 after the mouse leaves. Easing
// here, not with a CSS transition, keeps the motion smooth: a transition
// restarted on every mouse move stutters, most of all while the hover fan
// (a `transform` transition on the print inside) is still running. Only for a
// mouse, never under reduced motion.
const REDUCED_MOTION =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };
const DRIFT_MS = 140;
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
function useParallax() {
  const drift = useRef({ card: null, x: 0, y: 0, tx: 0, ty: 0, frame: 0, last: 0 });
  useEffect(() => () => cancelAnimationFrame(drift.current.frame), []);
  const step = useCallback((now) => {
    const d = drift.current;
    const dt = d.last ? Math.min(64, now - d.last) : 16;
    d.last = now;
    const k = 1 - Math.exp(-dt / DRIFT_MS);
    d.x += (d.tx - d.x) * k;
    d.y += (d.ty - d.y) * k;
    const settled = Math.abs(d.tx - d.x) < 0.002 && Math.abs(d.ty - d.y) < 0.002;
    if (settled) {
      d.x = d.tx;
      d.y = d.ty;
    }
    const { style, classList } = d.card;
    if (settled && d.x === 0 && d.y === 0) {
      style.removeProperty("--px");
      style.removeProperty("--py");
    } else {
      style.setProperty("--px", d.x.toFixed(4));
      style.setProperty("--py", d.y.toFixed(4));
    }
    if (settled) {
      classList.remove("is-drifting");
      d.frame = 0;
      d.last = 0;
      return;
    }
    d.frame = requestAnimationFrame(step);
  }, []);
  const steer = useCallback((card, tx, ty) => {
    const d = drift.current;
    d.card = card;
    d.tx = tx;
    d.ty = ty;
    if (!d.frame) {
      card.classList.add("is-drifting");
      d.frame = requestAnimationFrame(step);
    }
  }, [step]);
  const onPointerMove = useCallback((event) => {
    if (event.pointerType !== "mouse" || REDUCED_MOTION.matches) return;
    const card = event.currentTarget;
    const box = card.getBoundingClientRect();
    steer(
      card,
      -clampUnit(((event.clientX - box.left) / box.width) * 2 - 1),
      -clampUnit(((event.clientY - box.top) / box.height) * 2 - 1),
    );
  }, [steer]);
  const onPointerLeave = useCallback((event) => {
    if (drift.current.card) steer(event.currentTarget, 0, 0);
  }, [steer]);
  return { onPointerMove, onPointerLeave };
}

// The whole card is the link (no separate CTA); its accessible name is the
// <h3> (name + badge), the description is its description. The disabled
// Coming-soon card is a plain, unfocusable block. A featured card also carries
// its wide print set (shown while it spans two columns). `eager`: in the first
// row, so its prints aren't lazy-loaded; `priority`: the page's first card,
// whose top print is fetched at high priority.
function ToolCard({ feature, eager, priority }) {
  const preview = previewFor(feature.slug);
  const parallax = useParallax();
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
      <ToolPreview
        slug={feature.slug}
        prints={preview.prints}
        featured={feature.featured ? preview.featured : undefined}
        eager={eager}
        priority={priority}
      />
    </>
  );
  const common = { "data-tool": feature.slug, style: toneStyle(preview.tone) };
  const featured = feature.featured ? " is-featured" : "";
  if (feature.disabled) {
    return (
      <div {...common} className={`tool-card is-disabled${featured}`}>
        {body}
      </div>
    );
  }
  return (
    <a
      {...common}
      {...parallax}
      href={feature.href}
      className={`tool-card${featured}`}
      aria-labelledby={nameId}
      aria-describedby={descId}
    >
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
// A featured card's cell spans two columns wherever the grid has two or more
// (landing.css). In a row where any section starts, every card's slot draws its
// section's colored rule (joined across the gap to a neighbour of the same
// section), and the first card of a section that started in an earlier row also
// gets a running head: its section's title, muted and aria-hidden
// (sections.js headingSlots). Rows differ by column count, so each slot carries
// tc-line-N / tc-join-N / tc-run-N classes and landing.css picks the set for
// the grid's current width.
const SLOTS = { 3: headingSlots(3), 2: headingSlots(2), 1: headingSlots(1) };
function slotClasses(slug) {
  const classes = [];
  for (const cols of [3, 2, 1]) {
    const slot = SLOTS[cols].get(slug);
    if (!slot) continue;
    classes.push(`tc-line-${cols}`);
    if (slot.join) classes.push(`tc-join-${cols}`);
    if (slot.label === "run") classes.push(`tc-run-${cols}`);
  }
  return classes;
}
const sectionStyle = (id) =>
  SECTION_RULES[id] ? { "--rule-l": SECTION_RULES[id].light, "--rule-d": SECTION_RULES[id].dark } : undefined;
// The first row at the widest layout (3 columns) loads its prints eagerly; the
// page's first card fetches its top print at high priority.
const FIRST_ROW = new Set(placeCards(3).filter((card) => card.row === 0).map((card) => card.slug));
const FIRST_CARD = SECTIONS[0].tools[0].slug;

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface">
      <Header maxWidth="max-w-6xl" />

      <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 sm:pb-10 lg:px-12">
        <div className="pb-2 pt-9 sm:pb-3 sm:pt-[50px]">
          <p className="mb-3.5 font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.08em] text-content-secondary">
            Open-source operator tools
          </p>
          <h1 className="max-w-[16ch] font-display text-[length:clamp(30px,9.4vw,36px)] font-bold leading-[1.05] tracking-[-0.035em] text-content sm:text-[43px] lg:text-[47px]">
            Keep Helium running&nbsp;smoothly.
          </h1>
          <p className="mt-3.5 max-w-[56ch] text-base leading-[1.55] text-content-secondary">
            Monitor escrow balances, claim rewards, map your Hotspot fleet, and
            migrate legacy wallets. Free, open-source, no login required.
          </p>
        </div>

        <div className="tc-grid">
          {SECTIONS.map((section) => {
            const headId = `section-${section.id}`;
            const descId = `section-${section.id}-desc`;
            return (
              <section
                key={section.id}
                className="tc-section"
                style={sectionStyle(section.id)}
                aria-labelledby={headId}
                aria-describedby={descId}
              >
                {section.tools.map((feature, i) => {
                  const slot = slotClasses(feature.slug);
                  return (
                    <div key={feature.slug} className={`tc-cell${feature.featured ? " is-featured" : ""}`}>
                      {i === 0 && (
                        <div className={["tc-head", ...slot.filter((c) => c.startsWith("tc-join-"))].join(" ")}>
                          <h2 id={headId} className="font-display text-[20px] font-semibold leading-[1.2] tracking-[-0.02em] text-content">
                            {section.title}
                          </h2>
                          <p id={descId} className="mt-1 text-[13px] leading-[18px] text-content-tertiary">
                            {section.description}
                          </p>
                        </div>
                      )}
                      {i > 0 && slot.length > 0 && (
                        <div aria-hidden="true" className={["tc-slot", ...slot].join(" ")}>
                          {slot.some((c) => c.startsWith("tc-run-")) && (
                            <p className="tc-runtext font-display text-[20px] font-semibold leading-[1.2] tracking-[-0.02em] text-content-tertiary">
                              {section.title}
                            </p>
                          )}
                        </div>
                      )}
                      <ToolCard feature={feature} eager={FIRST_ROW.has(feature.slug)} priority={feature.slug === FIRST_CARD} />
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
