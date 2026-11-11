# LoRaWAN Traffic Map

Network-wide map of Helium LoRaWAN (IoT) traffic at `/lorawan-traffic`: every Hotspot that delivered packets in the last 1, 7 or 30 full UTC days, one dot per Hotspot per operator, colored by the network operator (OUI) that received them and sized by how many it delivered. Frontend-only: no worker endpoint, no wallet, no `SolanaProvider`.

Ported in November 2026 from the owner's Val Town val `helium-network-gateway-map-redacted` (vanilla TS + MapLibre circle layers) onto the site's stack. What changed in the port: React + deck.gl over MapLibre (as Hotspot Map and the Wallet Dashboard's fleet map), the site's tokens and dark mode, operator names from Helium's well-known list (the val showed numbers only), filters in the URL, WebMCP tools, and a phone layout. The val's box/lasso ID export was switched off in that build and is not ported.

## Language (owner's rule)

Most people don't know what an OUI is, so the page leads with **operator** and never hides the OUI:

- The tool is "LoRaWAN Traffic Map"; the panel title is "LoRaWAN traffic by operator".
- A named operator reads name first with its number after it ("LoneStar Tracking", "OUI 12"); an operator Helium's well-known list has no name for reads "OUI 691". The number is never dropped: two OUIs can carry one name (LoneStar Tracking is 12 and 492). `ouiLabel()` in `data.js` and `OperatorName` in `panels.jsx` are the two renderings.
- What an OUI is gets one sentence, `OUI_HELP` in `panels.jsx`: the "What's an OUI?" hint above the operator list and the first note under "About this data". Keep it to that one definition.
- The API says "gateways"; this site says Hotspots. Counts are "packets" here (the Wallet Dashboard calls the same per-Hotspot counts "messages").
- No em dashes in copy; date ranges read "Oct 11 to Nov 9".

## Files

- `LorawanTrafficMap.jsx`: the page. State (time range, packet range, operators shown, clicked spot), the scene and dot sizes it hands the map, click handling, URL sync, the desktop sidebar and the phone sheet.
- `MapCanvas.jsx`: the map itself (basemap, the dot layer, the selection ring, the hover tooltip). It owns the camera and the hover, and exposes `fitBounds` through its ref. See "Rendering cost" below before changing it.
- `panels.jsx`: presentational pieces. `FiltersPanel` (the title, and under it the time range, the packet range as a two-handle log slider with exact bounds, and the shown totals; it folds to a two-line summary), `OperatorPicker`, `AboutData`, `LocationCard` / `LocationRows`, `MapTooltip`.
- `useTraffic.js`: loads everything (below) and exposes `{ status, index, rows, layers, loaded, total, hotspotIds, failed, namesLoaded, reload }`.
- `data.js`: the pure view model, with no DOM, fetch, React or map library, so it runs under `npm test`: operator rows and palette, range math, dot radius, shown counts, the drawn scene and its dot sizes, hover and click hit-testing, URL state, date formatting.
- `webmcpTools.js`: the page's agent tools.
- `lorawan-traffic.css`: only the two-handle slider (thumb pseudo-elements can't be styled from Tailwind classes).
- `../lib/iotStatusApi.js`: the api-iot client. This page's reads are `fetchNetworkTraffic`, `fetchOuiTraffic`, `ouiTrafficUrl`, `normalizeTrafficPoints` at the end of the file.
- `../lib/wellKnownOuis.js`: operator names (`fetchWellKnownOuiNames`, `labelOuis`), shared with the Wallet Dashboard.
- Tests: `data.test.js`, `webmcpTools.test.js`.

## Data

Everything is fetched **directly from the browser**; both sources are keyless and CORS-open.

- `GET https://api-iot.heliumtools.org/v1/iot/utilization`: the index. `dataThrough`, the build `version`, each window's dates, network totals, `maxPackets` per window (the top of the packet slider), one row per OUI with Hotspots and packets per window, and `files.oui` / `files.ouis` (the per-OUI file template and which OUIs have one). Read with `cache: "no-cache"`: the edge can hand the browser a max-age of hours, and a stale index beside fresh files would describe another day. The Wallet Dashboard's `fetchUtilizationIndex` reads the same URL for completeness only and keeps the browser's copy; they are separate functions on purpose.
- `GET {origin}/v1/iot/utilization/oui/{oui}.geojson?v={version}`: one FeatureCollection per OUI, a point per located Hotspot with `address`, `packets1d`, `packets7d`, `packets30d`. 404 means the OUI has no located Hotspots. The API ignores `?v=`; it gives each build its own URL so the browser cache can never pair an old file with a new index. `ouiTrafficUrl` refuses a template that resolves off the API's origin.
- `https://raw.githubusercontent.com/helium/well-known/.../lists/ouis.json`: operator names. If it fails the map still works and every operator reads by number; the notes say so.

Size (Nov 2026): 56 OUIs, about 156,000 points for about 75,000 Hotspots, roughly 32 MB of JSON once decompressed (the largest file is about 8.6 MB, 1.5 MB on the wire). Rebuilt once a day after the previous UTC day completes.

Loading (`useTraffic.js`): index and names together, then the files eight at a time, busiest operator first, each landing in `layers` as it arrives so the map fills in. A file that fails is retried once, then listed in `failed` and left empty with a Reload link; only a failed index is an error screen (404 reads as "no published build yet"). `fetchOuiTraffic` keeps results for the session, keyed by build, so the WebMCP tools and a remount reuse them.

Semantics, which the notes and tool descriptions must keep saying:

- Packets are uplinks delivered to an operator's route per Hotspot, as the Helium Packet Router reports them. Join requests and copies dropped by multi-buy are not counted; a device message delivered by several Hotspots counts at each.
- Windows are full UTC calendar days ending on `dataThrough`.
- Dots sit at the on-chain asserted location. A Hotspot without one is in the index's totals but has no point. That is the gap in each operator row's "shown / all" at full range, and why "Hotspots shown" is under the network-wide figure.
- "Hotspots shown" counts a Hotspot once even when it delivered for several operators (`countShown` in `data.js`, a typed-array epoch check over small integer ids from `assignHotspotIds`, not a Set of 51-character keys on every slider move).

## Map

- One `ScatterplotLayer` (`hotspots`) draws every operator in a single call from flat arrays, the "scene" (`buildScene` in `data.js`): positions, colors, the point objects and each dot's operator, operator by operator with the largest first so small operators draw on top. Color by rank from a 20-color golden-angle palette, cycled past 20 (`PALETTE` in `data.js`, carried over from the val).
- Radius in pixels from `radiusFor` (2.5 px at 1 packet to 11 px at a million, linear on log10).
- Filtering never rebuilds the scene. `sceneSizes` gives each dot a radius and an outline width, both 0 for a dot the filters hide (operator switched off, no packets in the window, outside the packet range), so it draws nothing and can't be hit. Those two arrays are all that is rebuilt and uploaded when a filter moves. (deck's `DataFilterExtension` would do this on the GPU, but `@deck.gl/extensions` is not a dependency.)
- The range drawn and counted is `useDeferredValue` of the slider's, so dragging stays smooth.
- An open upper handle means no upper bound, not "<= max": around a nightly publish a file can hold a count above the index's `maxPackets`.
- Neither hover nor click uses deck picking; no layer is `pickable`. Both are the page's own hit test over the scene's arrays: a lng/lat prefilter, then an exact pixel test with each dot's drawn radius. What is drawn and what can be hit come from the same arrays, so they can't drift apart.
- Hover (`topDotAt`, in `MapCanvas.jsx`) names the dot drawn on top under the pointer, for the tooltip and the pointer cursor. deck still calls `onHover` once per frame while the pointer moves, with the position and viewport and nothing picked; the hit test runs there. It runs again when the dots change under a resting pointer (a filter moved, more operators loaded), so the tooltip never names a dot that is gone.
- Click (`hitsNear`) lists every shown dot whose circle comes within 6 px of the click, and `groupHits` folds them into one row per Hotspot with its packets per operator. The card title says "at this location" when every row shares one coordinate and "near this point" otherwise. The list shows 60 rows and counts the rest.
- The clicked spot keeps the dots that were under the click and lists only the ones the current filters still show (`shownHits`): change the window, the range or the operators and the rows, the count and the title follow, with no zero-packet rows and no switched-off operators. With none left there is no card and no ring; restoring the filters brings them back. A reload clears the clicked spot, since it replaces every point.
- The desktop card's container is a flex column with a definite height, and the card is its flex item, so a long list scrolls inside the card. Don't wrap the card in an auto-height element: its `max-h-full` then has nothing to resolve against and the rows run off the map.
- Each listed Hotspot links to World Explorer and to `/hotspot-map?keys=<key>` for its on-chain details. Names come from `angry-purple-tiger`, the same hash World Explorer uses.
- The page frames the data once when the last layer lands, unless the user already moved the map; "Fit map" frames the operators that are on. `fitTo` hands the bounds to `MapCanvas`'s `fitBounds`, which pads for the sidebar (desktop) or the sheet (phones).

### Rendering cost

The whole network in view (world zoom, about 156,000 dots) is the expensive case, and four things keep it smooth. Measured in dev on an M4 at 2x pixel density, before and after (November 2026): a panned frame at world zoom went from 24 ms (p50) and 95 ms (p90) to 8.3 and 9.1, the same as with every dot switched off. The picture is the same: a pixel diff of the capture against the old renderer differs by a mean of 0.04 of 255 levels, on dot edges only.

- **No multisampling on the deck canvas** (`DEVICE_PROPS` in `MapCanvas.jsx`: `antialias: false`). The dots smooth their own edges in the fragment shader, so MSAA drew the same picture at several times the fill cost: a world-zoom draw, flushed to the GPU, took 31 ms with it and 9 ms without. `preserveDrawingBuffer: false` (luma.gl defaults it to true) lets the browser swap the buffer instead of copying it; nothing reads the canvas back.
- **One layer, not one per operator.** Fifty-six layers cost about 4.6 ms of deck bookkeeping per redraw on the main thread; one costs 0.7 ms.
- **No GPU picking.** A deck picking pass over the dots is a second render and a synchronous readback, about 7 ms per pointer move. The page's hit test is a loop over typed arrays, under 1 ms. Don't make the dot layer `pickable`.
- **The camera and the hover stay out of the page's state.** `MapCanvas` owns the view state, so a pan or zoom frame re-renders the map and not the sidebar (a commit went from 6.9 ms to 2.7 ms); the tooltip is its own component with its own state (`HoverTip`), so moving from dot to dot renders only it. Don't lift either into `LorawanTrafficMap`, and keep `MapCanvas`'s props stable between filter changes (it is `memo`'d).

