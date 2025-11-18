import { isValidEmail, isLikelyBase58 } from "./utils.js";
import { sendEmail } from "./services/email.js";
import { fetchEscrowBalanceDC } from "./services/solana.js";
import { getOuiBalanceSeries, getOuiByNumber, listOuis } from "./services/ouis.js";
import { DC_TO_USD_RATE, ZERO_BALANCE_DC, ZERO_BALANCE_USD } from "./config.js";

const jsonHeaders = {
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const okResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: jsonHeaders });
  }

  if (request.method === "POST" && pathname === "/subscribe") {
    return handleSubscribe(request, env);
  }

  if (request.method === "GET" && pathname === "/verify") {
    return handleVerify(request, env);
  }

  if (request.method === "GET" && pathname === "/health") {
    return new Response(JSON.stringify({ ok: true, tool: "oui-notifier" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (request.method === "GET" && pathname === "/ouis") {
    return handleListOuis(env);
  }

  if (request.method === "GET" && pathname === "/balance") {
    return handleBalance(url, env);
  }

  if (request.method === "GET" && pathname === "/timeseries") {
    return handleTimeseries(url, env);
  }

  return new Response("Not found (oui-notifier)", { status: 404 });
}

async function handleSubscribe(request, env) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return new Response("Invalid content-type; expected form submission.", { status: 400 });
    }

    const form = await request.formData();
    const email = (form.get("email") || "").toString().trim().toLowerCase();
    const escrowAccount = (form.get("escrow_account") || "").toString().trim();
    const label = (form.get("label") || "").toString().trim();
    const webhookUrlRaw = (form.get("webhook_url") || "").toString().trim();

    if (!email || !escrowAccount) {
      return new Response("Email and escrow token account are required.", { status: 400 });
    }

    if (!isValidEmail(email)) {
      return new Response("Invalid email address.", { status: 400 });
    }

    if (!isLikelyBase58(escrowAccount)) {
      return new Response("Escrow token account is not a valid Solana base58 address.", { status: 400 });
    }

    let webhookUrl = null;
    if (webhookUrlRaw) {
      try {
        const u = new URL(webhookUrlRaw);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return new Response("Webhook URL must be HTTP or HTTPS.", { status: 400 });
        }
        webhookUrl = u.toString();
      } catch {
        return new Response("Webhook URL is not a valid URL.", { status: 400 });
      }
    }

    const nowIso = new Date().toISOString();

    let user = await env.DB.prepare(
      "SELECT * FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    let userId;
    let verifyToken;

    if (!user) {
      verifyToken = crypto.randomUUID();
      const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const result = await env.DB.prepare(
        "INSERT INTO users (email, verified, verify_token, verify_expires_at, created_at) VALUES (?, 0, ?, ?, ?)"
      )
        .bind(email, verifyToken, verifyExpiresAt, nowIso)
        .run();

      userId = result.lastRowId;
    } else {
      userId = user.id;
      if (!user.verified) {
        verifyToken = crypto.randomUUID();
        const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "UPDATE users SET verify_token = ?, verify_expires_at = ? WHERE id = ?"
        )
          .bind(verifyToken, verifyExpiresAt, userId)
          .run();
      } else {
        verifyToken = user.verify_token;
      }
    }

    const existingSub = await env.DB.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND escrow_account = ?"
    )
      .bind(userId, escrowAccount)
      .first();

    if (!existingSub) {
      await env.DB.prepare(
        "INSERT INTO subscriptions (user_id, escrow_account, label, webhook_url, created_at, last_notified_level, last_balance_dc) VALUES (?, ?, ?, ?, ?, 0, NULL)"
      )
        .bind(userId, escrowAccount, label || null, webhookUrl || null, nowIso)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE subscriptions SET label = ?, webhook_url = ? WHERE id = ?"
      )
        .bind(label || existingSub.label, webhookUrl || existingSub.webhook_url, existingSub.id)
        .run();
    }

    if (!user || !user.verified) {
      const verifyUrl = `${env.APP_BASE_URL || ""}/verify?token=${encodeURIComponent(
        verifyToken
      )}&email=${encodeURIComponent(email)}`;

      const sent = await sendEmail(env, {
        to: email,
        subject: `[${env.APP_NAME || "Helium DC Alerts"}] Verify your email`,
        text: `Hi,

Please verify your email address for ${env.APP_NAME || "Helium DC Alerts"} by clicking this link:

${verifyUrl}

This link will expire in 24 hours.

If you did not request this, you can ignore this message.

Thanks!`,
      });

      if (!sent) {
        return new Response(
          "Subscription saved, but we could not send the verification email. Please try again later.",
          { status: 500 }
        );
      }

      return new Response(
        "Subscription saved. Please check your inbox to verify your email before alerts are sent.",
        { status: 200 }
      );
    }

    return new Response("Subscription saved. Email already verified.", { status: 200 });
  } catch (err) {
    console.error("Error in /subscribe", err);
    return new Response("Error while saving your subscription.", { status: 500 });
  }
}

