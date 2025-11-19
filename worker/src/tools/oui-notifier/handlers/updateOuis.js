import {
    ensureOuiTables,
    getOuiByNumber,
    fetchAllOuisFromApi,
    upsertOuis,
    listOuis,
    recordOuiBalance,
} from "../services/ouis.js";
import { fetchEscrowBalanceDC } from "../services/solana.js";
import { MAX_BALANCE_FETCH_PER_UPDATE } from "../config.js";
import { okResponse } from "../responseUtils.js";

export async function handleUpdateOuis(env, targetOui) {
    const startedAt = new Date().toISOString();
    const todayDate = new Date().toISOString().slice(0, 10);
    try {
        await ensureOuiTables(env);

        // If a specific OUI is requested, refresh just that one (metadata + balance).
        if (targetOui != null) {
            if (!Number.isInteger(targetOui) || targetOui < 0) {
                return okResponse({ error: "Invalid OUI" }, 400);
            }

            let org = await getOuiByNumber(env, targetOui);
            if (!org) {
                const all = await fetchAllOuisFromApi();
                org = all.find((o) => o.oui === targetOui);
                if (!org) {
                    return okResponse({ error: "OUI not found" }, 404);
                }
                await upsertOuis(env, [org], startedAt);
            }

            if (!org.escrow) {
                return okResponse({ error: "OUI missing escrow" }, 400);
            }

            try {
                const balanceDC = await fetchEscrowBalanceDC(env, org.escrow);
                await recordOuiBalance(env, org, balanceDC, todayDate, startedAt);
                return okResponse({
                    ok: true,
                    updated: true,
                    oui: targetOui,
                    escrow: org.escrow,
                    balance_dc: balanceDC,
                    updated_at: startedAt,
                });
            } catch (err) {
                console.error(`Failed to fetch/store balance for OUI ${targetOui} (${org.escrow})`, err);
                return okResponse({ error: "Unable to update balance for OUI" }, 500);
            }
        }

        const existing = await listOuis(env);
        const existingSet = new Set((existing || []).map((o) => o.oui));

        const orgs = await fetchAllOuisFromApi();
        const newOrgs = orgs.filter((o) => !existingSet.has(o.oui));
        const newCount = newOrgs.length;

        await upsertOuis(env, orgs, startedAt);

        // Immediately capture balances for freshly synced OUIs (limited to avoid subrequest caps).
        const escrowCache = new Set();
        let balanceFetched = 0;
        let balanceSkipped = 0;
        const balanceTargets = newOrgs.slice(0, MAX_BALANCE_FETCH_PER_UPDATE);

        for (const org of balanceTargets) {
            if (!org.escrow || escrowCache.has(org.escrow)) {
                balanceSkipped++;
                continue;
            }
            escrowCache.add(org.escrow);
            try {
                const balanceDC = await fetchEscrowBalanceDC(env, org.escrow);
                await recordOuiBalance(env, org, balanceDC, todayDate, startedAt);
                balanceFetched++;
            } catch (err) {
                console.error(`Failed to fetch/store balance for OUI ${org.oui} (${org.escrow})`, err);
            }
        }

        return okResponse({
            ok: true,
            fetched: orgs.length,
            new: newCount,
            balances_recorded: balanceFetched,
            balances_skipped: balanceSkipped + Math.max(0, newOrgs.length - balanceTargets.length),
            updated_at: startedAt,
        });
    } catch (err) {
        console.error("Error in /update-ouis", err);
        return okResponse({ error: "Unable to update OUI index" }, 500);
    }
}
