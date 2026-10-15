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
- Wallet Dashboard and Add a Hotspot are featured: two columns wide.
- Sizes sit about 10% under the first compact version (the owner found the page
  looked better zoomed out to 90%); keep the scale below when adding to it.
- Buy Data Credits is hidden until it works (below).
- Heading rows carry section-colored rules (from exploration D) so wrapped
  sections read as groups, and a mouse moving over a card nudges its prints
  (parallax) on top of the hover fan.

| File | Role |
|---|---|
| `sections.js` | The tool list as plain data (section `id`, title, description → `tools`, each with `slug`, name, description, href, badge, `featured`, `disabled`, `hidden`). `SECTIONS` is the visible list (hidden tools dropped); its order is the card order. Also `placeCards(cols)`, where every card lands, `headingSlots(cols)`, the heading-row slots (rule, join, label), and `runningHeads(cols)`, the cards that get a running head. Read by the page and by the bake's palette and layout checks. |
| `../Landing.jsx` | The page: the compact header, the card grid, `ToolCard`. |
| `previews/<slug>.js` | One tool's composition: `tone` + `prints` (+ `featured` for a featured card). Schema in `previews/index.js`. |
| `previews/index.js` | slug → config registry, and the schema/composition rules. |
| `previews/tones.js` | The ground palette (OKLCH-derived, each tone with its `hue`, `null` for the neutral stone), `SECTION_RULES` (each section's rule color) and `DESC_INK`. |
| `previews/layout.js` | Stage geometry: `STAGE_RATIO`, `FEATURED_RATIO`, `TOP_MARGIN`, `fan()` (hover pose), `topEdge()`, and the mouse parallax (`PARALLAX`, `depthOf()`, `hoverTop()`). Shared with the bake lint. |
| `ToolPreview.jsx` | Renders the stage and prints as `<figure><picture>`; a featured card gets its wide stage too. |
| `landing.css` | Grid, card, frames, hover, dark mode, reduced motion. |
| `../../assets/previews/<slug>/<id>-<light\|dark>.webp` | Baked prints (committed; Vite fingerprints them). |
| `scripts/tool-previews/` | The capture → bake → shoot kit. Its README covers the workflow. |

## Card anatomy (fixed)

- Text block on top: name (`font-display`, 18px/600, one step under the
  section h2's 20px), then the badge (mono 9.5px), then the description
  (`font-sans` 13.5/1.5, 15px on phones, never shortened). The badge is a
  straight paper pill right after the name's last word on every card
  (`tc-nowrap` keeps them together); a disabled card shows its "Coming Soon"
  badge in the same slot. Card radius 25px (24px on phones), text padding 23px.
- Stage below: 100 × 80 cqw, anchored to the card bottom, so a longer
  description adds tabletop above the stack and never moves it. `.tc-table` is
  the size container; everything on the stage is in cqw of it.
- Prints: thick paper frame (white in light, `#2a2a2f` graphite in dark, lighter
  than the dark captures so the mat reads as a rim), large radii, a hue-tinted
  shadow. They may bleed off the sides and bottom, never into the text: the top
  edge keeps `TOP_MARGIN` (3% of the stage) at rest and on hover.
- No meta labels on the page (direction names, counts, notes).

## Page header and grid

The page column is `max-w-6xl` (1152px); `<Header maxWidth="max-w-6xl" />`
gets the same width so the logo lines up with the h1 (tool pages keep the
header's default `max-w-7xl`). Under the header, on the page background: a mono
uppercase eyebrow (11.5px), the h1 (`font-display`, line height 1.05 at every
width: 47px from 1024px, 43px from 640px, fluid 30–36px on phones;
`max-w-[16ch]`, so it breaks "Keep Helium / running smoothly."; the `&nbsp;`
keeps the last two words together. Use arbitrary sizes such as
`sm:text-[43px]`: Tailwind's named sizes like `text-5xl` also set a line height
and would override `leading-[1.05]`) and the lede (16px, secondary ink). Theme
tokens only, so it follows light and dark.

All the cards flow through one grid, `.tc-grid`, in `sections.js` order:
`repeat(auto-fill, minmax(min(100%, 306px), 1fr))`. That is three columns from
a 954px grid (a ~1050px viewport; 340px cards in the full 1056px column, never
more than three), two from a 630px grid (~680px viewport), one below. A card is
never narrower than 306px unless the screen is. A single column stops at 504px
(about the lede's measure), left-aligned, so the 640–680px range gets a tidy
column rather than billboard cards. A section does not start a new row: it
starts wherever its first card lands, often mid-row, so cards of different
sections share rows (the hue families carry the grouping).

Each card sits in a `.tc-cell` that spans two grid rows and shares them
(`grid-template-rows: subgrid`): a heading slot, then the card. A section's
first cell puts the section heading (h2 20px + its 13px description) in its
slot, 16px above the card. The heading row takes the tallest heading in that row, so every card
in a row starts on the same line; a row with no heading has a zero-height
slot. The grid has no row gap: the card's margin (18px, 16px on phones) spaces
card rows and the heading's top padding (28px, 24px on phones) adds the
section break; `<main>`'s bottom padding is trimmed by the same margin so the
last row doesn't add space above the footer. Without subgrid support each
cell lays out on its own (headings don't line up across a row; nothing
breaks).

**Section rules and running heads.** A row where any section starts is a
heading row. Every card in it gets a slot with its section's colored rule
across the top (a 1px hairline at 45% opacity, so it groups the cards without
competing with the headings; `SECTION_RULES` in `tones.js`: one mid-tone of
the section's hue family per theme), and the rule runs on
across the gap when the next card in the row is the same section, so each
section's run of cards in that row reads as one group (the hairline above
each section in exploration D, colored). A section's first card carries the
heading under its rule. When a section wraps into a new row and the next
section starts in that row, the outgoing section's first card there would sit
beside the next section's heading and read as part of it, so it gets a
running head under its rule: its own section's title in the h2's type and
tertiary ink, no description, `aria-hidden` (the region already has its
name), on the same baseline as the real h2 beside it. The section's other
cards in that row get only the rule. Rows with no section start have no
slots. The slots stretch to the row's height and set their text on the
bottom, so all the rules in a row share one line.

Positions are fixed per column count, so `headingSlots(cols)` in `sections.js`
works the slots out from `placeCards(cols)`; Landing.jsx marks each slot
`tc-line-N`, `tc-join-N` and `tc-run-N` per column count, and `landing.css`
picks the set for the grid's width (a named size container, `tc-grid`, at the
same 954px / 630px thresholds as the column count). Today the running heads
are Mint Data Credits, Reward Claimer and veHNT Positions at 3 columns and
Hotspot Map at 2; the bake lists them. The order is set by where the featured
cards fit and by the palette, so don't reorder just to dodge a running head.
A new section needs a `SECTION_RULES` entry keyed by its `id` (without one its
rule falls back to the border color).

Semantics: each section is a `<section aria-labelledby aria-describedby>`
region named by its h2 and described by the description under it, with
`display: contents` so its cells are the grid's items (current browsers keep
a `display: contents` element's role and name). DOM order is reading order: a
section's heading, then its cards.

## Featured cards

A tool with `featured: true` in `sections.js` (today Wallet Dashboard and Add a
Hotspot) spans two grid columns wherever the grid has two or more, and shows a
wide stage: 100 × 45 cqw (`FEATURED_RATIO`), about twice as wide as a portrait
stage at roughly the same height, so it lines up with its row. Its description
keeps a 62ch measure. At one column it is an ordinary card with its portrait
stage. Its config carries a `featured` print set beside `prints`; a featured
print without its own `src` reuses the portrait print with that `id` (the same
baked file, placed anew), so only the extra prints cost bytes. Both stages are
rendered and `landing.css` shows one by the grid's width; the hidden stage's
lazy images never load. When a featured card is in the first row, only the
prints both stages use load eagerly. The composition rules apply to the wide
stage unchanged.

Featured cards constrain the order. A featured card that reaches a row with one
column left wraps to the next row and leaves a hole, so `placeCards(cols)`
mirrors CSS grid's placement and the bake fails on any empty cell before the
last row at 3 or 2 columns. Today Add a Hotspot sits third in its section
(after Mobile WiFi), which fills every row at 3 columns and leaves only the last
cell empty at 2.

## Palette

Each section owns a contiguous OKLCH hue arc no other section uses; each tool
steps it. Neighbours (side by side, one above the other, or next in a single
column) differ by >= 30° of hue at 3, 2 and 1 columns. Since every card flows
through one grid, that includes cards of different sections that share a row
or sit above one another. Each tone carries the OKLCH `hue` it was generated
at, and **the bake checks every adjacency at 3, 2 and 1 columns** on the
`placeCards` layout, featured spans included (and that each hued ground
measures its declared hue); it exits 1 and names the pair on a violation. The Hotspot section has six tools
and four hues; IoT Setup/Reward Claimer and Mobile WiFi/Hotspot Map share a hue
at two shade steps because those pairs never touch. The stone tone (Buy Data
Credits, hidden for now) is neutral (`hue: null`, chroma under .012): it has
no hue to see, so it is
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
  and `loading="lazy"` except the first row's cards at the widest layout
  (`placeCards(3)` row 0, today Wallet Dashboard and OUI Notifier: `eager`; for
  a featured card only the prints both of its stages use). Only the page's
  first card's top print gets `fetchpriority="high"`, since the rest of the
  first row sits below the fold on phones.
- `<picture>` with a `(prefers-color-scheme: dark)` `<source>`: Tailwind's
  `darkMode` is `media`, so a visitor downloads one theme.
- Hover/focus fans the stack (`fan()` in `layout.js`): the top print straightens,
  lifts and scales up, the others splay out. Only `a.tool-card` answers;
  pointer `:hover` is inside `@media (hover: hover)` so taps don't leave a sticky
  fan; `:focus-visible` works everywhere and also draws the outline.
- Mouse parallax: while a mouse moves over a link card, its prints drift away
  from the pointer, the top print the most (`depthOf()`: 1 for the top print
  down to 0.35 for the bottom one; up to `PARALLAX` 1.6 / 1.1 cqw sideways /
  vertically at depth 1). Landing.jsx `useParallax` takes the pointer's offset
  from the card centre (-1..1, flipped) as a target and eases `--px` / `--py`
  on the card toward it in an animation-frame loop (exponential, `DRIFT_MS`
  140ms; back to 0 after the mouse leaves; the loop stops once settled). Each
  print sits in a stage-sized `.tc-drift` wrapper that carries the drift
  (`translate`) and the stacking order, while the hover fan animates the
  figure inside it: two elements, so the motions never interfere. Don't move
  the drift onto the figure or back into a CSS transition: Chrome composites
  an element's transform-type animations as a group, so a drift transition
  restarted on every mouse move restarted the running fan and made it stutter.
  While the drift moves the card has `is-drifting`, which gives the wrappers
  their own compositor layers. Mouse only (not touch or pen), never under
  reduced motion. `fan()` keeps room for the drift: a derived lift
  leaves the top edge `TOP_MARGIN` clear even at the largest drift, and the
  bake lints the hover pose with it (`hoverTop()`). Keep `PARALLAX` and the
  `.tc-drift` `translate` amounts in `landing.css` in sync.
- `prefers-reduced-motion`: transforms stay at rest (no fan, no drift); only
  the shadow deepens.

## Hidden and disabled cards

`hidden: true` in `sections.js` keeps a tool off the page entirely: `SECTIONS`
drops it, so it takes no grid cell and no part in the bake's layout and
palette checks, while its preview config and baked prints stay (the bake
still bakes them) so it can come back. Buy Data Credits is hidden (and
`disabled`) because it isn't fully working yet.

`disabled: true` shows a plain `<div>` card, not a link and not focusable: its
prints are desaturated (`saturate(0.2)`, the only recolor allowed) on the
neutral stone ground, and only its name is dimmed (the description keeps full
contrast). Showing Buy Data Credits again: delete `hidden` to bring it back as
a "Coming Soon" card, or `hidden`, `disabled` and the badge once it works; then
give it a hued tone that keeps the palette rules (ask the owner which hue),
re-capture if its UI changed, and run the bake, since every card after it
moves and a featured card may now wrap.

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
1. Add the tool to the list in `sections.js` with a `slug`, and add
   `previews/<slug>.js` with the next tone step of its section. Register it in
   `previews/index.js`. A new section gets its own family in `tones.js` on a
   hue arc no other section uses (and an `id` in `sections.js`). A new card
   shifts every card after it in the grid, so the bake's neighbour and hole
   checks may flag pairs or a wrapped featured card elsewhere; fix them with
   tone steps generated from OKLCH, or by moving a card.
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

**Changing `sections.js` order, sections, or a `featured` or `hidden` flag**:
run the bake for its neighbour and hole checks and look at the running heads
it lists at 3 and 2 columns; the page places them by itself. Featuring a tool
also needs a `featured` print set in its config (the bake fails without one).

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
