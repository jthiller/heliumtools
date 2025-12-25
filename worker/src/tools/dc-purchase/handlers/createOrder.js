import { resolveOui, createOrder, updateOrderStatus } from "../services/orders.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function buildPartnerRef(orderId) {
  return `dc_${orderId}`.slice(0, 48);
}

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || undefined;
}

function buildRedirectUrl(env, orderId) {
  const base = env.COINBASE_ONRAMP_REDIRECT_BASE_URL || "https://heliumtools.org/dc-purchase/order";
  return `${base}/${orderId}`;
}

async function createCoinbaseSession(env, { fiatAmount, partnerUserRef, clientIp, redirectUrl }) {
  const apiKey = env.COINBASE_CDP_API_KEY;
  const apiSecret = env.COINBASE_CDP_API_SECRET;
  const projectId = env.COINBASE_ONRAMP_PROJECT_ID || env.COINBASE_ONRAMP_APP_ID;
  if (!apiKey || !apiSecret) return null;
  const body = {
    projectId,
    destinationWallets: [
      {
        address: env.TREASURY_PUBLIC_KEY,
        assets: ["USDC"],
        blockchains: ["solana"],
      },
    ],
    partnerUserRef,
    presetFiatAmount: fiatAmount,
    fiatCurrency: "USD",
    redirectUrl,
  };
  const headers = {
    "Content-Type": "application/json",
    "CB-ACCESS-KEY": apiKey,
    "CB-ACCESS-SIGN": apiSecret,
  };
  if (clientIp) headers["CB-CLIENT-IP"] = clientIp;
  try {
    const res = await fetch("https://api.coinbase.com/onramp/v2/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data?.session?.url || data?.session?.onrampUrl || null;
  } catch (err) {
    console.error("coinbase session error", err);
    return null;
  }
}

export async function handleCreateOrder(request, env, ctx) {
  const payload = await request.json();
  const oui = Number(payload?.oui);
  const usd = payload?.usd;
  const email = payload?.email;

  if (!Number.isInteger(oui)) {
    return jsonResponse({ error: "Invalid OUI" }, 400);
  }

  const parsedUsd = Number(usd);
  if (!usd || Number.isNaN(parsedUsd) || parsedUsd <= 0) {
    return jsonResponse({ error: "USD amount required" }, 400);
  }
  if (parsedUsd < 5) {
    return jsonResponse({ error: "Minimum purchase is $5" }, 400);
  }
  const maxUsd = Number(env.DC_PURCHASE_MAX_USD || 1000);
  if (parsedUsd > maxUsd) {
    return jsonResponse({ error: `Maximum purchase is $${maxUsd}` }, 400);
  }

  const resolved = await resolveOui(env, oui);
  if (!resolved?.payer || !resolved?.escrow) {
    return jsonResponse({ error: "OUI not found" }, 404);
  }

  const partnerRef = buildPartnerRef(`${oui}-${Date.now()}`);
  const orderId = await createOrder(env, {
    oui,
    payer: resolved.payer,
    escrow: resolved.escrow,
    usd: String(usd),
    email,
    partnerRef,
  });

  const checkoutUrl =
    (await createCoinbaseSession(env, {
      fiatAmount: usd,
      partnerUserRef: partnerRef,
      clientIp: getClientIp(request),
      redirectUrl: buildRedirectUrl(env, orderId),
    })) || buildRedirectUrl(env, orderId);

  await updateOrderStatus(env, orderId, "onramp_started", {});

  const latestBalance = await env.DB.prepare(
    `SELECT balance_dc, fetched_at FROM oui_balances WHERE oui = ? ORDER BY date DESC LIMIT 1`
  )
    .bind(oui)
    .first();

  return jsonResponse({
    orderId,
    checkoutUrl,
    payer: resolved.payer,
    escrow: resolved.escrow,
    escrowDcBalance: latestBalance ? String(latestBalance.balance_dc) : null,
    balanceLastUpdated: latestBalance?.fetched_at || null,
  });
}
