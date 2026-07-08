import { jsonResponse } from "../../../lib/response.js";
import { COUNCIL_GUILD_ID, COUNCIL_CHANNEL_ID } from "../config.js";

const UA = "DiscordBot (https://heliumtools.org, 1.0)";

async function probe(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON
    }
    return { status: res.status, body };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/**
 * GET /council/diag — admin-gated, read-only setup diagnostic. Asks Discord which
 * guilds the bot is in and whether it can see the target channel, so a poll 403 can
 * be pinned to the exact cause (wrong server vs channel View permission). Returns
 * only guild/channel names + ids + status codes — no secrets.
 */
export async function handleDiag(request, env) {
  const token = env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN;
  if (!token) return jsonResponse({ error: "Service unavailable" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!env.DISCORD_BOT_TOKEN) return jsonResponse({ error: "DISCORD_BOT_TOKEN not set" }, 503);

  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "User-Agent": UA };
  const out = { targetGuild: COUNCIL_GUILD_ID, targetChannel: COUNCIL_CHANNEL_ID };

  const me = await probe("https://discord.com/api/v10/users/@me", headers);
  out.bot = me.body ? { status: me.status, id: me.body.id, username: me.body.username } : me;

  const guilds = await probe("https://discord.com/api/v10/users/@me/guilds", headers);
  if (Array.isArray(guilds.body)) {
    out.guilds = guilds.body.map((g) => ({ id: g.id, name: g.name }));
    out.inTargetGuild = guilds.body.some((g) => g.id === COUNCIL_GUILD_ID);
  } else {
    out.guilds = guilds;
  }

  const chan = await probe(`https://discord.com/api/v10/channels/${COUNCIL_CHANNEL_ID}`, headers);
  out.channel = chan.body
    ? {
        status: chan.status,
        id: chan.body.id,
        name: chan.body.name,
        guild_id: chan.body.guild_id,
        parent_id: chan.body.parent_id,
        discordMessage: chan.body.message,
        discordCode: chan.body.code,
      }
    : chan;

  return jsonResponse(out);
}