async function handleVerify(request, env) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const email = (url.searchParams.get("email") || "").toLowerCase().trim();

    if (!token || !email) {
      return new Response("Missing verification token or email.", { status: 400 });
    }

    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      return new Response("User not found for this email.", { status: 404 });
    }

    if (!user.verify_token || user.verify_token !== token) {
      return new Response("Invalid or expired verification token.", { status: 400 });
    }

    if (user.verify_expires_at) {
      const exp = new Date(user.verify_expires_at).getTime();
      if (Date.now() > exp) {
        return new Response("Verification link has expired. Please subscribe again.", { status: 400 });
      }
    }

    await env.DB.prepare(
      "UPDATE users SET verified = 1, verify_token = NULL, verify_expires_at = NULL WHERE id = ?"
    )
      .bind(user.id)
      .run();

    const redirectUrl = `${env.APP_BASE_URL || "https://heliumtools.org/oui-notifier"}?verified=1`;
    return Response.redirect(redirectUrl, 302);
  } catch (err) {
    console.error("Error in /verify", err);
    return new Response("Error while verifying your email.", { status: 500 });
  }
}

async function handleListOuis(env) {
  try {
    const orgs = await listOuis(env);
    const parsed = orgs.map((org) => {
      let delegateKeys = [];
      try {
        delegateKeys = org.delegate_keys ? JSON.parse(org.delegate_keys) : [];
      } catch {
        delegateKeys = [];
      }
      return {
        oui: org.oui,
        owner: org.owner,
        payer: org.payer,
        escrow: org.escrow,
        locked: Boolean(org.locked),
        delegate_keys: delegateKeys,
        last_synced_at: org.last_synced_at,
      };
    });
    return okResponse({ orgs: parsed });
  } catch (err) {
    console.error("Error in /ouis", err);
    return okResponse({ error: "Unable to load OUIs" }, 500);
  }
}

async function handleBalance(url, env) {
  const ouiParam = url.searchParams.get("oui");
  const escrowParam = url.searchParams.get("escrow");
  try {
    let targetEscrow = escrowParam;
    let oui = ouiParam ? Number(ouiParam) : null;
    let org = null;

    if (ouiParam && (!Number.isInteger(oui) || oui < 0)) {
      return okResponse({ error: "Invalid OUI" }, 400);
    }

    if (!targetEscrow && Number.isInteger(oui)) {
      org = await getOuiByNumber(env, oui);
      if (!org) {
        return okResponse({ error: "OUI not found" }, 404);
      }
      targetEscrow = org.escrow;
    }

    if (!targetEscrow) {
      return okResponse({ error: "escrow or oui is required" }, 400);
    }

    const balanceDC = await fetchEscrowBalanceDC(env, targetEscrow);
    const balanceUSD = balanceDC * DC_TO_USD_RATE;
    return okResponse({
      oui,
      escrow: targetEscrow,
      balance_dc: balanceDC,
      balance_usd: balanceUSD,
      zero_balance_dc: ZERO_BALANCE_DC,
      zero_balance_usd: ZERO_BALANCE_USD,
    });
  } catch (err) {
    console.error("Error in /balance", err);
    return okResponse({ error: "Unable to fetch balance" }, 500);
  }
}

async function handleTimeseries(url, env) {
  const ouiParam = url.searchParams.get("oui");
  const daysParam = url.searchParams.get("days");
  const oui = Number(ouiParam);
  const days = daysParam ? Number(daysParam) : 30;

  if (!Number.isInteger(oui)) {
    return okResponse({ error: "Invalid OUI" }, 400);
  }
  if (!Number.isFinite(days) || days <= 0) {
    return okResponse({ error: "Invalid days" }, 400);
  }

  try {
    const org = await getOuiByNumber(env, oui);
    if (!org) {
      return okResponse({ error: "OUI not found" }, 404);
    }

    const series = await getOuiBalanceSeries(env, oui, days);
    return okResponse({
      oui,
      escrow: org.escrow,
      days,
      points: series.map((row) => ({
        date: row.date,
        balance_dc: row.balance_dc,
        fetched_at: row.fetched_at,
      })),
    });
  } catch (err) {
    console.error("Error in /timeseries", err);
    return okResponse({ error: "Unable to fetch timeseries" }, 500);
  }
}
