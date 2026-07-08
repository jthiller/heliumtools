import {
  handleOuiNotifierRequest,
  runOuiNotifierDaily,
} from "./tools/oui-notifier/index.js";
import {
  handleDcPurchaseRequest,
  runDcPurchaseScheduled,
} from "./tools/dc-purchase/index.js";
import { handleHotspotClaimerRequest } from "./tools/hotspot-claimer/index.js";
import { handleHotspotMapRequest } from "./tools/hotspot-map/index.js";
import { handleMultiGatewayRequest } from "./tools/multi-gateway/index.js";
import { MultiGatewayHub } from "./tools/multi-gateway/hub.js";
import { handleDcMintRequest } from "./tools/dc-mint/index.js";
import { handleL1MigrationRequest } from "./tools/l1-migration/index.js";
import { handleIotOnboardRequest, refreshOnboardFees } from "./tools/iot-onboard/index.js";
import { handleUpdateLocationRequest } from "./tools/update-location/index.js";
import { handleVeHntRequest } from "./tools/ve-hnt/index.js";
import { handleVoteRequest, runVoteSnapshots, VOTE_SNAPSHOT_CRON } from "./tools/vote/index.js";
import { handleCouncilRequest, pollCouncil } from "./tools/council/index.js";
import { handleWalletDashboardRequest } from "./tools/wallet-dashboard/index.js";
import { handleSharedRequest } from "./tools/shared/index.js";
import { refreshOuiCache } from "./tools/multi-gateway/oui-cache.js";

const routes = [
  { prefix: "/oui-notifier", handler: handleOuiNotifierRequest },
  { prefix: "/dc-purchase", handler: handleDcPurchaseRequest },
  { prefix: "/hotspot-claimer", handler: handleHotspotClaimerRequest },
  { prefix: "/hotspot-map", handler: handleHotspotMapRequest },
  { prefix: "/multi-gateway", handler: handleMultiGatewayRequest },
  { prefix: "/dc-mint", handler: handleDcMintRequest },
  { prefix: "/l1-migration", handler: handleL1MigrationRequest },
  { prefix: "/iot-onboard", handler: handleIotOnboardRequest },
  { prefix: "/update-location", handler: handleUpdateLocationRequest },
  { prefix: "/ve-hnt", handler: handleVeHntRequest },
  { prefix: "/vote", handler: handleVoteRequest },
  { prefix: "/council", handler: handleCouncilRequest },
  { prefix: "/wallet-dashboard", handler: handleWalletDashboardRequest },
  { prefix: "/shared", handler: handleSharedRequest },
];

function stripPrefix(request, prefix) {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(prefix.length) || "/";
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const { pathname } = new URL(request.url);

      for (const { prefix, handler } of routes) {
        if (pathname.startsWith(prefix + "/")) {
          return await handler(stripPrefix(request, prefix), env, ctx);
        }
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("Unhandled fetch error", err);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    const run = (name, promise) =>
      ctx.waitUntil(
        promise.catch((err) => {
          console.error(`scheduled task "${name}" failed`, err?.stack || err);
        }),
      );

    // High-frequency vote-snapshot tick (every 15 min): refresh the stored
    // snapshot + append history so viewers never hit the RPC. Runs in isolation
    // — the heavier 6-hourly tasks below must NOT fire on this cadence.
    if (event.cron === VOTE_SNAPSHOT_CRON) {
      run("vote-snapshots", runVoteSnapshots(env));
      return;
    }
    // Safety backstop: the 6-hourly tasks only ever run at minute 0, so even if
    // the cron string didn't match above they can't fire on a :15/:30/:45 tick.
    if (new Date(event.scheduledTime).getUTCMinutes() !== 0) return;

    run("oui-notifier-daily", runOuiNotifierDaily(env));
    run("dc-purchase-scheduled", runDcPurchaseScheduled(env, ctx));
    run("iot-onboard-fees", refreshOnboardFees(env));
    // Council nominations: poll the Discord channel with the bot token and refresh
    // the stored snapshot (no-op until DISCORD_BOT_TOKEN is set).
    run("council-poll", pollCouncil(env));
    // OUI data changes infrequently — refresh once daily at midnight UTC
    const hour = new Date(event.scheduledTime).getUTCHours();
    if (hour === 0) run("multi-gateway-oui-cache", refreshOuiCache(env));
  },
};

// Re-export Durable Object classes so the runtime can instantiate them.
// Bound in wrangler.jsonc via durable_objects.bindings.
export { MultiGatewayHub };
