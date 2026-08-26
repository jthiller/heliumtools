import animalHash from "angry-purple-tiger";
import { fetchGatewayPackets } from "../lib/multiGatewayApi.js";

/** Cap packet lists in tool results; the UI streams everything live. */
const PACKETS_DEFAULT = 25;

const MAC_SCHEMA = {
  type: "string",
  pattern: "^[0-9A-Za-z:_-]+$",
  minLength: 6,
  maxLength: 32,
  description: "Gateway MAC from list-gateways.",
};

/**
 * WebMCP tools for /multi-gateway. `getGateways` reads the live SSE-fed
 * gateway list already in page state (shared context — no refetch);
 * `selectMac` is the page's own selection handler, so agent selection
 * drives the inspector card and URL exactly like a click.
 */
export function makeMultiGatewayTools(selectMac, getGateways) {
  const findGateway = (mac) => {
    const gateways = getGateways() || [];
    return gateways.find((g) => g.mac?.toLowerCase() === mac.toLowerCase()) || null;
  };

  return [
    {
      name: "list-gateways",
      title: "List gateways",
      description:
        "List the LoRaWAN gateways on this dashboard with their live status (from the page's stream): MAC, name, connection state, and packet counts. Use a MAC with select-gateway or get-gateway-packets.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        // Gateway rows carry no name in state — the UI derives display
        // names from the public key at render time; do the same here.
        return (getGateways() || []).map((g) => ({
          ...g,
          name: g.public_key ? animalHash(g.public_key) : null,
        }));
      },
    },
    {
      name: "select-gateway",
      title: "Select a gateway",
      description:
        "Open a gateway's inspector card in the UI (RSSI chart, event bar, packet table) — same as the user clicking its row. Use a MAC from list-gateways.",
      inputSchema: {
        type: "object",
        properties: {
          mac: MAC_SCHEMA,
        },
        required: ["mac"],
        additionalProperties: false,
      },
      validate({ mac }) {
        return findGateway(mac) ? null : `no gateway with MAC "${mac}" — call list-gateways for valid MACs`;
      },
      execute({ mac }) {
        const gateway = findGateway(mac);
        selectMac(gateway.mac);
        const name = gateway.public_key ? animalHash(gateway.public_key) : gateway.mac;
        return `Inspecting gateway ${name} (${gateway.mac}).`;
      },
    },
    {
      name: "get-gateway-packets",
      title: "Get gateway packets",
      description:
        `Recent packets for one gateway: timestamps, RSSI/SNR, frequency, frame type, DevAddr. Returns the most recent \`limit\` packets (default ${PACKETS_DEFAULT}) plus a total count.`,
      inputSchema: {
        type: "object",
        properties: {
          mac: MAC_SCHEMA,
          limit: { type: "integer", minimum: 1, maximum: 200, default: PACKETS_DEFAULT },
        },
        required: ["mac"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ mac, limit }) {
        const data = await fetchGatewayPackets(mac);
        const packets = Array.isArray(data) ? data : data?.packets || [];
        // Upstream order isn't guaranteed (the chart pipeline sorts too),
        // so order by timestamp before taking the newest `limit`.
        const sorted = [...packets].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        return { total: sorted.length, packets: sorted.slice(-limit) };
      },
    },
  ];
}
