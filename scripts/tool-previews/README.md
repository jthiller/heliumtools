# Tool-preview capture kit

Dev tooling for the landing page's tool cards. It is not part of the Pages build.

Each card on `/` shows a small tabletop of framed snapshots of the real tool. The snapshots are tilted, overlapping, and baked to WebP from real screenshots. This kit does three things:

- holds the source captures,
- bakes the prints a card uses,
- screenshots the cards so you can check them.

| Where | What |
|---|---|
| `pages/public/src/pages/landing/CLAUDE.md` | How the cards work: the owner's rules, anatomy, the page header and shared grid, palette rules, a11y and hover contract, the checklists for adding, changing, renaming or removing a tool, and the capture rules. Read it first. |
| `pages/public/src/pages/landing/sections.js` | The tool list as plain data, in card order (with `featured` and `hidden` flags), plus `placeCards(cols)` (where every card lands) and `runningHeads(cols)` (which cards get a running head). The page renders it; the bake checks the palette and the layout against it. |
| `pages/public/src/pages/landing/previews/<slug>.js` | A tool's composition: its ground tone plus the prints (crop rect, size, position, tilt). The schema and composition rules are in `previews/index.js`. |
| `pages/public/src/pages/landing/previews/tones.js` | The ground palette. Each landing section owns one hue arc, each tool steps it, and neighbours differ by >= 30° at every grid width. Each tone declares its OKLCH `hue` (`null` for a neutral, such as the stone of the hidden Buy Data Credits card). |
| `pages/public/src/pages/landing/previews/layout.js` | Stage geometry shared by the page and the bake: the hover fan and the keep-out check. |
| `pages/public/src/pages/landing/ToolPreview.jsx`, `landing.css` | Renders the stage, frames, hover fan and both themes, and the page's card grid. |
| `pages/public/src/assets/previews/<slug>/<id>-<light\|dark>.webp` | Baked prints. These are committed and fingerprinted by Vite. |
| `scripts/tool-previews/captures/<slug>/{light,dark}/*.png` + `manifest.json` | Source captures. They are git-ignored, local only. Each `manifest.json` lists every shot with its `cssWidth` x `cssHeight`, which is how the bake derives the dpr. |
| `scripts/tool-previews/capture/<slug>.mjs` | One capture script per tool. It re-shoots that tool's source captures and writes its `manifest.json`. See [Capture](#capture). |
| `scripts/tool-previews/out/` | Screenshots from `shoot.mjs`. Git-ignored. |

## Prerequisites

Install the kit once. From the repo root:

```bash
npm --prefix scripts/tool-previews install      # playwright-core + sharp, pinned
```

Run the frontend in its own terminal, on the port the kit expects. From the repo root:

```bash
npm --prefix pages/public run dev:remote -- --port 5174 --strictPort   # proxied to the production API
```

