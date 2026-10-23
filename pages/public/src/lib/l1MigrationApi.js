import { parseJson } from "./api.js";

const API_BASE = import.meta.env?.DEV
  ? "/api/l1-migration"
  : "https://api.heliumtools.org/l1-migration";

// No signal, on purpose: the migration broadcasts transactions, so once sent
// it runs to completion rather than being cut off mid-broadcast by a
// disconnect (re-running finishes an interrupted one, but the page should
// report what was sent).
export async function migrateWallet(wallet) {
  const res = await fetch(`${API_BASE}/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}
