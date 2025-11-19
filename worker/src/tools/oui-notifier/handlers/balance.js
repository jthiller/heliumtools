import {
    ensureOuiTables,
    getOuiByNumber,
    getOuiByEscrow,
    recordOuiBalance,
    pruneOuiBalanceHistory,
    getOuiBalanceSeries,
} from "../services/ouis.js";
import { fetchEscrowBalanceDC } from "../services/solana.js";
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

        if (org?.oui) {
            const todayDate = new Date().toISOString().slice(0, 10);
            const fetchedAt = new Date().toISOString();
            await recordOuiBalance(env, org, balanceDC, todayDate, fetchedAt);
            await pruneOuiBalanceHistory(env, BALANCE_HISTORY_DAYS);
        }

        const series =
            org?.oui != null ? await getOuiBalanceSeries(env, org.oui, BALANCE_HISTORY_DAYS) : [];

        return okResponse({
            oui,
            escrow: targetEscrow,
            balance_dc: balanceDC,
            balance_usd: balanceUSD,
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
        return okResponse({ error: "Unable to fetch balance" }, 500);
    }
}
