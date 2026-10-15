# Landing tool cards ("paper stack")

The tool cards on `/` (`../Landing.jsx`). Each card is one link: a tinted
ground, the tool's name and description as real text, and below them 2–3
framed snapshots cropped from the real tool, lying at small tilts and
overlapping. There is no CTA; the whole card is the link.

The site owner picked this direction ("paper stack") over four others in
October 2026 and set these rules; don't revert them without asking:
- No "Open tool" CTA, pill or arrow. The card is the affordance.
- The "New" badge is straight (never tilted) and sits in the same slot on
  every card. Recurring elements stay in one place card to card.
- No meta labels on the page (direction names, counts, designer notes).
- Dark grounds are clearly colored mid-tone fields, not near-black tints.

| File | Role |
|---|---|
| `../Landing.jsx` | The `sections` array (section → `tools`, each with `slug`, name, description, href, badge, `disabled`). Renders `ToolCard`. |
| `previews/<slug>.js` | One tool's composition: `tone` + `prints` (+ `wide`). Schema in `previews/index.js`. |
| `previews/index.js` | slug → config registry, and the schema/composition rules. |
| `previews/tones.js` | The ground palette (OKLCH-derived) and `DESC_INK`. |
| `previews/layout.js` | Stage geometry: `STAGE_RATIO`, `TOP_MARGIN`, `fan()` (hover pose), `topEdge()`. Shared with the bake lint. |
| `ToolPreview.jsx` | Renders the stage(s) and prints as `<figure><picture>`. |
| `landing.css` | Card, grid, wide variant, frames, hover, dark mode, reduced motion. |
| `../../assets/previews/<slug>/<id>-<light\|dark>.webp` | Baked prints (committed; Vite fingerprints them). |
| `scripts/tool-previews/` | The capture → bake → shoot kit. Its README covers the workflow. |

## Card anatomy (fixed)

- Text block on top: name (`font-display`, 20px/600, 19px under 640px, one
  step under the section h2's 22px), then the badge, then the description
  (`font-sans` 15/1.5, never shortened). The badge is a straight paper pill
  right after the name's last word on every card (`tc-nowrap` keeps them
  together); the disabled card shows its "Coming Soon" badge in the same slot.
- Stage below: 100 × 80 cqw, anchored to the card bottom, so a longer
  description adds tabletop above the stack and never moves it. `.tc-table` is
  the size container; everything on the stage is in cqw of it.
- Prints: thick paper frame (white in light, `#2a2a2f` graphite in dark, lighter
  than the dark captures so the mat reads as a rim), large radii, a hue-tinted
  shadow. They may bleed off the sides and bottom, never into the text: the top
  edge keeps `TOP_MARGIN` (3% of the stage) at rest and on hover.
- No meta labels on the page (direction names, counts, notes).

## Grid and the wide card

`.tc-grid` is `repeat(auto-fill, minmax(min(100%, 340px), 1fr))`: three columns
at desktop (381px cards), two from ~750px, one on phones. A card is never
narrower than 340px unless the screen is.

A section with a single tool (Wallet, Brand) gives its card the whole row
(`is-wide`, when its config has `wide` prints). Once the section's grid is
>= 700px wide (`@container tc-grid`), the card turns landscape: the text in a
left column (`clamp(280px, 30cqw, 340px)`) and a 100 × 55 cqw stage filling the
rest, about as tall as a standard card. Narrower, it shows the portrait stage.
Both stages are rendered; the hidden one's lazy images never load. A wide print
with no `src` reuses the portrait print of that id (same file), so only the
wide-only prints cost extra bytes, and only on wide screens.

## Palette

Each section owns a contiguous OKLCH hue arc no other section uses; each tool
steps it. Neighbours (side by side, above/below, or next in a single column)
differ by >= 30° of hue at 3, 2 and 1 columns, including across a section
heading (the last card of one section and the first card of the next). The Hotspot section has six
tools and four hues; IoT Setup/Reward Claimer and Mobile WiFi/Hotspot Map share
a hue at two shade steps because those pairs never touch. **Reordering tools
in `Landing.jsx` can break the neighbour rule**; re-check it.

Light grounds are pastels with same-hue dark ink. Dark grounds are clearly
colored mid-dark fields (L .45–.54, C .10–.15), not near-blacks: warm darks stay
at h >= 44 (nothing reads red beside a green), amber stays at L >= .48 (ochre,
not brown), nothing sits in the 85–115° olive band. Description ink (ink at
`--desc`, mirrored as `DESC_INK`) is >= 4.5:1 on both gradient stops; the bake
checks it. Generate tones from OKLCH values, not hand-picked hex.

## Accessibility and hover contract

- The card `<a>` is named by its `<h3>` (`aria-labelledby`, name + badge) and
  described by the description (`aria-describedby`). The preview is
  `aria-hidden`; every `<img>` has `alt=""`, width/height, `decoding="async"`,
  and `loading="lazy"` except the first section's card (`eager`: in the first
  viewport; only prints both layouts share go eager, the top one with
  `fetchpriority="high"`).
- `<picture>` with a `(prefers-color-scheme: dark)` `<source>`: Tailwind's
  `darkMode` is `media`, so a visitor downloads one theme.
- Hover/focus fans the stack (`fan()` in `layout.js`): the top print straightens,
  lifts and scales up, the others splay out. Only `a.tool-card` answers;
  pointer `:hover` is inside `@media (hover: hover)` so taps don't leave a sticky
  fan; `:focus-visible` works everywhere and also draws the outline.
