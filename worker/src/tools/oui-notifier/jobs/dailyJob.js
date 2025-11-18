import {
  BURN_LOOKBACK_DAYS,
  DC_TO_USD_RATE,
  ZERO_BALANCE_DC,
  BALANCE_HISTORY_DAYS,
} from "../config.js";
import { computeAvgDailyBurn, pickThreshold } from "../utils.js";
import { fetchEscrowBalanceDC } from "../services/solana.js";
import { sendEmail } from "../services/email.js";
import { sendWebhook } from "../services/webhook.js";
import {
  fetchAllOuisFromApi,
  ensureOuiTables,
  pruneOuiBalanceHistory,
  recordOuiBalance,
  upsertOuis,
} from "../services/ouis.js";

export async function runDailyJob(env) {
  console.log("Starting daily DC alert job (oui-notifier)");

  try {
    await ensureOuiTables(env);

    const { results: subs } = await env.DB.prepare(
      `SELECT
         s.id,
         s.user_id,
         s.escrow_account,
         s.label,
         s.webhook_url,
         s.last_notified_level,
         s.last_balance_dc,
         u.email
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.verified = 1`
    ).all();

    const today = new Date();
    const todayDate = today.toISOString().slice(0, 10);

    // Step 1: sync all OUIs and record balances for everyone (whether subscribed or not).
    const escrowBalanceCache = new Map();
    try {
      const orgs = await fetchAllOuisFromApi();
      const syncedAt = new Date().toISOString();
      await upsertOuis(env, orgs, syncedAt);

      for (const org of orgs) {
        if (!org.escrow) continue;
        if (escrowBalanceCache.has(org.escrow)) continue;

        try {
          const balanceDC = await fetchEscrowBalanceDC(env, org.escrow);
          const entry = { oui: org.oui, balanceDC };
          escrowBalanceCache.set(org.escrow, entry);
          await recordOuiBalance(env, org, balanceDC, todayDate, syncedAt);
        } catch (err) {
          console.error(`Unable to fetch/store balance for OUI ${org.oui} (${org.escrow})`, err);
        }
      }
    } catch (err) {
      console.error("Failed to sync OUIs; continuing with subscriptions.", err);
    }

    if (!subs || subs.length === 0) {
      console.log("No verified subscriptions found; job complete.");
      return;
    }

    // Step 2: run subscription alerts, reusing cached balances when possible.

    for (const sub of subs) {
      const subId = sub.id;
      const escrow = sub.escrow_account;
      const label = sub.label || null;
      const webhookUrl = sub.webhook_url || null;
      const email = sub.email;
      const lastNotifiedLevel = Number(sub.last_notified_level || 0);
      const lastBalanceDc = sub.last_balance_dc != null ? Number(sub.last_balance_dc) : null;

      console.log(`Processing subscription ${subId} for ${email} / ${escrow}`);

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
        continue;
      }

      let newLastNotifiedLevel = lastNotifiedLevel;
      if (lastBalanceDc != null && balanceDC > lastBalanceDc * 1.2) {
        console.log(
          `Detected possible top-up for subscription ${subId} (from ${lastBalanceDc} to ${balanceDC}), resetting notification level.`
        );
        newLastNotifiedLevel = 0;
      }

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
        continue;
      }

      const { results: balanceRows } = await env.DB.prepare(
        `SELECT date, balance_dc
         FROM balances
         WHERE subscription_id = ?
         ORDER BY date DESC
         LIMIT ?`
      )
        .bind(subId, BURN_LOOKBACK_DAYS + 1)
        .all();

      const avgBurn = computeAvgDailyBurn(balanceRows);
      if (!avgBurn || avgBurn <= 0) {
        console.log(
          `No burn detected for subscription ${subId} (avg burn = ${avgBurn}). Skipping notifications.`
        );
        await env.DB.prepare(
          "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
        )
          .bind(balanceDC, subId)
        .run();
        continue;
      }

      const effectiveBalance = Math.max(balanceDC - ZERO_BALANCE_DC, 0);
      const daysRemaining = effectiveBalance / avgBurn;
      console.log(
        `Subscription ${subId}: balance=${balanceDC} (effective ${effectiveBalance}), avgBurn=${avgBurn.toFixed(
          2
        )}, daysRemaining=${daysRemaining.toFixed(2)}`
      );

      const threshold = pickThreshold(daysRemaining, newLastNotifiedLevel);
      if (!threshold) {
        await env.DB.prepare(
          "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
        )
          .bind(balanceDC, subId)
          .run();
        continue;
      }

      const subject = `[${env.APP_NAME || "Helium DC Alerts"}] ~${threshold} days of DC remaining`;
      const labelText = label ? ` (${label})` : "";
      const usd = balanceDC * DC_TO_USD_RATE;

      const textBody = `Helium DC alert for escrow account ${escrow}${labelText}:

Current balance: ${balanceDC.toLocaleString("en-US")} DC (~$${usd.toFixed(2)})
Average daily burn (last ${BURN_LOOKBACK_DAYS} days): ${avgBurn.toFixed(2)} DC/day
Estimated days remaining: ${daysRemaining.toFixed(1)} days

This crossed the ${threshold}-day threshold.

You can review or change your subscription by visiting:
${env.APP_BASE_URL || ""}

(If you topped up your DC balance significantly, alerts will reset on the next run.)`;

      const payloadForWebhook = {
        wallet: null,
        escrowAccount: escrow,
        label,
        currentBalanceDC: balanceDC,
        currentBalanceUSD: usd,
        avgDailyBurnDC: avgBurn,
        daysRemaining,
        thresholdHit: threshold,
        timestamp: today.toISOString(),
      };

      let anySuccess = false;

      try {
        const emailOk = await sendEmail(env, {
          to: email,
          subject,
          text: textBody,
        });
        if (emailOk) anySuccess = true;
        else console.error(`Email sending failed for subscription ${subId}`);
      } catch (e) {
        console.error(`Error sending email for subscription ${subId}`, e);
      }

      if (webhookUrl) {
        try {
          const webhookOk = await sendWebhook(webhookUrl, payloadForWebhook);
          if (webhookOk) anySuccess = true;
        } catch (e) {
          console.error(`Error sending webhook for subscription ${subId}`, e);
        }
      }

      if (anySuccess) {
        try {
          await env.DB.prepare(
            "UPDATE subscriptions SET last_notified_level = ?, last_balance_dc = ? WHERE id = ?"
          )
            .bind(threshold, balanceDC, subId)
            .run();
        } catch (e) {
          console.error(
            `Error updating subscription notification level for ${subId}`,
            e
          );
        }
      } else {
        console.error(
          `No successful notifications sent for subscription ${subId}; will retry on next run.`
        );
        await env.DB.prepare(
          "UPDATE subscriptions SET last_balance_dc = ? WHERE id = ?"
        )
          .bind(balanceDC, subId)
          .run();
      }
    }

    console.log("Daily DC alert job complete (oui-notifier).");
    await pruneOuiBalanceHistory(env, BALANCE_HISTORY_DAYS);
    await pruneSubscriptionBalanceHistory(env, BALANCE_HISTORY_DAYS);
  } catch (err) {
    console.error("Fatal error in daily job (oui-notifier)", err);
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
