import { TOOL_CATALOG, catalogEntry } from "./catalog.js";
import { fetchCurrentPrice } from "../lib/hntPriceApi.js";

/**
 * The three tools registered on every page of the site (both the SPA and
 * the standalone oui-notifier entry): discover the site's tools, navigate
 * between tool pages, and read the flagship HNT price snapshot.
 *
 * `navigateSpa(path)` performs an in-app route change and is only used for
 * same-entry SPA paths; cross-entry paths always get a full page load.
 * Pass null (oui-notifier entry) to always use full page loads.
 */
export function makeSiteTools(navigateSpa) {
  return [
    {
      name: "list-helium-tools",
      title: "List Helium Tools",
      description:
        "List every tool page on heliumtools.org: path, what it does, and the WebMCP tools it registers once open. Use open-helium-tool to navigate to one; its tools become available after navigation (a toolchange event fires).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        return {
          site: "heliumtools.org — free, open-source Helium network operator tools; no login",
          currentPath: window.location.pathname,
          tools: TOOL_CATALOG.map(({ path, title, summary, tools }) => ({ path, title, summary, webmcpTools: tools })),
        };
      },
    },
    {
      name: "open-helium-tool",
      title: "Open a Helium tool page",
      description:
        "Navigate this tab to one of the site's tool pages. After navigation the page registers its own WebMCP tools (listed by list-helium-tools) and fires toolchange — re-query the tool list, then use the page's tools.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: TOOL_CATALOG.map((t) => t.path),
            description: "The tool page to open.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute({ path }) {
        const target = catalogEntry(path);
        if (navigateSpa && target.entry === "spa") {
          navigateSpa(path);
        } else {
          window.location.assign(path);
        }
        return `Navigating to ${target.title} (${path}). Its WebMCP tools register once the page loads.`;
      },
    },
    {
      name: "get-hnt-price",
      title: "Get HNT price",
      description:
        "Current HNT price snapshot from the heliumtools.org price API: live market price in USD (Jupiter aggregator) and the on-chain oracle price that HNT-to-Data-Credits minting pays, with timestamps. Cached server-side (~1 min freshness). For a live chain read, open /hnt-price and use get-hnt-price-instant.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        return fetchCurrentPrice();
      },
    },
  ];
}