What is left at world zoom is the blended fill itself. Shrinking dots at low zoom, clustering or rendering at a lower resolution while moving would cut it further, but each changes the picture, which the owner ruled out.

## URL state

`?window=7d&ouis=12,492&min=100&max=5000`, all optional (defaults: 30d, every operator, any number of packets; `ouis=none` for none). `readUrlState` seeds the page once on load; `writeUrlState` writes back with `navigate(..., { replace: true })`, debounced 400 ms because browsers throttle history updates during a slider drag. The stored range is kept as typed and fitted to each window's maximum by `clampRange`, so switching 30d to 1d and back restores it.

## Layout

- Desktop: a floating sidebar on the left (filters and totals, then the operator picker with the notes), a clicked spot's card on the right, zoom control bottom right.
- The filters card folds ("Hide filters" / "Show filters" beside the title, owner's request): once the filters are set, the operator list is where people work, and folding hands it the card's height (5 rows to 12 at 1440x900). Folded, the card keeps the title and two lines: the filters in words ("7d, Nov 3 to Nov 9. At least 1,000 packets.") and the shown totals, which still change as operators are switched. It starts open on every load and the state is not saved; the phone sheet shares it.
- Phones (< 768px): one bottom sheet. Collapsed it shows the shown count; expanded, the filters and picker; with a spot clicked, that spot's Hotspots with a "Filters" back button.
- The operator list's scroller is absolutely positioned inside a box that has a floor (three rows on desktop, a fixed 256px in the sheet), so the rows never add to the picker's own height. The picker card has no `overflow-hidden` and no fixed minimum: its minimum is the picker plus the notes, so opening "About this data" in a short window makes the card taller and the sidebar scroll. Don't put `min-h-0` or `overflow-hidden` back on the card or the picker: the notes then take the list's height, the list collapses, and the buttons spill over the notes.
- Boxes use `shadow-soft`, not borders (root rule).

## WebMCP

Three tools from `webmcpTools.js` (`makeLorawanTrafficTools({ showTraffic })`), listed in `webmcp/catalog.js`:

- `get-lorawan-traffic-summary` (read-only): network totals and every operator's Hotspots and packets for a window, busiest first, with well-known names (`name: null` when unlisted).
- `show-lorawan-traffic`: sets the page's filters in one call (operators by OUI, window, packet range; an omitted field goes back to its default), frames the map, and returns what it then shows. It goes through the page's `showTraffic`, which waits for every layer (`abortableDelay` polling, so cancelling ends only the wait) and computes the counts with the same `countShown`. An unknown OUI or an inverted range is an error, not a silent no-op.
- `get-operator-hotspots` (read-only): one operator's located Hotspots for a window, busiest first, paged (`offset`/`limit`, at most 200, `pagination.nextOffset`).

The two reads use the page's client and caches, so nothing the map already loaded is fetched again. The clicked-spot list, the hover tooltip and the folded state of the filters card are UI-only. Framework: `pages/public/src/webmcp/CLAUDE.md`.

## Landing preview

The `/` card (`pages/public/src/pages/landing/previews/lorawan-traffic.js`, the last card of Hotspot Operators, jade step 2) is two prints from this page: the anchor is the Europe swarm, every operator's dots over the labelled basemap with the sidebar cropped out (`map-europe.png`); laid over its top is a dpr-3 macro of three operator rows from `OperatorPicker` (switch, color dot, name or OUI number, shown / all Hotspots, packets; `operators.png`), whose dots are the map's legend. `scripts/tool-previews/capture/lorawan-traffic.mjs` loads `/lorawan-traffic` with no wallet and no mocks, waits for every operator's file, sets the camera through deck's own `onViewStateChange`, and clicks and hovers nothing, so no single Hotspot's name or key is in a shot; operator names are the ones published in Helium's well-known list. Figures are live and change daily. Re-capture and re-bake when a change touches the dots' look (palette, radius, stroke, opacity), the basemap style, the operator row (`OperatorRow`: checkbox, swatch, name and OUI lines, counts), or anything the script finds: the "LoRaWAN traffic by operator" heading, the "Showing N of N operators" line, the "Loading operators" text, the row labels with their checkboxes, the `deckgl-overlay` canvas (the script reaches the deck instance and its `onViewStateChange` through that canvas's React fiber). A change to how the dots are drawn that leaves the picture the same needs no re-bake: run the capture against production and against the branch (`BASE=`, `OUT_DIR=`) and diff the two. See `pages/public/src/pages/landing/CLAUDE.md`.

It sits in Hotspot Operators rather than Network Operators because of the palette: any third Network Operators card touches both the teal and the cyan card at some width, and no hue keeps 30° from both inside that section's arc.

## Gotchas

- In dev, the console shows `Cannot read properties of undefined (reading 'maxTextureDimension2D')` from deck.gl's canvas resize observer. `/hotspot-map` shows the same error; it does not come from this page's code and the map renders normally.
- deck.gl skips a binary attribute whose descriptor object (`{ value, size }`) is the one it already holds. `MapCanvas` keeps the position and color descriptors stable per scene so a filter move uploads only the sizes; for the same reason, never mutate a typed array in place and expect the map to change. Build a new array (as `sceneSizes` does).
- Positions are a `Float64Array`. deck splits it into high and low parts, so dots stay put at street zoom; a `Float32Array` would drift them by up to a metre.
- The benchmark numbers above came from the Browser pane while it was hidden, which throttles an idle page to one frame a second: a stray 1,000 ms frame at the start or end of a run is that, not the page.
- The per-operator arrays from `fetchOuiTraffic` are shared (cache, page, tools). Never sort or mutate them in place; copy first (`get-operator-hotspots` filters before it sorts).
