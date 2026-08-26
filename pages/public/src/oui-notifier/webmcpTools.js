import { fetchOuiIndex, fetchBalanceForOui } from "../lib/api.js";

/**
 * WebMCP tools for the OUI Notifier page (its own Vite entry — no
 * router). `showOui` pushes an OUI into the page's lookup input, which
 * auto-fetches and renders; `prefillSubscription` fills the alert form but
 * deliberately does NOT submit — subscribing sends a verification email,
 * so the user clicks Subscribe themselves.
 */
export function makeOuiNotifierTools({ showOui, prefillSubscription }) {
  const OUI_SCHEMA = { type: "integer", minimum: 0, description: "The OUI number." };

  return [
    {
      name: "list-ouis",
      title: "List all OUIs",
      description:
        "Catalog of every OUI (organization) on the Helium IoT network: OUI number, owner, payer, escrow account, and delegate keys.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        return fetchOuiIndex();
      },
    },
    {
      name: "get-oui-balance",
      title: "Get an OUI's escrow balance",
      description:
        "Data Credit escrow balance, burn rates (1-day and 30-day), and estimated days remaining for an OUI. Also shows the lookup (with its balance chart) in the page UI.",
      inputSchema: {
        type: "object",
        properties: { oui: OUI_SCHEMA },
        required: ["oui"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ oui }) {
        showOui(oui);
        return fetchBalanceForOui(oui);
      },
    },
    {
      name: "prefill-alert-subscription",
      title: "Prefill a low-escrow alert subscription",
      description:
        "Fill in the low-escrow alert form (OUI, email, optional label and webhook URL) for the user to review and submit. Does not subscribe by itself — the user must click Subscribe, and email verification follows. Alerts fire at 14, 7, and 1 days of escrow remaining.",
      inputSchema: {
        type: "object",
        properties: {
          oui: OUI_SCHEMA,
          email: {
            type: "string",
            pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
            maxLength: 254,
            description: "Email address to notify.",
          },
          label: { type: "string", maxLength: 100, description: "Optional label for this subscription." },
          webhook_url: {
            type: "string",
            pattern: "^https://",
            maxLength: 500,
            description: "Optional HTTPS webhook to call alongside the email.",
          },
        },
        required: ["oui", "email"],
        additionalProperties: false,
      },
      execute({ oui, email, label, webhook_url }) {
        prefillSubscription({ oui, email, label, webhook_url });
        return "Form filled in. Ask the user to review it and click Subscribe — a verification email will follow.";
      },
    },
  ];
}
