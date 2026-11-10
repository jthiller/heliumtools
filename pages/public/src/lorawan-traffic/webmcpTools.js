import animalHash from "angry-purple-tiger";
import { fetchNetworkTraffic, fetchOuiTraffic, TRAFFIC_WINDOWS } from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames } from "../lib/wellKnownOuis.js";
import { PROP, buildOuiRows, writeUrlState } from "./data.js";

/** Hotspots returned per page of one OUI's list. */
const HOTSPOT_PAGE_MAX = 200;
/** Operator rows returned by the summary and by show-lorawan-traffic. */
const OUI_ROW_CAP = 100;

const WINDOW_SCHEMA = {
  type: "string",
  enum: TRAFFIC_WINDOWS,
  default: "30d",
  description: "Time range: the last 1, 7 or 30 full UTC days ending on the data-through day.",
};
const OUI_SCHEMA = { type: "integer", minimum: 0, maximum: 999999999 };

const OUI_NOTE =
  "An OUI is the ID a LoRaWAN network operator registers on Helium: packets from its devices are routed to it and it pays for them in Data Credits. name is the operator's name from Helium's well-known list, or null when it isn't listed.";
const COUNTING_NOTE =
  "Packets are uplinks delivered to an operator's route per Hotspot, as reported by the Helium Packet Router: join requests and copies dropped by multi-buy are not counted, and a device message delivered by several Hotspots counts at each.";

/** The published index, or a readable error when there is no build. */
async function readIndex(signal) {
  const index = await fetchNetworkTraffic({ signal });
  if (!index.published) throw new Error("the utilization API has no published build yet; try again later");
  return index;
}

/** The index's OUIs as rows, named from Helium's well-known list where it loads. */
async function readRows(index, signal) {
  const names = await fetchWellKnownOuiNames({ signal }).catch((err) => {
    if (signal?.aborted) throw err;
    return null;
  });
  return { rows: buildOuiRows(index, names), namesLoaded: names !== null };
}

function coverage(index, win) {
  return {
    dataThrough: index.dataThrough,
    window: win,
    dates: index.windows[win],
    ...(index.missingDays.length ? { missingDays: index.missingDays, note: "Days are missing from the 30-day range, so totals are lower bounds." } : null),
  };
}

/**
 * WebMCP tools for /lorawan-traffic. `showTraffic(filters, { signal })` is the page's
 * own setter: it waits for every layer, applies the filters, frames the map
 * and returns the counts it computed. The two get-* tools are plain reads
 * through the page's client, so a layer the map already loaded is not fetched
 * again.
 */
