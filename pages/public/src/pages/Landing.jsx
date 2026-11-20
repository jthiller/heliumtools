import { useCallback, useEffect, useRef, useState } from "react";
import { ListBulletIcon, Squares2X2Icon } from "@heroicons/react/16/solid";
import Header from "../components/Header.jsx";
import ToolPreview from "./landing/ToolPreview.jsx";
import { SECTIONS, placeCards, headingSlots } from "./landing/sections.js";
import { PREVIEWS } from "./landing/previews/index.js";
import { TONES, SECTION_RULES } from "./landing/previews/tones.js";
import { getLocalStorageItem, setLocalStorageItem } from "../lib/utils.js";
import "./landing/landing.css";

// The tool list itself lives in ./landing/sections.js (plain data, so the
// preview bake can check the palette against the same order). Layout and card
// docs: ./landing/CLAUDE.md.

// The page shows the tools one of two ways: the picture cards (the default) or
// a text-only list, for visitors who come to find a tool rather than to browse.
// The switch sits in the page header; the choice is kept in this browser's
// localStorage, so it holds across visits and is never sent anywhere.
const VIEW_KEY = "heliumtools:landing:view:v1";
const VIEWS = [
  { id: "cards", label: "Cards", Icon: Squares2X2Icon },
  { id: "list", label: "List", Icon: ListBulletIcon },
];
const storedView = () => (getLocalStorageItem(VIEW_KEY) === "list" ? "list" : "cards");

// The page's eyebrow type (mono capitals), shared with the list view's section
// names so the two stay the same.
const EYEBROW = "font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.08em] text-content-secondary";

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

// Card motion: the hover fan and the mouse drift are one JS-driven animation.
// Each card has two springs: the fan's progress h (0 at rest, 1 fanned;
// slightly underdamped, so it settles with a hint of overshoot) and the drift
// (the pointer's offset from the card centre, -1..1 per axis, flipped, so the
// prints drift away from it; critically damped). One animation-frame loop per
// card steps them and writes --h, --px and --py on the card; landing.css turns
// those into each print's transform (rest pose, plus h times the fan pose from
// previews/layout.js fan(), plus h times the drift for the print's depth). Each
// spring chases a goal that itself eases toward the target (a short
// exponential low-pass), so acceleration builds from zero and never steps: a
// hover starts gently, and leaving, coming back or a sudden mouse move
// mid-motion bends the path instead of kicking it. Mouse hover and keyboard
// focus fan the stack; only a mouse drifts it; reduced motion leaves it at rest
// (CSS still deepens the shadow).
const REDUCED_MOTION =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };
// Natural frequency (rad/s), damping ratio, and the goal's low-pass time
// constant (s).
const FAN_SPRING = { w: 12, z: 0.82, lag: 0.07 };
const DRIFT_SPRING = { w: 10, z: 1, lag: 0.06 };
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
// One step: the goal eases toward `target`, then a semi-implicit Euler step of
// the damped spring toward the goal.
function springStep(s, target, { w, z, lag }, dt) {
  s.g += (target - s.g) * (1 - Math.exp(-dt / lag));
  s.v += (w * w * (s.g - s.x) - 2 * z * w * s.v) * dt;
  s.x += s.v * dt;
}
const settledAt = (s, target) => Math.abs(s.x - target) < 0.001 && Math.abs(s.g - target) < 0.001 && Math.abs(s.v) < 0.01;
const at = (x) => ({ x, v: 0, g: x });

function useCardMotion() {
  const motion = useRef({
    card: null,
    hover: false,
    focus: false,
    tx: 0,
    ty: 0,
    h: at(0),
    px: at(0),
    py: at(0),
    frame: 0,
    last: 0,
  });
  useEffect(() => () => cancelAnimationFrame(motion.current.frame), []);
  const step = useCallback((now) => {
    const m = motion.current;
    const dt = Math.min(0.032, m.last ? (now - m.last) / 1000 : 1 / 60);
    m.last = now;
    const fanned = m.hover || m.focus ? 1 : 0;
    const tx = m.hover ? m.tx : 0;
    const ty = m.hover ? m.ty : 0;
    for (let i = 0; i < 2; i++) {
      springStep(m.h, fanned, FAN_SPRING, dt / 2);
      springStep(m.px, tx, DRIFT_SPRING, dt / 2);
      springStep(m.py, ty, DRIFT_SPRING, dt / 2);
    }
    const settled = settledAt(m.h, fanned) && settledAt(m.px, tx) && settledAt(m.py, ty);
    if (settled) {
      m.h = at(fanned);
      m.px = at(tx);
      m.py = at(ty);
    }
    const { style } = m.card;
    if (settled && fanned === 0) {
      style.removeProperty("--h");
      style.removeProperty("--px");
      style.removeProperty("--py");
    } else {
      style.setProperty("--h", m.h.x.toFixed(4));
      style.setProperty("--px", m.px.x.toFixed(4));
      style.setProperty("--py", m.py.x.toFixed(4));
    }
    if (settled) {
      m.frame = 0;
      m.last = 0;
      return;
    }
    m.frame = requestAnimationFrame(step);
  }, []);
  const run = useCallback((card) => {
    const m = motion.current;
    m.card = card;
    if (!m.frame) m.frame = requestAnimationFrame(step);
  }, [step]);
  const aim = (m, event) => {
    const box = event.currentTarget.getBoundingClientRect();
    m.tx = -clampUnit(((event.clientX - box.left) / box.width) * 2 - 1);
    m.ty = -clampUnit(((event.clientY - box.top) / box.height) * 2 - 1);
  };
  const onPointerEnter = useCallback((event) => {
    if (event.pointerType !== "mouse" || REDUCED_MOTION.matches) return;
    const m = motion.current;
    m.hover = true;
    aim(m, event);
    run(event.currentTarget);
  }, [run]);
  const onPointerMove = useCallback((event) => {
    if (event.pointerType !== "mouse" || REDUCED_MOTION.matches) return;
    const m = motion.current;
    m.hover = true;
    aim(m, event);
    run(event.currentTarget);
  }, [run]);
  const onPointerLeave = useCallback((event) => {
    const m = motion.current;
    if (!m.hover) return;
    m.hover = false;
    run(event.currentTarget);
  }, [run]);
  const onFocus = useCallback((event) => {
    if (REDUCED_MOTION.matches || !event.currentTarget.matches(":focus-visible")) return;
    motion.current.focus = true;
    run(event.currentTarget);
  }, [run]);
  const onBlur = useCallback((event) => {
    const m = motion.current;
    if (!m.focus) return;
    m.focus = false;
    run(event.currentTarget);
  }, [run]);
  return { onPointerEnter, onPointerMove, onPointerLeave, onFocus, onBlur };
}

