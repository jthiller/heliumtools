import { ensureOuiTables, getOuiByNumber, getOuiBalanceSeries } from "../services/ouis.js";
import { computeBurnRates } from "../services/burnRate.js";
import {
    WELL_KNOWN_OUIS_URL,
    DC_TO_USD_RATE,
    ZERO_BALANCE_DC,
    BALANCE_HISTORY_DAYS,
} from "../config.js";
import { okResponse } from "../responseUtils.js";
import { safeText } from "../utils.js";

/**
 * Fetch the well-known OUIs list from GitHub.
 */
async function fetchWellKnownOuis() {
    const res = await fetch(WELL_KNOWN_OUIS_URL, {
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        const body = await safeText(res);
        throw new Error(`Failed to fetch well-known OUIs (${res.status}): ${body}`);
    }
    return res.json();
}

/**
 * Calculate days remaining until balance reaches zero balance threshold.
 */
function calculateDaysRemaining(balanceDC, burnRateDC) {
    if (!burnRateDC || burnRateDC <= 0) return null;

    const remainingDC = balanceDC - ZERO_BALANCE_DC;
    if (remainingDC <= 0) return 0;

    return remainingDC / burnRateDC;
}

/**
 * Process a single OUI and return its stats.
 */
async function processOui(env, wellKnown) {
    const ouiNumber = wellKnown.id;
    const name = wellKnown.name || null;

    // Get OUI from local database
    const org = await getOuiByNumber(env, ouiNumber);
    if (!org) {
        // OUI not in our database yet, include with null values
        return {
            oui: ouiNumber,
            name,
            balance_dc: null,
            balance_usd: null,
            burn_1d_dc: null,
            burn_1d_usd: null,
            days_remaining: null,
        };
    }

    // Get balance timeseries for burn rate calculation
    const series = await getOuiBalanceSeries(env, ouiNumber, BALANCE_HISTORY_DAYS);

    // Compute burn rates
    const burnRates = computeBurnRates(series);

    // Get current balance from most recent timeseries entry
    const currentBalance = series.length > 0 ? series[series.length - 1].balance_dc : null;

    // Calculate days remaining
    const burn1dDC = burnRates.burn1d?.dc ?? null;
    const daysRemaining = currentBalance != null && burn1dDC != null
        ? calculateDaysRemaining(currentBalance, burn1dDC)
        : null;

    // Format days remaining
    let formattedDaysRemaining = null;
    if (daysRemaining != null) {
        formattedDaysRemaining = Number.isInteger(daysRemaining)
            ? daysRemaining
            : parseFloat(daysRemaining.toFixed(1));
    }

    // Round balance_dc and compute balance_usd from rounded value for consistency
    const roundedBalanceDC = currentBalance != null ? Math.round(currentBalance) : null;

    return {
        oui: ouiNumber,
        name,
        balance_dc: roundedBalanceDC,
        balance_usd: roundedBalanceDC != null ? parseFloat((roundedBalanceDC * DC_TO_USD_RATE).toFixed(2)) : null,
        burn_1d_dc: burn1dDC != null ? Math.round(burn1dDC) : null,
        burn_1d_usd: burnRates.burn1d?.usd != null ? parseFloat(burnRates.burn1d.usd.toFixed(2)) : null,
        days_remaining: formattedDaysRemaining,
    };
}

/**
 * Handle GET /known-ouis - returns all well-known OUIs with their stats.
 */
export async function handleKnownOuis(env) {
    try {
        await ensureOuiTables(env);

        // Fetch the well-known OUIs list
        const wellKnownOuis = await fetchWellKnownOuis();

        // Filter to only OUIs with a valid numeric id
        const validOuis = wellKnownOuis.filter(
            (oui) => oui.id != null && Number.isInteger(oui.id)
        );

        // Process all OUIs in parallel for better performance
        const results = await Promise.all(
            validOuis.map((wellKnown) => processOui(env, wellKnown))
        );

        // Filter to only include OUIs with less than 7 days remaining
        const lowBalanceOuis = results.filter(
            (r) => r.days_remaining !== null && r.days_remaining < 7
        );

        // Sort by days remaining (lowest first)
        lowBalanceOuis.sort((a, b) => (a.days_remaining || 0) - (b.days_remaining || 0));

        return okResponse({
            ouis: lowBalanceOuis,
            fetched_at: new Date().toISOString(),
        });
    } catch (err) {
        console.error("Error in /known-ouis", err);
        return okResponse({ error: `Unable to fetch known OUIs: ${err.message}` }, 500);
    }
}
