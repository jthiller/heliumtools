import { getOuisByNumbers, getRecentBalancesForOuis } from "../services/ouis.js";
import { computeBurnRates } from "../services/burnRate.js";
import {
    WELL_KNOWN_OUIS_URL,
    DC_TO_USD_RATE,
    ZERO_BALANCE_DC,
    BURN_RATE_DAYS,
} from "../config.js";
import { okResponse } from "../responseUtils.js";
import { safeText } from "../utils.js";

const KV_CACHE_KEY = "well-known-ouis";
const KV_CACHE_TTL = 3600; // 1 hour

/**
 * Fetch the well-known OUIs list from GitHub, with KV caching.
 */
async function fetchWellKnownOuis(env) {
    // Try KV cache first
    if (env.KV) {
        try {
            const cached = await env.KV.get(KV_CACHE_KEY, "json");
            if (cached) return cached;
        } catch (err) {
            console.error("KV cache read failed", err);
        }
    }

    // Fetch from GitHub
    const res = await fetch(WELL_KNOWN_OUIS_URL, {
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        const body = await safeText(res);
        throw new Error(`Failed to fetch well-known OUIs (${res.status}): ${body}`);
    }
    const fresh = await res.json();

    // Store in KV cache (best-effort, errors are logged but don't fail the request)
    if (env.KV) {
        try {
            await env.KV.put(KV_CACHE_KEY, JSON.stringify(fresh), { expirationTtl: KV_CACHE_TTL });
        } catch (err) {
            console.error("KV cache write failed", err);
        }
    }

    return fresh;
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
 * Process OUI data and compute stats.
 */
function processOuiData(wellKnown, orgData, balanceSeries) {
    const ouiNumber = wellKnown.id;
    const name = wellKnown.name || null;

    if (!orgData) {
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

    // Compute burn rates from balance series
    const burnRates = computeBurnRates(balanceSeries);

    // Get current balance from most recent entry
    const currentBalance = balanceSeries.length > 0
        ? balanceSeries[balanceSeries.length - 1].balance_dc
        : null;

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

    // Round balance_dc and compute balance_usd from rounded value
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
 * Handle GET /known-ouis - returns well-known OUIs with active burn.
 * 
 * Read-only endpoint - no database mutations.
 */
export async function handleKnownOuis(env) {
    try {
        // Fetch the well-known OUIs list (cached in KV)
        const wellKnownOuis = await fetchWellKnownOuis(env);

        // Filter to only OUIs with a valid numeric id
        const validOuis = wellKnownOuis.filter(
            (oui) => oui.id != null && Number.isInteger(oui.id)
        );
        const ouiNumbers = validOuis.map((o) => o.id);

        // Batch fetch all OUI data and balances (2 queries instead of 36)
        const [allOrgs, allBalances] = await Promise.all([
            getOuisByNumbers(env, ouiNumbers),
            getRecentBalancesForOuis(env, ouiNumbers, BURN_RATE_DAYS),
        ]);

        // Index org data by OUI number
        const orgsByOui = new Map(allOrgs.map((org) => [org.oui, org]));

        // Group balances by OUI (already sorted ascending by date from query)
        const balancesByOui = new Map();
        for (const balance of allBalances) {
            if (!balancesByOui.has(balance.oui)) {
                balancesByOui.set(balance.oui, []);
            }
            balancesByOui.get(balance.oui).push(balance);
        }

        // Process all OUIs
        const results = validOuis.map((wellKnown) => {
            const orgData = orgsByOui.get(wellKnown.id);
            const balanceSeries = balancesByOui.get(wellKnown.id) || [];
            return processOuiData(wellKnown, orgData, balanceSeries);
        });

        // Filter to only include OUIs with DC burn in the last 24h
        const activeOuis = results.filter(
            (r) => r.burn_1d_dc !== null && r.burn_1d_dc > 0
        );

        // Sort by OUI number
        activeOuis.sort((a, b) => a.oui - b.oui);

        return okResponse({
            ouis: activeOuis,
            fetched_at: new Date().toISOString(),
        });
    } catch (err) {
        console.error("Error in /known-ouis", err);
        return okResponse({ error: `Unable to fetch known OUIs: ${err.message}` }, 500);
    }
}
