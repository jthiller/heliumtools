import { listOuis } from "../services/ouis.js";
import { okResponse } from "../responseUtils.js";

export async function handleListOuis(env) {
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