Every command below runs from `scripts/tool-previews/`. `shoot.mjs` and the capture scripts drive the Chrome installed on your machine (`channel: "chrome"`). Set `BASE` to point them at another server (Vite's default port is 5173, so without `--port` set `BASE=http://localhost:5173`).

**Re-baking needs the source captures.** `captures/` is git-ignored, so a fresh clone has none. The committed prints in `src/assets/previews/` keep working; to change a crop you first regenerate that tool's captures with its script (below). The bake never deletes a committed print whose capture is missing; it reports it and exits 1.

## Capture

```bash
node capture/dc-mint.mjs                       # re-shoot captures/dc-mint/: PNGs + manifest.json
OUT_DIR=$(mktemp -d) node capture/brand.mjs    # write the shots somewhere else
node capture/dc-mint.mjs macros                # only the card's macros (see below)
```

There is one script per tool, for all 15 tools. Each creates its `manifest.json` when there is none, so it runs into an empty `OUT_DIR`. Every script is read-only. It runs through `lib.mjs`'s `run()`, which enforces a hard timeout, and every page gets the side-effect guard. A fake wallet is read-only, so any signing call throws. Post-action states come from local `page.route()` mocks. Light and dark are shot from one page state with `emulateMedia`.

The data is live, so the figures change between runs. After a re-shoot, check the card's crop rects in `previews/<slug>.js` again. Each script writes `manifest.json` itself: the css sizes come from the PNGs, and the `describes` text records the reference capture.

Four scripts finish with a macro pass: `dc-mint`, `hotspot-claimer`, `iot-onboard` and `update-location`. That pass shoots the high-dpr prints the card actually uses. Pass `sources` or `macros` to run one pass only (`hotspot-claimer` also takes `hotspot` or `wallet`). `ve-hnt` has only the macro pass, so it runs with no argument (or `macros`). The macro pass merges its entries into the existing manifest.

| Script | State it captures | Wallet / mock |
|---|---|---|
| `brand` | Static `/brand` page: logo matrix, mark, do/don't, palette, typography, plus a dpr-3 colorway column. | None. |
| `dc-mint` | Mint DC tab with 50 HNT quoted, and the Delegate tab with OUI 1 resolved and 2,000,000 DC set. Macros: the quote panel and the wallet strip at dpr 5. | `nyc`, fake-connected. |
| `dc-purchase` | The form with OUI 2 and $250 resolved (email collapsed, never submitted), then the order-status progress and complete screens. | No wallet. `GET /dc-purchase/orders/<id>` is mocked; no order exists. |
| `hnt-price` | The live SSE ticker frozen on one real frame, the `/current` and `/instant` Try-it JSON, and the endpoint, code and schema cards as transparent crops. | None. An init script freezes EventSource and `Date.now`. |
| `hotspot-claimer` | Wallet-mode rewards table (10 Hotspots) and the richest Hotspot in Hotspot mode. Macros: Pending Rewards (dpr 4), the phone list and the desktop table (dpr 3). | `main`, by URL. The guard blocks the bulk `POST …/wallet/rewards`; the page falls back to per-Hotspot GETs. |
| `hotspot-map` | Wallet lookup, then Add to Map for 2,172 NYC Hotspots: framed hero, pitched perspective, a selected Hotspot, and a dpr-3 hover tooltip. | `nyc`, typed into the lookup (no connect). The pulse is held via `Date.now`. |
| `iot-onboard` | A paired Hotspot: Diagnostics, WiFi scan with Rooftop-Mesh-5G picked, Full Onboard mode, and the location step in Barcelona. Macros: identity bar, WiFi card and mode block (dpr 3). | `single`, fake-connected. `navigator.bluetooth` is mocked (`iot-onboard.ble-mock.mjs`). `POST /iot-onboard/lookup` is mocked. |
| `l1-migration` | A legacy B58 address typed in, the derived Helium/Solana pair, and the "Migration successful!" banner. | `main`, typed (no connect). `POST /l1-migration/migrate` is mocked. |
| `mobile-onboard` | Manage list and detail (location moved one cell north, not submitted), the Token-step name grind, the Location step, and the AP Setup Guide's RadSec and Passpoint blocks. | `nyc`, fake-connected. `POST /mobile-onboard/status` is mocked for the freshly ground key. |
| `multi-gateway` | Gateway `647FDAFFFE02E8A7` after about 10 minutes of live stream, then frozen: the hovered track band, the tooltip and the packet table. Takes about 10 minutes. | None. `Date.now` is pinned and worker broadcasts are dropped. |
| `oui-notifier` | OUI 6 lookup with the 30-day chart hovered, an alternate hero for OUI 12, and the subscribe card with a fake label and webhook (never submitted, no email). | None. |
| `update-location` | (A) A metadata edit on Fancy Shadow Elephant. (B) A new lat/lng typed for Huge Lava Raccoon. (C) The 26-Hotspot list. Macros: the field grid and a map portrait at 390 px (dpr 4). | `mixed` for A, B and the macros; `iotOnly` for C. All fake-connected, never submitted. |
| `council-emissions` | The emissions timeline (five seat lanes) and the "Where it went, by seat" bars at 1024 px, plus the "Emitted to seats" stat tile at dpr 3. Nothing is clicked. | None. The page shows the five HIP-149 council seat wallets from chain; the owner approved them for the card. |
| `ve-hnt` | Macros only: the summary ledger and the two position cards (delegated to MOBILE, undelegated) at 412 px (dpr 3). | `empty`, by URL. |
| `wallet-dashboard` | Three phases (`nyc`, `large`, `main`): viewport and hero, the fleet map, Mobile and timeline cards, and a coverage footprint. Pass phase names to run only those. | By URL: `nyc`, `large`, `main`. `BASE` must serve the Mobile engine deps (see the script header). |

## Bake

```bash
node bake.mjs                 # every tool (same as: node bake.mjs all)
node bake.mjs dc-mint brand   # just these
```

For every print in a tool's config, the bake:

1. crops `captures/<slug>/<theme>/<file>` by the print's rect, given in CSS px of the capture,
2. resizes the crop to `out` px wide (it never upscales),
3. writes `<id>-<theme>.webp` at quality 78, or the print's own `q`,
4. deletes files in that tool's folder that its config no longer names. A print whose capture is missing keeps its committed file.

It prints each file's bytes, the totals per theme, and how large the capture shows on a desktop (340 px) and a phone (358 px) card, or, for a featured card's wide prints, on its 698 px desktop stage (portrait prints a featured stage reuses are reported there too). A source glyph of N px shows at N × that scale; the `px` figure is the baked pixels per displayed pixel (aim for ~2). A featured card's `featured` prints with their own `src` are baked like the portrait ones.

It warns, and exits 1, when:

- a print is over 60 KB,
- either theme's total across all tools is over 500 KB,
- a rect runs past its capture, or a capture is missing,
- a print's `out` is wider than its crop (it is kept at the crop width),
- a capture has no entry in its `manifest.json`, so its dpr is unknown (it is baked at dpr 2),
- a print's top edge comes within 3% of the stage top (into the card text), at rest or in its hover pose with the mouse parallax's largest drift. It measures the tilted, scaled outline over the part on the card only (what bleeds off a side can't reach the text), with the same `layout.js` code the page uses,
- a tone's description ink is under 4.5:1 on either gradient stop,
- a hued tone's ground stops don't measure within 3° of its declared `hue`, or a neutral's (`hue: null`) have chroma of .02 or more,
- two cards that touch differ by less than 30° of `hue`. Every card flows through one grid in `sections.js` order, so the bake walks that order at 3, 2 and 1 columns (side by side, one above the other) and names the pair. It reports the closest pair at each width. A neutral beside a hued card passes (it differs by chroma); two neutrals touching fail.

The tone and palette checks run on every bake, whichever tools it bakes. The bake also lists the cards that get a running head at 3, 2 and 1 columns (see "Page header and grid" in the landing `CLAUDE.md`).

## Shoot

```bash
node shoot.mjs dc-mint                 # light + dark card, 1440 desktop
node shoot.mjs dc-mint hnt-price --both --hover   # + 390 phone, + hover state
node shoot.mjs all --mobile
node shoot.mjs wallet-dashboard --vp=desktop,laptop,tablet,phone   # 1440, 1024, 700, 390
node shoot.mjs page                    # full landing page: light/dark x desktop/phone
node shoot.mjs page --vp=laptop,tablet
```

Output goes to `out/<slug>-<theme>-<viewport>[-hover].png` and `out/page-<theme>-<viewport>.png`. These screenshots are at dpr 2. Downscale them before you review a full page. `--hover` moves the mouse onto the card, so it shows the real `:hover` (the disabled card stays still). Chrome can't capture a full page much taller than 16,000 px, so `page` at 700 px repeats itself; shoot cards at that width instead.

## Adding or refreshing a tool's preview

1. **Captures.** Put the tool's captures in `captures/<slug>/{light,dark}/`, with a `manifest.json` (`{ shots: [{ file: "light/x.png", cssWidth, cssHeight, describes }] }`). Shoot light and dark from the same page state; `emulateMedia` switches the theme between the two shots. `lib.mjs` has `run`/`newPage`/`shoot`, the read-only fake wallet (`fakeWalletScript`), a side-effect guard that aborts any `sendTransaction` RPC and claim, subscribe, migrate or purchase-style requests (a path pattern, so it is a backstop, not a license to click), and `writeManifest`/`mergeManifest`. Use only the wallets in `lib.mjs`'s `WALLETS`; the site owner chose them, so ask before using any other. Follow the capture rules in `pages/public/src/pages/landing/CLAUDE.md`. Put the capture script in `capture/<slug>.mjs` so the shots can be re-run, and take the output directory from `OUT_DIR`.
2. **Compose.** Fill in `prints` in `previews/<slug>.js`.
   - Use 2–3 prints, cropped, scaled, tilted and layered. Nothing may be drawn or recolored.
   - Give each card one anchor: a number, a chart shape or a map swarm, legible at 1×. Anchor text must be at least 14 CSS px on a 358 px phone card.
   - Tell a form-like tool as strips, such as the quote or the address pair, not the whole form.
   - Give each tool its own composition (poster + card, triptych, hero number over sheets, crossing strips) inside the fixed card anatomy.
3. **Check.** Run `node bake.mjs <slug>` and then `node shoot.mjs <slug> --both --hover`. Look at the light, dark, phone and hover shots.
4. **New tool.** Give it a `slug` in `pages/public/src/pages/landing/sections.js`. Add `previews/<slug>.js` with the next tone step of its section, and register it in `previews/index.js`. The bake's palette check then covers every card the new one shifts. Add a `## Landing preview` section to the tool's `CLAUDE.md` naming what the prints show, the capture script, and the state, wallet and mocks it uses; that list is what tells the next change whether it touches the card. The full checklist, including renames and removals, is in `pages/public/src/pages/landing/CLAUDE.md` under "Keeping cards current".

Don't hand-edit `src/assets/previews/`; change the config and re-bake.