// A tool's name as its <h3>, in either view. The badge rides on the name's last
// word, so a wrapped name never strands it.
function ToolName({ feature, id, className, badgeClassName }) {
  const words = feature.name.split(" ");
  const last = words.pop();
  return (
    <h3 id={id} className={className}>
      {words.length > 0 && `${words.join(" ")} `}
      <span className="tc-nowrap">
        {last}
        {feature.badge && (
          <>
            {" "}
            <span className={badgeClassName}>{feature.badge}</span>
          </>
        )}
      </span>
    </h3>
  );
}

// The whole card is the link (no separate CTA); its accessible name is the
// <h3> (name + badge), the description is its description. The disabled
// Coming-soon card is a plain, unfocusable block. A featured card also carries
// its wide print set (shown while it spans two columns). `eager`: in the first
// row, so its prints aren't lazy-loaded; `priority`: the page's first card,
// whose top print is fetched at high priority.
function ToolCard({ feature, eager, priority }) {
  const preview = previewFor(feature.slug);
  const motion = useCardMotion();
  const nameId = `tool-${feature.slug}-name`;
  const descId = `tool-${feature.slug}-desc`;
  const body = (
    <>
      <div className="tc-text">
        <ToolName feature={feature} id={nameId} className="tc-name font-display" badgeClassName="tc-badge font-mono" />
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
      {...motion}
      href={feature.href}
      className={`tool-card${featured}`}
      aria-labelledby={nameId}
      aria-describedby={descId}
    >
      {body}
    </a>
  );
}

// The list view's row for one tool: its name and full description as one link,
// named and described the way a card is. No tone and no preview, so the list
// loads no prints. A disabled tool is a plain, unfocusable block here too.
function ToolRow({ feature }) {
  const nameId = `tool-${feature.slug}-name`;
  const descId = `tool-${feature.slug}-desc`;
  const body = (
    <>
      <ToolName feature={feature} id={nameId} className="tl-name font-display" badgeClassName="tl-badge font-mono" />
      <p id={descId} className="tl-desc font-sans">
        {feature.description}
      </p>
    </>
  );
  if (feature.disabled) {
    return (
      <div data-tool={feature.slug} className="tl-item is-disabled">
        {body}
      </div>
    );
  }
  return (
    <a data-tool={feature.slug} href={feature.href} className="tl-item" aria-labelledby={nameId} aria-describedby={descId}>
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

function ToolGrid() {
  return (
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
  );
}

// The list view (.tl-list in landing.css): the same sections and tools in the
// same order, as text. Each section is a named region that stays whole and
// flows into as many columns as fit (three at the card grid's three-column
// width), under its section's colored rule.
function ToolList() {
  return (
    <div className="tl-list">
      {SECTIONS.map((section) => {
        const headId = `section-${section.id}`;
        return (
          <section key={section.id} className="tl-section" style={sectionStyle(section.id)} aria-labelledby={headId}>
            <h2 id={headId} className={`tl-head ${EYEBROW}`}>
              {section.title}
            </h2>
            {/* role="list": Safari drops a list's semantics once its markers
                are off (Tailwind's preflight turns them off). */}
            <ul role="list">
              {section.tools.map((feature) => (
                <li key={feature.slug}>
                  <ToolRow feature={feature} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Cards / List: two toggle buttons in a labelled group, the pressed one being
// the current view.
function ViewSwitch({ view, onChange }) {
  return (
    <div role="group" aria-label="Show tools as" className="inline-flex rounded-lg border border-border p-0.5">
      {VIEWS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium sm:px-2.5 sm:py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content ${
            view === id ? "bg-surface-inset text-content" : "text-content-secondary hover:text-content"
          }`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Landing() {
  const [view, setView] = useState(storedView);
  const chooseView = (next) => {
    setView(next);
    setLocalStorageItem(VIEW_KEY, next);
  };
  return (
    <div className="min-h-screen bg-surface">
      <Header maxWidth="max-w-6xl" />

      <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 sm:pb-10 lg:px-12">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pb-2 pt-9 sm:pb-3 sm:pt-[50px]">
          <div>
            <p className={`mb-3.5 ${EYEBROW}`}>
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
          <ViewSwitch view={view} onChange={chooseView} />
        </div>

        {view === "list" ? <ToolList /> : <ToolGrid />}
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