- `prefers-reduced-motion`: transforms stay at rest; only the shadow deepens.

## The disabled card

Buy Data Credits is `disabled: true` in `Landing.jsx`: a plain `<div>`, not a
link and not focusable. Its prints are desaturated (`saturate(0.2)`, the only
recolor allowed) on the neutral stone ground, and only its name is dimmed
(the description keeps full contrast). Enabling the tool means removing
`disabled` (and the "Coming Soon" badge); the card then fans like any other.
Stone marks it disabled, so also give it a hued tone that keeps the palette
rules below (ask the owner which hue), and re-capture if its UI changed.

## Assets and budget

Built only from real captures: crop, scale, tilt, layer. No drawn or invented
UI, no recoloring. WebP at ~2x the displayed width at desktop card size,
quality ~78. Budget: all tools' prints together <= ~500 KB per theme (a visitor
downloads one theme), any single print <= 60 KB. The bake reports both. Never
hand-edit the WebP files; change the config and re-bake
(`node scripts/tool-previews/bake.mjs <slug>`), which needs that tool's local
captures (see the kit README).

## Keeping cards current

A card is a picture of the tool's real UI, so it is part of the tool's
documented behavior (root `CLAUDE.md`). Each tool's own `CLAUDE.md` has a
`## Landing preview` section naming what its card shows and how it was
captured; that list is what decides whether a change touches the card. Commands
run from `scripts/tool-previews/` with the frontend up (kit README).

**Adding a tool page** (all in the same commit):
1. Add the tool to `sections` in `Landing.jsx` with a `slug`, and add
   `previews/<slug>.js` with the next tone step of its section (re-check the
   neighbour rule in `tones.js` at 3, 2 and 1 columns). Register it in
   `previews/index.js`. A new section gets its own family in `tones.js` on a
   hue arc no other section uses. A section's only tool gets the full-row card,
   so its config also needs a `wide` set; a tool joining Wallet or Brand turns
   that section's card back to portrait (its `wide` set goes unused).
2. Write `scripts/tool-previews/capture/<slug>.mjs` (copy a similar tool's
   script; follow the capture rules below) and run it.
3. Compose `prints`, then `node bake.mjs <slug>` and
   `node shoot.mjs <slug> --both --hover`. Look at light, dark, phone and hover.
   The bake must exit 0.
4. Add a `## Landing preview` section to the tool's `CLAUDE.md` (what the
   prints show, the capture script, the state, wallet and mocks it uses).

A missing config renders an empty stone card and warns in dev, so the page never
breaks, but never ship a tool that way.

**Changing a tool** whose change shows in any print the tool's
`## Landing preview` section lists (layout, colors, labels, the anchor
component, or the state the capture drives, such as a renamed button the
script clicks): re-run `node capture/<slug>.mjs`, re-check the crop rects in
`previews/<slug>.js` against the new captures, re-bake, re-shoot and look, in
the same commit. Capture from the dev server running your change (`BASE`
defaults to it); production doesn't have it yet. A change the card can't show
(copy elsewhere on the page, worker internals) needs nothing. When unsure, open
the tool beside `node shoot.mjs <slug>`'s card; if the card no longer matches,
re-capture. If the change moves or removes what the card's anchor shows,
re-compose the card rather than keep a stale picture. Update the tool's
`## Landing preview` section if the prints or capture change.

**Site-wide visual changes** (color tokens or shadows in `index.css`, fonts,
the Tailwind theme, a shared component such as `StatusBanner`) reach every
card whose prints show them: re-capture and re-bake each affected tool the
same way.

**Renaming a tool's slug or route**: rename its `previews/<slug>.js`, its
`src/assets/previews/<slug>/` folder, its capture script and capture folder
together (the script names its slug, route and default output folder inside),
and update `previews/index.js`, `Landing.jsx` and the paths in the tool's
`## Landing preview` section. **Removing a tool**: delete those same files and
its registry entry, then re-check the neighbour rule for the cards that close
the gap.

**Changing `Landing.jsx` order or sections**: re-check the neighbour rule; the
tone steps are assigned by position in a section.

## Capture rules

Capture scripts drive the production API through the dev server, so they are
held to the same safety bar as the tools themselves:

- Read-only. Never click anything that signs, claims, mints, burns,
  subscribes, migrates, purchases, onboards or broadcasts. Two backstops catch
  most of these: `lib.mjs`'s fake wallet throws on any signing call, and its
  guard aborts any `sendTransaction` RPC and any non-GET request whose path
  matches its claim/subscribe/broadcast/migrate/submit/purchase/order/webhook/
  verify/send pattern. The guard is a pattern, not a list: it misses write endpoints such
  as `/issue`, `/onboard`, `/cert` or `/agent-brief`, so not clicking is the
  rule. To show a post-action state (a success banner, an order's progress),
  fulfill the request with a local `page.route()` mock so it never reaches
  the worker.
- Wallets: only the showcase wallets in `lib.mjs`'s `WALLETS`, which the site
  owner chose for this. Never look up or hard-code other people's wallets (for
  example voters from the governance rosters) to get a richer state; ask the
  owner for a wallet instead. Never type an email address.
- Light and dark come from one page state (`emulateMedia`), so the same crop
  rect frames the same content in both themes.
- Mocked hardware (Web Bluetooth for IoT Setup) and mocked post-action
  responses must look like the tool's real states; never invent UI the tool
  doesn't have.
