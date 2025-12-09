/**
 * Burn rate calculation service.
 * 
 * Computes 1-day and 30-day average burn rates from balance timeseries data.
 * - Uses actual timestamps (fetched_at) for precise interval calculation
 * - Falls back to date field (midnight UTC) when fetched_at is unavailable
 * - Ignores positive diffs (balance increases / top-ups)
 * - Returns rates in DC per day and converted to USD
 * 
 * Note: The `balances` table (subscriptions) only has `date`, while `oui_balances`
 * has `fetched_at`. This means subscription burn rates use day-level precision.
 */

import { DC_TO_USD_RATE } from "../config.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute burn rates from timeseries balance data.
 * 
 * @param {Array<{balance_dc: number, fetched_at?: string, date?: string}>} timeseries 
 *   Balance records. Each record should have:
 *   - balance_dc: Balance in Data Credits
 *   - fetched_at: ISO timestamp of when balance was fetched (preferred)
 *   - date: Date string as fallback (uses midnight UTC)
 * 
 * @returns {{
 *   burn1d: { dc: number, usd: number } | null,
 *   burn30d: { dc: number, usd: number } | null,
 *   dataPoints: number,
 *   periodDays: number | null
 * }}
 */
export function computeBurnRates(timeseries) {
    if (!timeseries || timeseries.length < 2) {
        return { burn1d: null, burn30d: null, dataPoints: timeseries?.length ?? 0, periodDays: null };
    }

    // Filter out records with invalid timestamps and sort chronologically
    const validRecords = timeseries.filter(r => getTimestamp(r) !== null);
    if (validRecords.length < 2) {
        return { burn1d: null, burn30d: null, dataPoints: timeseries.length, periodDays: null };
    }

    const sorted = validRecords.sort((a, b) => getTimestamp(a) - getTimestamp(b));

    // Calculate all burn segments (only negative diffs = balance decreasing)
    const burnSegments = [];

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        const prevBalance = Number(prev.balance_dc);
        const currBalance = Number(curr.balance_dc);

        if (!Number.isFinite(prevBalance) || !Number.isFinite(currBalance)) {
            continue;
        }

        const diff = prevBalance - currBalance; // positive = burn, negative = top-up

        // Only count burns (balance decreased)
        if (diff <= 0) {
            continue;
        }

        const prevTime = getTimestamp(prev);
        const currTime = getTimestamp(curr);
        const intervalMs = currTime - prevTime;

        if (intervalMs <= 0) {
            continue;
        }

        const intervalDays = intervalMs / MS_PER_DAY;

        burnSegments.push({
            burnDC: diff,
            intervalDays,
            timestamp: currTime,
        });
    }

    if (burnSegments.length === 0) {
        return {
            burn1d: null,
            burn30d: null,
            dataPoints: sorted.length,
            periodDays: calculatePeriodDays(sorted)
        };
    }

    // Calculate 1-day burn rate (most recent burn segment, normalized to per-day)
    const burn1d = calculate1DayBurn(burnSegments);

    // Calculate 30-day average burn rate (total burn / total period)
    // Note: This averages over the actual data period, which may be less than 30 days
    const burn30d = calculate30DayBurn(burnSegments, sorted);

    return {
        burn1d: burn1d ? { dc: burn1d, usd: burn1d * DC_TO_USD_RATE } : null,
        burn30d: burn30d ? { dc: burn30d, usd: burn30d * DC_TO_USD_RATE } : null,
        dataPoints: sorted.length,
        periodDays: calculatePeriodDays(sorted)
    };
}

/**
 * Calculate burn rate based on the most recent burn segment.
 * Returns the normalized per-day rate from the most recent segment.
 */
function calculate1DayBurn(burnSegments) {
    if (burnSegments.length === 0) return null;

    // Find the most recent burn segment using reduce (more efficient than sorting)
    const mostRecent = burnSegments.reduce(
        (max, seg) => seg.timestamp > max.timestamp ? seg : max,
        burnSegments[0]
    );

    // Normalize to per-day rate regardless of interval length
    return mostRecent.burnDC / mostRecent.intervalDays;
}

/**
 * Calculate average daily burn rate over all available data.
 * This is total burn divided by total time span of the dataset.
 * 
 * Note: If there are gaps in data collection, this may under-report the true burn rate.
 */
function calculate30DayBurn(burnSegments, sortedTimeseries) {
    if (burnSegments.length === 0) return null;

    const totalBurnDC = burnSegments.reduce((sum, seg) => sum + seg.burnDC, 0);
    const periodDays = calculatePeriodDays(sortedTimeseries);

    if (!periodDays || periodDays <= 0) return null;

    return totalBurnDC / periodDays;
}

/**
 * Calculate the total period covered by the timeseries in days.
 */
function calculatePeriodDays(sortedTimeseries) {
    if (sortedTimeseries.length < 2) return null;

    const firstTime = getTimestamp(sortedTimeseries[0]);
    const lastTime = getTimestamp(sortedTimeseries[sortedTimeseries.length - 1]);

    if (firstTime === null || lastTime === null) return null;

    return (lastTime - firstTime) / MS_PER_DAY;
}

/**
 * Get timestamp from a record, preferring fetched_at over date.
 * Returns null if neither is available (to avoid epoch issues).
 */
function getTimestamp(record) {
    if (record.fetched_at) {
        return new Date(record.fetched_at).getTime();
    }
    if (record.date) {
        // Date strings like "2024-12-05" - assume midnight UTC
        return new Date(record.date + "T00:00:00Z").getTime();
    }
    return null;
}

