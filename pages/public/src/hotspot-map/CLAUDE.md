# Hotspot Map

Interactive map tool for visualizing Helium Hotspot locations. Users paste entity keys or search by wallet address to plot Hotspots on a deck.gl/MapLibre map.

## Files

- `HotspotMap.jsx` — Single-file React component (all UI, state, map layers)
- `../lib/hotspotMapApi.js` — API client (`resolveLocations`, `fetchWalletHotspots`, `fetchOnboardDates`)
- `../lib/h3.js` — H3 cell index → lat/lng conversion

## Data Model

The API returns **one entry per network** (a Hotspot on both IoT and Mobile comes back as two items with the same `entityKey` but different `network`). The frontend merges these into a single object:

```
API shape:      { entityKey, network: "iot", elevation, gain, ... }
Merged shape:   { entityKey, networks: ["iot", "mobile"], networkDetails: { iot: {...}, mobile: {...} }, ... }
```

- `mergeByEntityKey()` performs this merge. Called in both `resolveKeys` and `handleLookupWallet`.
- `hotspotId()` returns `entityKey` (unique after merge).
- Stats count a dual-network Hotspot as 1 total, but increment both IoT and Mobile counters.
- Network filter uses `networks.includes()` so a dual-network Hotspot appears in both IoT-only and Mobile-only views.

## Key Concepts

- **Entity key**: Base58 on-chain identifier for a Hotspot (20–500 chars)
- **H3 location**: On-chain location stored as decimal u64 H3 cell index, converted to lat/lng via `h3-js`
- **Coverage sectors**: WiFi outdoor Hotspots (`deviceType: "wifiOutdoor"`) render a 120° fan polygon at their azimuth
- **Pulse animation**: Selected Hotspot gets a ~30fps expanding ring. The pulse layer is kept separate from static layers to avoid rebuilding deck.gl layers every frame.
- **Onboard dates**: the detail card's per-network "Onboarded" date is fetched lazily per selected Hotspot from `GET /onboarded` — the block time of the first successful transaction on that network's info account (`hotspotInfoCreatedAt` in `worker/src/lib/helium-solana.js`, shared with the Wallet Dashboard). **Never use the Entity API's `created_at`** — an indexer re-index time, which the map read directly until Oct 2026. Hotspots from before the April 2023 move to Solana show their migration date, which the date's `<Tooltip>` says (it shows on tap and focus too, unlike a native title). The fetch is a session cache with in-flight sharing (`dedupeAsync`), since the card mounts twice per selection (sidebar + mobile sheet).

## Layout

- **Desktop**: Floating sidebar (380px) over full-screen map
- **Mobile** (< 768px): Bottom sheet with drag handle, collapsible
- Both share the same panel content (detail card, input form, results list)

## Flows

1. **Entity key input**: Paste keys → `resolveKeys()` → chunks of 500 → `POST /resolve` → merge → add to map
2. **Wallet search**: Address → `GET /wallet` → merge → preview with checkboxes → user selects → `resolveKeys()` for chosen keys
3. **Map interaction**: Click dot → `selectedHotspot` (entityKey) → `selectedGroup` finds all at same H3 location → `DetailCard` renders

## Worker Endpoints

- `POST /hotspot-map/resolve` — Accepts `{ entityKeys: string[] }`, returns `{ hotspots: [...] }` with on-chain metadata
- `GET /hotspot-map/wallet?address=...` — Returns all Hotspot entity keys + names for a Solana wallet
- `GET /hotspot-map/onboarded?entityKey=...&networks=iot,mobile` — Returns `{ entityKey, onboarded: { [network]: iso | null }, cached }` for one Hotspot (`networks` defaults to both; a network it isn't on reads null). The worker derives the info-account PDAs from the entity key (lib `hotspotInfoAccounts`, as `/resolve` does with `hotspotInfoKey`) — it never takes addresses from the client. Dates come through lib `onboardedAtFor`: its per-info-account cache (`onb:<address>`, shared with the Wallet Dashboard), then a batched existence check and one RPC call per uncached existing account; a fully cached lookup spends no rate-limit token (`rl:hm:onb`, 30/min)

## WebMCP

The page registers agent tools `map-wallet-hotspots` (plots everything a wallet owns — skips the manual preview step) and `map-hotspots` (plot explicit entity keys) from `webmcpTools.js`, both reusing `resolveKeys`, plus `get-hotspot-onboard-dates` (one Hotspot's per-network onboard dates through `fetchOnboardDates`, the detail card's client and session cache; for a whole wallet, `/wallet-dashboard`'s `get-wallet-onboarding`). Framework: `pages/public/src/webmcp/CLAUDE.md`.
