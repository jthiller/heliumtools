import { fetchHntPrice, resolveOui, resolvePayerKey } from "../lib/dcMintApi.js";
import { BASE58_PATTERN } from "../webmcp/webmcp.js";

const AMOUNT = { type: "number", exclusiveMinimum: 0 };

/**
 * WebMCP tools for /dc-mint. Quoting and OUI resolution are open reads;
 * the burn itself requires the user to sign with their connected Solana
 * wallet in the UI, so no mint tool is exposed — the agent quotes, the
 * human signs.
 */
export const dcMintTools = [
  {
    name: "get-dc-mint-quote",
    title: "Quote HNT ↔ Data Credits",
    description:
      "Convert between HNT, Data Credits, and USD at the on-chain oracle price the DC mint actually pays (conservative ema − 2×conf, not the headline spot). Pass exactly one of hnt_amount, dc_amount, or usd_amount; returns all three plus the price used. 1 DC is always $0.00001 (100,000 DC per USD); the HNT side floats.",
    inputSchema: {
      type: "object",
      properties: {
        hnt_amount: { ...AMOUNT, description: "Amount of HNT to burn." },
        dc_amount: { ...AMOUNT, description: "Amount of Data Credits wanted." },
        usd_amount: { ...AMOUNT, description: "USD value of Data Credits wanted." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    validate(input) {
      const given = ["hnt_amount", "dc_amount", "usd_amount"].filter((k) => input[k] !== undefined);
      if (given.length !== 1) {
        return `pass exactly one of hnt_amount, dc_amount, usd_amount (got ${given.length ? given.join(", ") : "none"})`;
      }
      return null;
    },
    async execute({ hnt_amount, dc_amount, usd_amount }) {
      const price = await fetchHntPrice();
      const { dc_per_hnt, dc_per_usd } = price;
      let dc;
      if (hnt_amount !== undefined) dc = hnt_amount * dc_per_hnt;
      else if (dc_amount !== undefined) dc = dc_amount;
      else dc = usd_amount * dc_per_usd;
      return {
        hnt: dc / dc_per_hnt,
        dc: Math.round(dc),
        usd: dc / dc_per_usd,
        price,
        note: "Minting burns HNT and needs the user's Solana wallet signature in the /dc-mint UI.",
      };
    },
  },
  {
    name: "resolve-oui",
    title: "Resolve an OUI or payer key",
    description:
      "Resolve a Data Credit delegation target — an OUI number or a payer key — to its escrow account, payer, and current escrow DC balance. Use before delegating DC to an OUI.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "An OUI number (e.g. \"12\") or a payer key (base58).",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async execute({ target }) {
      const trimmed = target.trim();
      const result = /^\d+$/.test(trimmed)
        ? await resolveOui(Number(trimmed))
        : new RegExp(BASE58_PATTERN).test(trimmed)
          ? await resolvePayerKey(trimmed)
          : null;
      if (!result) {
        return { content: [{ type: "text", text: `No OUI or payer found for "${trimmed}".` }], isError: true };
      }
      return result;
    },
  },
];
