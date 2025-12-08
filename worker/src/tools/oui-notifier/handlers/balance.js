import {
    ensureOuiTables,
    getOuiByNumber,
    getOuiByEscrow,
    getOuiBalanceSeries,
} from "../services/ouis.js";
import { fetchEscrowBalanceDC } from "../services/solana.js";
import { computeBurnRates } from "../services/burnRate.js";
import {
    DC_TO_USD_RATE,
    ZERO_BALANCE_DC,
    ZERO_BALANCE_USD,
    BALANCE_HISTORY_DAYS,
} from "../config.js";
import { okResponse } from "../responseUtils.js";

export async function handleBalance(url, env) {
    const ouiParam = url.searchParams.get("oui");
    const escrowParam = url.searchParams.get("escrow");
    try {
        await ensureOuiTables(env);
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

        if (!org) {
            const byEscrow = await getOuiByEscrow(env, targetEscrow);
            if (byEscrow) {
                org = byEscrow;
                if (oui == null) {
                    oui = byEscrow.oui;
                }
            }
        }

        const balanceDC = await fetchEscrowBalanceDC(env, targetEscrow);
        const balanceUSD = balanceDC * DC_TO_USD_RATE;

        // Note: Balance recording is handled by the daily cron job only.
        // The /balance endpoint is read-only.

        const series =
            org?.oui != null ? await getOuiBalanceSeries(env, org.oui, BALANCE_HISTORY_DAYS) : [];

        // Compute burn rates from timeseries
        const burnRates = computeBurnRates(series);

        return okResponse({
            oui,
            escrow: targetEscrow,
            balance_dc: balanceDC,
            balance_usd: balanceUSD,
            burn_rate: {
                burn_1d_dc: burnRates.burn1d?.dc ?? null,
                burn_1d_usd: burnRates.burn1d?.usd ?? null,
                burn_30d_dc: burnRates.burn30d?.dc ?? null,
                burn_30d_usd: burnRates.burn30d?.usd ?? null,
            },
            zero_balance_dc: ZERO_BALANCE_DC,
            zero_balance_usd: ZERO_BALANCE_USD,
            timeseries: series.map((row) => ({
                date: row.date,
                balance_dc: row.balance_dc,
                fetched_at: row.fetched_at,
            })),
        });
    } catch (err) {
        console.error("Error in /balance", err);
        return okResponse({ error: `Unable to fetch balance: ${err.message}` }, 500);
    }
}

