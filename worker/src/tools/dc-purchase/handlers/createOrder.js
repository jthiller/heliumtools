import { resolveOui, createOrder, updateOrderStatus } from "../services/orders.js";
import { generateCoinbaseJwt } from "../lib/coinbaseJwt.js";

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

async function createCoinbaseSession(env, { fiatAmount, partnerUserRef, clientIp, redirectUrl, destinationAddress }) {
  const apiKey = env.COINBASE_CDP_API_KEY;
  const apiSecret = env.COINBASE_CDP_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error("Missing COINBASE_CDP_API_KEY or COINBASE_CDP_API_SECRET");
    return null;
  }

  if (!destinationAddress) {
    console.error("Missing destinationAddress (TREASURY_PUBLIC_KEY)");
    return null;
  }

  // Step 1: Generate session token via CDP API
  const tokenRequestBody = {
    addresses: [
      {
        address: destinationAddress,
        blockchains: ["solana"],
      },
    ],
    assets: ["USDC"],
  };

  // CDP API requires clientIp and rejects private IPs
  // Use a public test IP (RFC 5737) for local development
  let effectiveClientIp = clientIp;
  if (!effectiveClientIp ||
    effectiveClientIp === '127.0.0.1' ||
    effectiveClientIp === 'localhost' ||
    effectiveClientIp === '::1' ||
    effectiveClientIp.startsWith('10.') ||
    effectiveClientIp.startsWith('192.168.') ||
    effectiveClientIp.startsWith('172.16.') ||
    effectiveClientIp.startsWith('172.17.') ||
    effectiveClientIp.startsWith('172.18.') ||
    effectiveClientIp.startsWith('172.19.') ||
    effectiveClientIp.startsWith('172.2') ||
    effectiveClientIp.startsWith('172.3')) {
    // Use RFC 5737 test IP for development
    effectiveClientIp = '192.0.2.1';
    console.log('Using test public IP for development:', effectiveClientIp);
  }
  tokenRequestBody.clientIp = effectiveClientIp;

  try {
    // Generate JWT for authentication
    const requestHost = "api.developer.coinbase.com";
    const requestPath = "/onramp/v1/token";

    let jwt;
    try {
      console.log("Generating JWT for Coinbase API...");
      jwt = await generateCoinbaseJwt(apiKey, apiSecret, "POST", requestHost, requestPath);
      console.log("JWT generated successfully, length:", jwt?.length);
    } catch (jwtErr) {
      console.error("JWT generation failed:", jwtErr.message, jwtErr.stack);
      return null;
    }

    console.log("Requesting Coinbase session token with:", JSON.stringify({ addresses: tokenRequestBody.addresses, assets: tokenRequestBody.assets }));

    const tokenRes = await fetch(`https://${requestHost}${requestPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify(tokenRequestBody),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      console.error(`Coinbase token creation failed: ${tokenRes.status} ${tokenRes.statusText}`, errorBody);
      return null;
    }

    const tokenData = await tokenRes.json();
    const sessionToken = tokenData?.token;

    if (!sessionToken) {
      console.error("No session token in Coinbase response:", tokenData);
      return null;
    }

    console.log("Coinbase session token obtained successfully");

    // Step 2: Build the onramp URL with session token and parameters
    // Use sandbox URL for development/testing, production URL for live
    const useSandbox = env.COINBASE_SANDBOX === 'true';
    const payBaseUrl = useSandbox
      ? "https://pay-sandbox.coinbase.com/buy/select-asset"
      : "https://pay.coinbase.com/buy/select-asset";

    if (useSandbox) {
      console.log("Using Coinbase sandbox mode");
    }

    const onrampUrl = new URL(payBaseUrl);
    onrampUrl.searchParams.set("sessionToken", sessionToken);
    onrampUrl.searchParams.set("defaultNetwork", "solana");
    onrampUrl.searchParams.set("defaultAsset", "USDC");
    if (fiatAmount) {
      onrampUrl.searchParams.set("presetFiatAmount", String(fiatAmount));
    }
    if (partnerUserRef) {
      onrampUrl.searchParams.set("partnerUserRef", partnerUserRef);
    }
    if (redirectUrl) {
      onrampUrl.searchParams.set("redirectUrl", redirectUrl);
    }

    console.log("Coinbase onramp URL generated:", onrampUrl.toString());
    return onrampUrl.toString();
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
  if (!usd) {
    return jsonResponse({ error: "USD amount required" }, 400);
  }
  if (Number.isNaN(parsedUsd) || parsedUsd <= 0) {
    return jsonResponse({ error: "Invalid USD amount" }, 400);
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

  const coinbaseSessionUrl = await createCoinbaseSession(env, {
    fiatAmount: usd,
    partnerUserRef: partnerRef,
    clientIp: getClientIp(request),
    redirectUrl: buildRedirectUrl(env, orderId),
    destinationAddress: env.TREASURY_PUBLIC_KEY,
  });
  if (!coinbaseSessionUrl) {
    console.warn(`Coinbase session creation failed for order ${orderId}, falling back to redirect URL`);
  }
  const checkoutUrl = coinbaseSessionUrl || buildRedirectUrl(env, orderId);

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