export function makeLorawanTrafficTools({ showTraffic }) {
  return [
    {
      name: "get-lorawan-traffic-summary",
      title: "Get LoRaWAN traffic by operator",
      description:
        `Network-wide Helium LoRaWAN (IoT) traffic for one time range: Hotspots that delivered packets and packets delivered, in total and per network operator (OUI), busiest first. Every operator that received packets in the last 30 days is listed. ${OUI_NOTE} ${COUNTING_NOTE} Rebuilt once a day.`,
      inputSchema: {
        type: "object",
        properties: { window: WINDOW_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ window: win }, { signal } = {}) {
        const index = await readIndex(signal);
        const { rows, namesLoaded } = await readRows(index, signal);
        const ouis = rows
          .map((r) => ({ oui: r.oui, name: r.name, hotspots: r.hotspots[win], packets: r.packets[win] }))
          .sort((a, b) => b.packets - a.packets || a.oui - b.oui);
        return {
          ...coverage(index, win),
          network: { hotspots: index.totals.hotspots[win], packets: index.totals.packets[win] },
          ouiCount: ouis.length,
          ouis: ouis.slice(0, OUI_ROW_CAP),
          ...(ouis.length > OUI_ROW_CAP ? { truncated: `showing ${OUI_ROW_CAP} of ${ouis.length} operators` } : null),
          ...(namesLoaded ? null : { namesNote: "The well-known operator name list didn't load, so every name is null." }),
        };
      },
    },
    {
      name: "show-lorawan-traffic",
      title: "Show LoRaWAN traffic on the map",
      description:
        "Set the map's filters and frame the result: which operators (by OUI) are shown, the time range, and the packet range a Hotspot must fall in. Every call sets all of them; an omitted field goes back to its default (every operator, 30d, any number of packets). Returns what the map then shows: unique located Hotspots, their packets, and per-operator counts. Waits for the map's layers to finish loading first. A Hotspot with no asserted location is counted network-wide but has no dot, so it is not in the shown counts.",
      inputSchema: {
        type: "object",
        properties: {
          ouis: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: OUI_SCHEMA,
            description: "OUIs of the operators to show; every other operator is hidden. Omit for every operator.",
          },
          window: WINDOW_SCHEMA,
          min_packets: { type: "integer", minimum: 1, default: 1, description: "Show Hotspots that delivered at least this many packets to an operator in the time range." },
          max_packets: { type: "integer", minimum: 1, description: "Show Hotspots that delivered at most this many. Omit for no upper limit." },
        },
        additionalProperties: false,
      },
      validate({ min_packets: min, max_packets: max }) {
        return max != null && max < min ? "max_packets must be at least min_packets" : null;
      },
      async execute({ ouis, window: win, min_packets: minPackets, max_packets: maxPackets }, { signal } = {}) {
        const { index, rows, enabled, range, counts, failed } = await showTraffic(
          { ouis: ouis ? [...new Set(ouis)] : null, window: win, minPackets, maxPackets },
          { signal },
        );
        const query = writeUrlState({ win, enabled, allOuis: rows.map((r) => r.oui), range });
        const on = rows.filter((r) => enabled.has(r.oui));
        return {
          ...coverage(index, win),
          packetRange: { min: range.lo, max: range.open ? null : range.hi },
          operatorsShown: on.length,
          operatorsTotal: rows.length,
          hotspotsShown: counts.unique,
          packetsShown: counts.packets,
          network: { hotspots: index.totals.hotspots[win], packets: index.totals.packets[win] },
          ouis: on.slice(0, OUI_ROW_CAP).map((r) => ({
            oui: r.oui,
            name: r.name,
            hotspotsShown: counts.perOui.get(r.oui)?.pass ?? 0,
            hotspotsInWindow: r.hotspots[win],
            packetsShown: counts.perOui.get(r.oui)?.passPackets ?? 0,
          })),
          ...(on.length > OUI_ROW_CAP ? { truncated: `showing ${OUI_ROW_CAP} of ${on.length} operators` } : null),
          ...(failed.length ? { missingOperators: failed, note: "These operators' Hotspots failed to load; they are missing from the map and the counts." } : null),
          url: `/lorawan-traffic${query ? `?${query}` : ""}`,
        };
      },
    },
    {
      name: "get-operator-hotspots",
      title: "List the Hotspots delivering for an operator",
      description:
        `The located Hotspots that delivered packets to one LoRaWAN network operator (by OUI) in a time range, busiest first: Hotspot key (address), name, coordinates of its asserted location, and packets delivered. Paged: use offset/limit and pagination.nextOffset. hotspotsInWindow also counts Hotspots with no asserted location, which this list cannot include. ${OUI_NOTE} ${COUNTING_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          oui: { ...OUI_SCHEMA, description: "The operator's OUI number (get-lorawan-traffic-summary lists them)." },
          window: WINDOW_SCHEMA,
          offset: { type: "integer", minimum: 0, default: 0, description: "Start at this offset; use pagination.nextOffset for the next page." },
          limit: { type: "integer", minimum: 1, maximum: HOTSPOT_PAGE_MAX, default: 50, description: "Maximum Hotspots on this page." },
        },
        required: ["oui"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ oui, window: win, offset, limit }, { signal } = {}) {
        const index = await readIndex(signal);
        const listed = index.ouis.find((o) => o.oui === oui);
        if (!listed) {
          throw new Error(`no operator with OUI ${oui} received packets in the 30 days to ${index.dataThrough}; get-lorawan-traffic-summary lists the ones that did`);
        }
        const [{ rows }, points] = await Promise.all([
          readRows(index, signal),
          index.files.ouis.includes(oui) ? fetchOuiTraffic(oui, index.files.oui, index.version, { signal }) : [],
        ]);
        const key = PROP[win];
        const active = points
          .filter((p) => p[key] > 0)
          .sort((a, b) => b[key] - a[key] || (a.address < b.address ? -1 : 1));
        const page = active.slice(offset, offset + limit);
        return {
          ...coverage(index, win),
          oui,
          name: rows.find((r) => r.oui === oui)?.name ?? null,
          hotspotsInWindow: listed.hotspots[win],
          packetsInWindow: listed.packets[win],
          hotspots: page.map((p) => ({ address: p.address, name: animalHash(p.address), lat: p.lat, lng: p.lng, packets: p[key] })),
          pagination: {
            offset,
            limit,
            total: active.length,
            returned: page.length,
            nextOffset: offset + page.length < active.length ? offset + page.length : null,
          },
        };
      },
    },
  ];
}
