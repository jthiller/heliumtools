import {
  DC_TO_USD_RATE,
  ZERO_BALANCE_DC,
  BALANCE_HISTORY_DAYS,
} from "../config.js";
import { pickThreshold } from "../utils.js";
import { computeBurnRates } from "../services/burnRate.js";
import { fetchEscrowBalanceDC, fetchEscrowBalancesBatched } from "../services/solana.js";
import { sendEmail } from "../services/email.js";
import { alertEmailTemplate } from "../templates/alert.js";
import { sendWebhook } from "../services/webhook.js";
import {
  fetchAllOuisFromApi,
  ensureOuiTables,
  pruneOuiBalanceHistory,
  recordOuiBalance,
  upsertOuis,
  getOuiByEscrow,
} from "../services/ouis.js";

/**
 * Main scheduled job - runs every 6 hours.
 * 
 * EVERY RUN (4x/day):
 * - Syncs all OUIs from the Helium API
 * - Fetches and records balances for all OUIs
 * - Records balances for subscribed escrow accounts
 * 
 * ONCE PER DAY (first run of the day for each subscription):
 * - Sends webhook payloads (if webhook_url configured)
 * - Sends threshold-based email alerts (if threshold crossed)
 */
export async function runDailyJob(env) {
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);

  console.log(`Starting scheduled job (oui-notifier) at ${now.toISOString()}`);

  try {
    await ensureOuiTables(env);

    // Ensure the last_webhook_date column exists (migration may not have run)
    await ensureWebhookDateColumn(env);

    // Step 1: Sync all OUIs and record balances (runs every 6 hours)
    // Use batched RPC fetch to avoid Cloudflare subrequest limits
    const escrowBalanceCache = new Map();
    try {
      const orgs = await fetchAllOuisFromApi();
      const syncedAt = now.toISOString();
      await upsertOuis(env, orgs, syncedAt);
      console.log(`Synced ${orgs.length} OUIs from API`);

      // Collect unique escrow addresses and map to all associated OUIs
      const escrowToOrgs = new Map();
      for (const org of orgs) {
        if (!org.escrow) continue;
        if (!escrowToOrgs.has(org.escrow)) {
          escrowToOrgs.set(org.escrow, []);
        }
        escrowToOrgs.get(org.escrow).push(org);
      }

      const escrowAddresses = Array.from(escrowToOrgs.keys());
      console.log(`Fetching balances for ${escrowAddresses.length} unique escrow accounts (batched)`);

      // Fetch all balances in a single batched RPC request
      const balanceMap = await fetchEscrowBalancesBatched(env, escrowAddresses);

      // Process results and record to database for all OUIs sharing each escrow
      for (const [escrow, balanceDC] of balanceMap) {
        const orgsForEscrow = escrowToOrgs.get(escrow);
        if (!orgsForEscrow) continue;

        escrowBalanceCache.set(escrow, { oui: orgsForEscrow[0].oui, balanceDC });

        // Record balance for all OUIs that share this escrow address
        for (const org of orgsForEscrow) {
          try {
            await recordOuiBalance(env, org, balanceDC, todayDate, syncedAt);
          } catch (err) {
            console.error(`Failed to record balance for OUI ${org.oui} (${escrow})`, err);
          }
        }
      }

      console.log(`Recorded balances for ${escrowBalanceCache.size} OUIs`);
    } catch (err) {
      console.error("Failed to sync OUIs; continuing with subscriptions.", err);
    }

    // Step 2: Process subscriptions
    const { results: subs } = await env.DB.prepare(
      `SELECT
         s.id,
         s.user_id,
         s.escrow_account,
         s.label,
         s.webhook_url,
         s.last_notified_level,
         s.last_balance_dc,
         s.last_webhook_date,
         u.email,
         u.uuid
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.verified = 1`
    ).all();

    if (!subs || subs.length === 0) {
      console.log("No verified subscriptions found; job complete.");
      await pruneOuiBalanceHistory(env, BALANCE_HISTORY_DAYS);
      return;
    }

    console.log(`Processing ${subs.length} verified subscriptions`);

    for (const sub of subs) {
      await processSubscription(env, sub, escrowBalanceCache, todayDate, now);
    }

    console.log("Scheduled job complete (oui-notifier).");
    await pruneOuiBalanceHistory(env, BALANCE_HISTORY_DAYS);
    await pruneSubscriptionBalanceHistory(env, BALANCE_HISTORY_DAYS);
  } catch (err) {
    console.error("Fatal error in scheduled job (oui-notifier)", err);
  }
}

