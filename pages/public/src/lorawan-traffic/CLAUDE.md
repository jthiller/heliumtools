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

- `LorawanTrafficMap.jsx`: the page. State (time range, packet range, operators shown, clicked spot, camera), the deck.gl layers, click and hover handling, URL sync, the desktop sidebar and the phone sheet.
- `panels.jsx`: presentational pieces. `FiltersPanel` (the title, and under it the time range, the packet range as a two-handle log slider with exact bounds, and the shown totals; it folds to a two-line summary), `OperatorPicker`, `AboutData`, `LocationCard` / `LocationRows`, `MapTooltip`.
- `useTraffic.js`: loads everything (below) and exposes `{ status, index, rows, layers, loaded, total, hotspotIds, failed, namesLoaded, reload }`.
- `data.js`: the pure view model, with no DOM, fetch, React or map library, so it runs under `npm test`: operator rows and palette, range math, dot radius, shown counts, click hit-testing, URL state, date formatting.
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

- One `ScatterplotLayer` per operator (`oui-<n>`), largest layer first so small operators draw on top. Color by rank from a 20-color golden-angle palette, cycled past 20 (`PALETTE` in `data.js`, carried over from the val).
- Radius in pixels from `radiusFor` (2.5 px at 1 packet to 11 px at a million, linear on log10).
- Filtering never rebuilds a layer's data. A point outside the packet range, or with no packets in the window, gets radius 0 and line width 0, so it draws nothing and can't be picked; `updateTriggers` on those two accessors is all that changes when the window or range moves. Toggling an operator flips `visible`. (deck's `DataFilterExtension` would do this on the GPU, but `@deck.gl/extensions` is not a dependency.)
- The range drawn and counted is `useDeferredValue` of the slider's, so dragging stays smooth.
- An open upper handle means no upper bound, not "<= max": around a nightly publish a file can hold a count above the index's `maxPackets`.
- Hover uses deck picking (top dot only) for the tooltip and the pointer cursor.
- Click does **not** use deck picking. `hitsNear` lists every shown dot whose circle comes within 6 px of the click (a lng/lat prefilter, then an exact pixel test with each dot's radius), and `groupHits` folds them into one row per Hotspot with its packets per operator. The card title says "at this location" when every row shares one coordinate and "near this point" otherwise. The list shows 60 rows and counts the rest.
- Each listed Hotspot links to World Explorer and to `/hotspot-map?keys=<key>` for its on-chain details. Names come from `angry-purple-tiger`, the same hash World Explorer uses.
- The page frames the data once when the last layer lands, unless the user already moved the map; "Fit map" frames the operators that are on. `fitTo` pads for the sidebar (desktop) or the sheet (phones).

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

The `/` card (`pages/public/src/pages/landing/previews/lorawan-traffic.js`, the last card of Hotspot Operators, jade step 2) is two prints from this page: the anchor is the Europe swarm, every operator's dots over the labelled basemap with the sidebar cropped out (`map-europe.png`); laid over its top is a dpr-3 macro of three operator rows from `OperatorPicker` (switch, color dot, name or OUI number, shown / all Hotspots, packets; `operators.png`), whose dots are the map's legend. `scripts/tool-previews/capture/lorawan-traffic.mjs` loads `/lorawan-traffic` with no wallet and no mocks, waits for every operator's file, sets the camera through deck's own `onViewStateChange`, and clicks and hovers nothing, so no single Hotspot's name or key is in a shot; operator names are the ones published in Helium's well-known list. Figures are live and change daily. Re-capture and re-bake when a change touches the dot layers' look (palette, radius, stroke, opacity), the basemap style, the operator row (`OperatorRow`: checkbox, swatch, name and OUI lines, counts), or anything the script finds: the "LoRaWAN traffic by operator" heading, the "Showing N of N operators" line, the "Loading operators" text, the row labels with their checkboxes, the `deckgl-overlay` canvas. See `pages/public/src/pages/landing/CLAUDE.md`.

It sits in Hotspot Operators rather than Network Operators because of the palette: any third Network Operators card touches both the teal and the cyan card at some width, and no hue keeps 30° from both inside that section's arc.

## Gotchas

- In dev, the console shows `Cannot read properties of undefined (reading 'maxTextureDimension2D')` from deck.gl's canvas resize observer. `/hotspot-map` shows the same error; it does not come from this page's code and the map renders normally.
- The per-operator arrays from `fetchOuiTraffic` are shared (cache, page, tools). Never sort or mutate them in place; copy first (`get-operator-hotspots` filters before it sorts).
