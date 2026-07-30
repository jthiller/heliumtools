/**
 * Hand-off targets for the agent brief.
 *
 * The prompt is deliberately tiny — everything the agent needs lives at the
 * brief URL — so it fits comfortably in a query string and there is no
 * length-limit problem to design around.
 */

export function buildPrompt(briefUrl, hotspotName) {
  const who = hotspotName ? ` (${hotspotName})` : "";
  return [
    `I need help configuring my WiFi access point as a Helium Mobile Hotspot${who}.`,
    `Read and follow the setup brief here: ${briefUrl}`,
    `Follow its staged process and wait for my approval before changing anything.`,
  ].join("\n");
}

/**
 * Chat surfaces that accept a prefilled prompt. These open a plain chat, which
 * can guide the operator but cannot reach their controller on its own unless
 * the user has browser control or a terminal agent — the UI says so rather than
 * implying hands-off automation.
 */
export function buildDeepLinks(briefUrl, hotspotName) {
  const q = encodeURIComponent(buildPrompt(briefUrl, hotspotName));
  return [
    { key: "claude", label: "Open in Claude", url: `https://claude.ai/new?q=${q}` },
    { key: "chatgpt", label: "Open in ChatGPT", url: `https://chatgpt.com/?q=${q}` },
  ];
}

/**
 * One-liner for terminal agents (Claude Code, Codex CLI). This is the path that
 * actually reaches an agent able to call a controller API or SSH.
 */
export function buildCliCommand(briefUrl, hotspotName) {
  const text = buildPrompt(briefUrl, hotspotName).replace(/\n/g, " ");
  // Single quotes, so $, backticks and backslashes stay literal rather than
  // being expanded by the shell. The only escape a POSIX single-quoted string
  // needs is for the quote character itself.
  return `claude '${text.replace(/'/g, `'\\''`)}'`;
}
