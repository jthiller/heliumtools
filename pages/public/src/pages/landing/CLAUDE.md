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
- The page opens on a compact header on the page background (no shader or
  image band), and the sections flow together through one card grid (below).

| File | Role |
|---|---|
| `sections.js` | `SECTIONS`, the tool list as plain data (section `id`, title, description → `tools`, each with `slug`, name, description, href, badge, `disabled`). Its order is the card order. Also `strandedSlugs(cols)`, the cards that get a running head. Read by the page and by the bake's palette check. |
| `../Landing.jsx` | The page: the compact header, the card grid, `ToolCard`. |
| `previews/<slug>.js` | One tool's composition: `tone` + `prints`. Schema in `previews/index.js`. |
| `previews/index.js` | slug → config registry, and the schema/composition rules. |
| `previews/tones.js` | The ground palette (OKLCH-derived, each tone with its `hue`, `null` for the neutral stone) and `DESC_INK`. |
| `previews/layout.js` | Stage geometry: `STAGE_RATIO`, `TOP_MARGIN`, `fan()` (hover pose), `topEdge()`. Shared with the bake lint. |
| `ToolPreview.jsx` | Renders the stage and prints as `<figure><picture>`. |
| `landing.css` | Grid, card, frames, hover, dark mode, reduced motion. |
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

## Page header and grid

Under the site `<Header />`, on the page background: a mono uppercase eyebrow,
the h1 (`font-display`, line height 1.05 at every width: 52px from 1024px,
48px from 640px, fluid 30–36px on phones; `max-w-[16ch]`, so it breaks "Keep
Helium / running smoothly."; the `&nbsp;` keeps the last two words together.
Use arbitrary sizes such as `sm:text-[48px]`: Tailwind's named sizes like
`text-5xl` also set a line height and would override `leading-[1.05]`) and
the lede (16px, 18px from 640px, secondary ink). Theme tokens only, so it
follows light and dark.

All the cards flow through one grid, `.tc-grid`, in `sections.js` order:
`repeat(auto-fill, minmax(min(100%, 340px), 1fr))`. That is three columns from
a 1060px grid (a ~1150px viewport; 381px cards at the full 1184px column, never
more than three), two from a 700px grid (~750px viewport), one below. A card is
never narrower than 340px unless the screen is. A single column stops at 560px
(about the lede's measure), left-aligned, so the 640–750px range gets a tidy
column rather than ~650px billboard cards. A section does not start a new row:
it starts wherever its first card lands, often mid-row, so cards of different
sections share rows (the hue families carry the grouping).

Each card sits in a `.tc-cell` that spans two grid rows and shares them
(`grid-template-rows: subgrid`): a heading slot, then the card. A section's
first cell puts the section heading (h2 + description) in its slot, 18px above
the card. The heading row takes the tallest heading in that row, so every card
in a row starts on the same line; a row with no heading has a zero-height
slot. The grid has no row gap: the card's margin (20px, 16px on phones) spaces
card rows and the heading's top padding (32px, 24px on phones) adds the
section break; `<main>`'s bottom padding is trimmed by the same margin so the
last row doesn't add space above the footer. Without subgrid support each
cell lays out on its own (headings don't line up across a row; nothing
breaks).

**Running heads.** When a section wraps into a new row and the next section
starts in that row, the outgoing section's card in that row would sit under
an empty slot beside the next section's heading and read as part of it. Such
a "stranded" card gets a running head in its slot: its own section's title in
the h2's type and tertiary ink, no description, `aria-hidden` (the region
already has its name), on the same baseline as the real h2 beside it.
Positions are fixed per column count, so `strandedSlugs(cols)` in
`sections.js` works them out from the order, Landing.jsx marks each cell
`tc-run-3` and/or `tc-run-2`, and `landing.css` shows them by the grid's width
(a named size container, `tc-grid`, at the same 1060px / 700px thresholds as
the column count); one column never shows one. Today: Buy Data Credits,
Hotspot Map and L1 Migration at 3 columns, L1 Migration at 2. The bake lists
them. No section order avoids stranding at both 3 and 2 columns for these
section sizes, so don't reorder to dodge it.

Semantics: each section is a `<section aria-labelledby aria-describedby>`
region named by its h2 and described by the description under it, with
`display: contents` so its cells are the grid's items (current browsers keep
a `display: contents` element's role and name). DOM order is reading order: a
section's heading, then its cards.

There is no wide or landscape card: every card, a section's only tool
included, is the same portrait card.

## Palette

Each section owns a contiguous OKLCH hue arc no other section uses; each tool
steps it. Neighbours (side by side, one above the other, or next in a single
column) differ by >= 30° of hue at 3, 2 and 1 columns. Since every card flows
through one grid, that includes cards of different sections that share a row
or sit above one another. Each tone carries the OKLCH `hue` it was generated
at, and **the bake checks every adjacency at 3, 2 and 1 columns** on the
`sections.js` order (and that each hued ground measures its declared hue); it
exits 1 and names the pair on a violation. The Hotspot section has six tools
and four hues; IoT Setup/Reward Claimer and Mobile WiFi/Hotspot Map share a hue
at two shade steps because those pairs never touch. The disabled stone is
neutral (`hue: null`, chroma under .012): it has no hue to see, so it is
exempt from the hue step and stands apart from any neighbour by being
colorless. The bake holds a neutral to that (every ground stop under chroma
.02) and fails if two neutrals ever touch. Adding, removing or reordering
tools in `sections.js` moves every later card; run the bake.

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
  and `loading="lazy"` except the first row's cards at the widest layout (the
  first three in flow order, `eager`; in the first viewport at 3 columns).
  Only the page's first card's top print gets `fetchpriority="high"`, since
  the other two sit below the fold on phones.
- `<picture>` with a `(prefers-color-scheme: dark)` `<source>`: Tailwind's
  `darkMode` is `media`, so a visitor downloads one theme.
- Hover/focus fans the stack (`fan()` in `layout.js`): the top print straightens,
  lifts and scales up, the others splay out. Only `a.tool-card` answers;
  pointer `:hover` is inside `@media (hover: hover)` so taps don't leave a sticky
  fan; `:focus-visible` works everywhere and also draws the outline.
- `prefers-reduced-motion`: transforms stay at rest; only the shadow deepens.

## The disabled card

Buy Data Credits is `disabled: true` in `sections.js`: a plain `<div>`, not a
link and not focusable. Its prints are desaturated (`saturate(0.2)`, the only
recolor allowed) on the neutral stone ground, and only its name is dimmed
(the description keeps full contrast). Enabling the tool means removing
`disabled` (and the "Coming Soon" badge); the card then fans like any other.
Stone marks it disabled, so also give it a hued tone that keeps the palette
rules (ask the owner which hue), and re-capture if its UI changed.

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
1. Add the tool to `SECTIONS` in `sections.js` with a `slug`, and add
   `previews/<slug>.js` with the next tone step of its section. Register it in
   `previews/index.js`. A new section gets its own family in `tones.js` on a
   hue arc no other section uses (and an `id` in `sections.js`). A new card
   shifts every card after it in the grid, so the bake's neighbour check may
   flag pairs elsewhere; fix them with tone steps generated from OKLCH.
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
and update `previews/index.js`, `sections.js` and the paths in the tool's
`## Landing preview` section. **Removing a tool**: delete those same files and
its registry entry, then run the bake: the cards after the gap move, and its
neighbour check covers them.

**Changing `sections.js` order or sections**: run the bake for its neighbour
check (the tone steps are assigned by position in a section) and look at the
running heads it lists at 3 and 2 columns; the page places them by itself.

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
