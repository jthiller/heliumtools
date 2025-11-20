export const API_BASE = import.meta.env.DEV
  ? "/api/oui-notifier"
  : "https://api.heliumtools.org/oui-notifier";

async function parseJson(res) {
  try {
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function fetchOuiIndex() {
  const res = await fetch(`${API_BASE}/ouis`);
  if (!res.ok) {
    throw new Error("Unable to load OUIs");
  }
  const data = await parseJson(res);
  return Array.isArray(data?.orgs) ? data.orgs : [];
}

export async function fetchBalanceForOui(oui) {
  const query = new URLSearchParams({ oui: String(oui) });
  const res = await fetch(`${API_BASE}/balance?${query.toString()}`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data?.error || "Unable to fetch balance");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function subscribeToAlerts(payload) {
  const form = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.append(key, value);
    }
  });

  const res = await fetch(`${API_BASE}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || "Unable to save subscription");
  }

  return text || "Subscription saved. Check your inbox to verify your email.";
}