/**
 * Process a single subscription.
 * - Always records balance (every 6 hours)
 * - Sends webhook once per day (if not already sent today)
 * - Sends email on threshold crossing
 */
async function processSubscription(env, sub, escrowBalanceCache, todayDate, now) {
  const subId = sub.id;
  const escrow = sub.escrow_account;
  const label = sub.label || null;
  const webhookUrl = sub.webhook_url || null;
  const email = sub.email;
  const lastNotifiedLevel = Number(sub.last_notified_level || 0);
  const lastBalanceDc = sub.last_balance_dc != null ? Number(sub.last_balance_dc) : null;
  const lastWebhookDate = sub.last_webhook_date || null;

  console.log(`Processing subscription ${subId} for ${escrow}`);

  // --- STEP 1: Fetch current balance ---
  let balanceDC;
  try {
    const cached = escrowBalanceCache.get(escrow);
    if (cached && Number.isFinite(cached.balanceDC)) {
      balanceDC = cached.balanceDC;
    } else {
      balanceDC = await fetchEscrowBalanceDC(env, escrow);
      escrowBalanceCache.set(escrow, { balanceDC, oui: cached?.oui ?? null });
    }
  } catch (rpcErr) {
    console.error(`Failed to fetch balance for ${escrow}`, rpcErr);
    return;
  }

  // --- STEP 2: Record balance in subscription history ---
  try {
    await env.DB.prepare(
      `INSERT INTO balances (subscription_id, date, balance_dc)
       VALUES (?, ?, ?)
       ON CONFLICT(subscription_id, date) DO UPDATE SET balance_dc = excluded.balance_dc`
    )
      .bind(subId, todayDate, balanceDC)
      .run();
  } catch (e) {
    console.error(`Error inserting balance row for subscription ${subId}`, e);
    return;
  }

  // --- STEP 3: Calculate burn rate and days remaining ---
  const { results: balanceRows } = await env.DB.prepare(
    `SELECT date, balance_dc
     FROM balances
     WHERE subscription_id = ?
     ORDER BY date DESC
     LIMIT ?`
  )
    .bind(subId, BALANCE_HISTORY_DAYS + 1)
    .all();

  // Use new timestamp-aware burn rate calculation
  const burnRates = computeBurnRates(balanceRows);
  const burn1dDC = burnRates.burn1d?.dc ?? 0;
  const burn30dDC = burnRates.burn30d?.dc ?? 0;
  const usd = balanceDC * DC_TO_USD_RATE;

  // Use 30-day average for days remaining calculation (more stable)
  const burnForDaysRemaining = burn30dDC > 0 ? burn30dDC : burn1dDC;
  let daysRemaining = null;
  if (burnForDaysRemaining > 0) {
    const effectiveBalance = Math.max(balanceDC - ZERO_BALANCE_DC, 0);
    daysRemaining = effectiveBalance / burnForDaysRemaining;
    console.log(
      `Subscription ${subId}: balance=${balanceDC}, burn1d=${burn1dDC.toFixed(2)}, burn30d=${burn30dDC.toFixed(2)}, daysRemaining=${daysRemaining.toFixed(2)}`
    );
  } else {
    console.log(`Subscription ${subId}: balance=${balanceDC}, no burn data`);
  }

  // --- STEP 4: Check for top-up (reset notification level) ---
  let newLastNotifiedLevel = lastNotifiedLevel;
  if (lastBalanceDc != null && balanceDC > lastBalanceDc * 1.2) {
    console.log(`Detected top-up for subscription ${subId}, resetting notification level`);
    newLastNotifiedLevel = 0;
  }

  // --- STEP 5: Send DAILY WEBHOOK (once per day) ---
  const alreadySentWebhookToday = lastWebhookDate === todayDate;

  if (webhookUrl && !alreadySentWebhookToday) {
    const webhookPayload = {
      escrowAccount: escrow,
      label,
      currentBalanceDC: balanceDC,
      currentBalanceUSD: usd,
      burn1dDC: burnRates.burn1d?.dc ?? null,
      burn1dUSD: burnRates.burn1d?.usd ?? null,
      burn30dDC: burnRates.burn30d?.dc ?? null,
      burn30dUSD: burnRates.burn30d?.usd ?? null,
      daysRemaining,
      timestamp: now.toISOString(),
    };

    try {
      console.log(`Sending daily webhook for subscription ${subId} to ${webhookUrl}`);
      const webhookOk = await sendWebhook(webhookUrl, webhookPayload);
      if (webhookOk) {
        console.log(`Daily webhook sent successfully for subscription ${subId}`);
        await env.DB.prepare(
          "UPDATE subscriptions SET last_webhook_date = ? WHERE id = ?"
        )
          .bind(todayDate, subId)
          .run();
      } else {
        console.error(`Webhook delivery failed for subscription ${subId}`);
      }
    } catch (e) {
      console.error(`Error sending webhook for subscription ${subId}`, e);
    }
  } else if (webhookUrl && alreadySentWebhookToday) {
    console.log(`Webhook already sent today for subscription ${subId}, skipping`);
  }

  // --- STEP 6: Send THRESHOLD EMAIL (when threshold is crossed) ---
  if (burnForDaysRemaining <= 0) {
    // No burn data, update balance and skip email
    await env.DB.prepare(
      "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
    )
      .bind(balanceDC, subId)
      .run();
    return;
  }

  const threshold = pickThreshold(daysRemaining, newLastNotifiedLevel);
  if (!threshold) {
    // No threshold crossed, just update balance
    await env.DB.prepare(
      "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
    )
      .bind(balanceDC, subId)
      .run();
    return;
  }

  // Threshold crossed - send email
  const subject = `[${env.APP_NAME || "Helium DC Alerts"}] ~${threshold} days of DC remaining`;
  const labelText = label ? ` (${label})` : "";

  const textBody = `Helium DC alert for escrow account ${escrow}${labelText}:

Current balance: ${balanceDC.toLocaleString("en-US")} DC (~$${usd.toFixed(2)})
1-day burn rate: ${burn1dDC > 0 ? burn1dDC.toFixed(2) : 'N/A'} DC ($${burnRates.burn1d?.usd?.toFixed(2) ?? 'N/A'})
30-day avg burn: ${burn30dDC > 0 ? burn30dDC.toFixed(2) : 'N/A'} DC ($${burnRates.burn30d?.usd?.toFixed(2) ?? 'N/A'})
Estimated days remaining: ${daysRemaining != null ? (() => { const r = Math.round(daysRemaining * 10) / 10; return r % 1 === 0 ? r : r.toFixed(1); })() : 'N/A'} days

This crossed the ${threshold}-day threshold.

You can review or change your subscription by visiting:
${env.APP_BASE_URL || ""}

(If you topped up your DC balance significantly, alerts will reset on the next run.)`;

  // Get OUI info for payer key
  const ouiInfo = await getOuiByEscrow(env, escrow);
  const payerKey = ouiInfo?.payer || null;
  const oui = ouiInfo?.oui || null;

  const htmlBody = alertEmailTemplate({
    label,
    payerKey,
    oui,
    balanceDC,
    balanceUSD: usd,
    burn1dDC,
    burn1dUSD: burnRates.burn1d?.usd ?? null,
    daysRemaining,
    threshold,
    appBaseUrl: env.APP_BASE_URL || "https://heliumtools.org/oui-notifier",
    userUuid: sub.uuid,
  });

  try {
    const emailOk = await sendEmail(env, {
      to: email,
      subject,
      text: textBody,
      html: htmlBody,
    });
    if (emailOk) {
      console.log(`Threshold email sent for subscription ${subId} (${threshold} days)`);
      await env.DB.prepare(
        "UPDATE subscriptions SET last_notified_level = ?, last_balance_dc = ? WHERE id = ?"
      )
        .bind(threshold, balanceDC, subId)
        .run();
    } else {
      console.error(`Email sending failed for subscription ${subId}`);
      await env.DB.prepare(
        "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
      )
        .bind(balanceDC, subId)
        .run();
    }
  } catch (e) {
    console.error(`Error sending email for subscription ${subId}`, e);
    await env.DB.prepare(
      "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
    )
      .bind(balanceDC, subId)
      .run();
  }
}

/**
 * Ensure the last_webhook_date column exists (handles case where migration hasn't run)
 */
async function ensureWebhookDateColumn(env) {
  try {
    // Try to add the column - will fail silently if it already exists
    await env.DB.prepare(
      "ALTER TABLE subscriptions ADD COLUMN last_webhook_date TEXT"
    ).run();
    console.log("Added last_webhook_date column to subscriptions table");
  } catch (err) {
    // Column likely already exists, which is fine
  }
}

async function pruneSubscriptionBalanceHistory(env, keepDays = BALANCE_HISTORY_DAYS) {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  try {
    await env.DB.prepare("DELETE FROM balances WHERE date < ?").bind(cutoffDate).run();
  } catch (err) {
    console.error("Failed to prune balances history", err);
  }
}
