import { getOuiByNumber, getOuiBalanceSeries } from "../services/ouis.js";
import { jsonResponse } from "../../../lib/response.js";

export async function handleTimeseries(url, env) {
    const ouiParam = url.searchParams.get("oui");
    const daysParam = url.searchParams.get("days");
    const oui = Number(ouiParam);
    const days = daysParam ? Number(daysParam) : 30;

    if (!Number.isInteger(oui)) {
        return jsonResponse({ error: "Invalid OUI" }, 400);
    }
    if (!Number.isFinite(days) || days <= 0) {
        return jsonResponse({ error: "Invalid days" }, 400);
    }

    try {
        const org = await getOuiByNumber(env, oui);
        if (!org) {
            return jsonResponse({ error: "OUI not found" }, 404);
        }

        const series = await getOuiBalanceSeries(env, oui, days);
        return jsonResponse({
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
        return jsonResponse({ error: "Unable to fetch timeseries" }, 500);
    }
}
