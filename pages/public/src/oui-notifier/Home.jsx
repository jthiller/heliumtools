import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  EnvelopeIcon,
  TrashIcon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import Tooltip from "../components/Tooltip.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import MiddleEllipsis from "react-middle-ellipsis";
import { classNames, usdFormatter, numberFormatter, getLocalStorageItem, setLocalStorageItem, removeLocalStorageItem } from "../lib/utils.js";
import {
  API_BASE,
  fetchBalanceForOui,
  fetchOuiIndex,
  subscribeToAlerts,
} from "../lib/api.js";
import useDarkMode from "../lib/useDarkMode.js";

// Read CSS custom properties (stored as RGB channels) for Recharts (needs hex)
function getChartColors() {
  const style = getComputedStyle(document.documentElement);
  const hex = (name) => {
    const [r, g, b] = style.getPropertyValue(name).trim().split(/\s+/).map(Number);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };
  return {
    stroke: hex("--color-accent-text"),
    grid: hex("--color-border"),
    tickText: hex("--color-content-tertiary"),
    tooltipBorder: hex("--color-border"),
    tooltipBg: hex("--color-surface-raised"),
    tooltipText: hex("--color-content"),
  };
}

// Standard input class for consistency
const inputClassName = "block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export default function HomePage() {
  const isDark = useDarkMode();
  // Re-read computed CSS values when theme changes
  const chartColors = useMemo(getChartColors, [isDark]);
  const [ouis, setOuis] = useState([]);
  const [ouiInput, setOuiInput] = useState("");
  const [payer, setPayer] = useState("");
  const [escrow, setEscrow] = useState("");
  const [balance, setBalance] = useState(null);
  const [burnRate, setBurnRate] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [formStatus, setFormStatus] = useState({ tone: "muted", message: "" });
  const [saving, setSaving] = useState(false);

  const [userUuid, setUserUuid] = useState(null);
  const [userSubscriptions, setUserSubscriptions] = useState([]);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [editingSubId, setEditingSubId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editWebhook, setEditWebhook] = useState("");

  useEffect(() => {
    const savedEmail = getLocalStorageItem("ouiNotifierEmail");
    if (savedEmail) setEmail(savedEmail);

    const params = new URLSearchParams(window.location.search);
    let uuid = params.get("uuid");

    // If no UUID in URL, check localStorage for a stored session
    if (!uuid) {
      const storedUuid = getLocalStorageItem("ouiNotifierUuid");
      if (storedUuid) {
        uuid = storedUuid;
      }
    } else {
      // Store UUID from URL in localStorage for future visits, then strip from URL
      setLocalStorageItem("ouiNotifierUuid", uuid);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("uuid");
      window.history.replaceState({}, "", cleanUrl.toString());
    }

    if (uuid) {
      setUserUuid(uuid);
      fetchUserData(uuid);
    }

    // Show success message if account was just deleted
    if (params.get("deleted") === "1") {
      setFormStatus({ tone: "success", message: "Your account and all data have been deleted." });
      // Clean up the URL
      window.history.replaceState({}, "", "/oui-notifier/");
    }
  }, []);

  const fetchUserData = async (uuid) => {
    try {
      const res = await fetch(`${API_BASE}/api/user/${uuid}`);
      if (res.ok) {
        const data = await res.json();
        setUserSubscriptions(data.subscriptions);
        if (data.subscriptions.length > 0 && data.subscriptions[0].oui) {
          setOuiInput(data.subscriptions[0].oui.toString());
        }
      } else {
        // UUID is no longer valid (user may have been deleted)
        removeLocalStorageItem("ouiNotifierUuid");
        setUserUuid(null);
        // Clean up the URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete("uuid");
        window.history.replaceState({}, "", newUrl.toString());
      }
    } catch (err) {
      console.error("Error fetching user data", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await fetchOuiIndex();
        if (!cancelled) setOuis(directory);
      } catch (err) {
        if (!cancelled) console.error("Unable to load OUI list", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (email) setLocalStorageItem("ouiNotifierEmail", email);
  }, [email]);

  const matchedOui = useMemo(() => {
    const numeric = Number(ouiInput);
    if (!Number.isInteger(numeric)) return null;
    return ouis.find((o) => o.oui === numeric) || null;
  }, [ouiInput, ouis]);

  useEffect(() => {
    const numericOui = Number(ouiInput);
    if (!ouiInput || !Number.isInteger(numericOui)) {
      setPayer("");
      setEscrow("");
      setBalance(null);
      setBurnRate(null);
      setTimeseries([]);
      return;
    }

    if (matchedOui) {
      setPayer(matchedOui.payer || "");
      setEscrow(matchedOui.escrow || "");
    }

    const timer = setTimeout(async () => {
      setLoadingBalance(true);
      try {
        const payload = await fetchBalanceForOui(numericOui);
        setBalance({ dc: Number(payload.balance_dc || 0), usd: Number(payload.balance_usd || 0) });
        if (payload.burn_rate) {
          setBurnRate({
            burn1dDC: payload.burn_rate.burn_1d_dc,
            burn1dUSD: payload.burn_rate.burn_1d_usd,
            burn30dDC: payload.burn_rate.burn_30d_dc,
            burn30dUSD: payload.burn_rate.burn_30d_usd,
          });
        } else {
          setBurnRate(null);
        }
        setTimeseries((payload.timeseries || []).map((t) => ({ ...t, balance_usd: t.balance_dc * 0.00001 })));
        if (payload.escrow) setEscrow(payload.escrow);
      } catch (err) {
        console.error("Failed to fetch balance", err);
        setBalance(null);
        setBurnRate(null);
        setTimeseries([]);
      } finally {
        setLoadingBalance(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [ouiInput, matchedOui]);

  const daysRemaining = useMemo(() => {
    if (balance?.usd != null && burnRate) {
      const effectiveBurn = Math.max(burnRate.burn30dUSD || 0, burnRate.burn1dUSD || 0);
      if (effectiveBurn > 0) {
        return Math.max(0, (balance.usd - 35) / effectiveBurn);
      }
    }
    return null;
  }, [balance, burnRate]);

  const getDaysColor = (days) => {
    if (days === null) return "text-content-tertiary";
    if (days <= 7) return "text-red-600 dark:text-red-400";
    if (days <= 14) return "text-amber-500 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email) {
      setFormStatus({ tone: "error", message: "Enter an email address." });
      return;
    }
    if (!escrow) {
      setFormStatus({ tone: "error", message: "Look up your OUI first." });
      return;
    }

    setSaving(true);
    setFormStatus({ tone: "loading", message: "Saving…" });

    try {
      const message = await subscribeToAlerts({ email, label: label || undefined, webhook_url: webhookUrl || undefined, escrow_account: escrow });
      setFormStatus({ tone: "success", message });
      if (userUuid) fetchUserData(userUuid);
    } catch (err) {
      setFormStatus({ tone: "error", message: err.message || "Unable to save." });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubscription = async (id) => {
    if (!confirm("Delete this subscription?")) return;
    setSubscriptionError("");
    try {
      const res = await fetch(`${API_BASE}/api/subscription/${id}`, { method: "DELETE", headers: { "X-User-Uuid": userUuid } });
      if (res.ok) {
        setUserSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
      } else {
        setSubscriptionError("Failed to delete subscription. Please try again.");
      }
    } catch (err) {
      console.error("Error deleting subscription", err);
      setSubscriptionError("Failed to delete subscription. Please try again.");
    }
  };

  const handleUpdateSubscription = async (id) => {
    setSubscriptionError("");
    try {
      const res = await fetch(`${API_BASE}/api/subscription/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Uuid": userUuid },
        body: JSON.stringify({ label: editLabel, webhook_url: editWebhook }),
      });
      if (res.ok) {
        setUserSubscriptions((prev) => prev.map((sub) => sub.id === id ? { ...sub, label: editLabel, webhook_url: editWebhook } : sub));
        setEditingSubId(null);
      } else {
        setSubscriptionError("Failed to update subscription. Please try again.");
      }
    } catch (err) {
      console.error("Error updating subscription", err);
      setSubscriptionError("Failed to update subscription. Please try again.");
    }
  };

  const handleDeleteUser = async () => {
    if (!confirm("Delete your account and all subscriptions?")) return;
    setSubscriptionError("");
    try {
      const res = await fetch(`${API_BASE}/api/user/${userUuid}`, { method: "DELETE", headers: { "X-User-Uuid": userUuid } });
      if (res.ok) {
        // Clear stored session data
        removeLocalStorageItem("ouiNotifierUuid");
        removeLocalStorageItem("ouiNotifierEmail");
        window.location.href = "/oui-notifier/?deleted=1";
      } else {
        setSubscriptionError("Failed to delete account. Please try again.");
      }
    } catch (err) {
      console.error("Error deleting account", err);
      setSubscriptionError("Failed to delete account. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="OUI Notifier" />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-10">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">OUI Notifier</p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-2">Data Credit Alerts</h1>
          <p className="text-base text-content-secondary">Monitor escrow balances and get notified before they run out.</p>
        </div>

        {/* Main Grid: Content + Sidebar */}
        <div className="grid lg:grid-cols-[1fr,340px] gap-8 lg:gap-12">

          {/* Left Column: OUI Data */}
          <div className="space-y-8">
            {/* OUI Input + Balance/Days Grid */}
            <div className="space-y-6">
              {/* OUI Input */}
              <div>
                <label htmlFor="oui" className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-2 block">
                  OUI Number
                </label>
                <div className="relative">
                  <input
                    id="oui"
                    type="number"
                    inputMode="numeric"
                    placeholder="Enter OUI"
                    list="oui-options"
                    value={ouiInput}
                    onChange={(e) => setOuiInput(e.target.value)}
                    className="block w-full rounded-lg border border-border bg-surface-inset px-4 py-3 text-xl font-semibold text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  {loadingBalance && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <ArrowPathIcon className="h-5 w-5 animate-spin text-content-tertiary" />
                    </div>
                  )}
                </div>
                <datalist id="oui-options">
                  {ouis.map((org) => <option key={org.oui} value={org.oui} />)}
                </datalist>
              </div>

              {/* Metrics Row */}
              <div className="grid sm:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden">
                <div className="bg-surface-raised p-6">
                  <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Balance</p>
                  <p className="text-3xl sm:text-4xl font-bold text-content tracking-tight">
                    {balance ? usdFormatter.format(balance.usd) : '—'}
                  </p>
                  <p className="text-sm text-content-secondary mt-1">
                    {balance ? `${numberFormatter.format(balance.dc)} DC` : 'Enter OUI above'}
                  </p>
                </div>
                <div className="bg-surface-raised p-6">
                  <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Days Remaining</p>
                  <p className={classNames("text-3xl sm:text-4xl font-bold tracking-tight", getDaysColor(daysRemaining))}>
                    {daysRemaining !== null ? (() => { const rounded = Math.round(daysRemaining * 10) / 10; return rounded % 1 === 0 ? rounded : rounded.toFixed(1); })() : '—'}
                  </p>
                  <p className="text-sm text-content-secondary mt-1">
                    {burnRate ? `at ${usdFormatter.format(Math.max(burnRate.burn30dUSD || 0, burnRate.burn1dUSD || 0))}/day` : 'Waiting for data'}
                  </p>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-surface-inset rounded-xl p-6">
              <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-4">30-Day History</p>
              <div className="h-40">
                {timeseries.length > 5 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeseries} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chartColors.stroke} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={chartColors.stroke} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.grid} />
                      <YAxis domain={["dataMin", "dataMax"]} hide />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: chartColors.tickText }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                        tickFormatter={(str) => { const d = new Date(str); return `${d.getMonth() + 1}/${d.getDate()}`; }}
                      />
                      <ChartTooltip
                        contentStyle={{ borderRadius: "8px", border: `1px solid ${chartColors.tooltipBorder}`, backgroundColor: chartColors.tooltipBg, color: chartColors.tooltipText, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: "13px" }}
                        formatter={(val) => [usdFormatter.format(val), "Balance"]}
                        labelFormatter={(label) => new Date(label).toLocaleDateString()}
                      />
                      <Area type="monotone" dataKey="balance_usd" stroke={chartColors.stroke} strokeWidth={2} fill="url(#balanceGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-content-tertiary">
                    Enter an OUI to see balance history
                  </div>
                )}
              </div>
            </div>

            {/* Account Details */}
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-2">
                  Payer Key {ouiInput && <span className="text-content-tertiary">· OUI {ouiInput}</span>}
                </p>
                {payer ? (
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <Tooltip content={payer}>
                        <MiddleEllipsis>
                          <code className="text-sm text-content-secondary">{payer}</code>
                        </MiddleEllipsis>
                      </Tooltip>
                    </div>
                    <CopyButton text={payer} />
                  </div>
                ) : (
                  <p className="text-sm text-content-tertiary">—</p>
                )}
                <p className="text-xs text-content-tertiary mt-2">Delegate DC to this address to top up.</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-2">Escrow Account</p>
                {escrow ? (
                  <a
                    className="text-sm text-accent-text hover:opacity-80 inline-flex items-center gap-1 max-w-full"
                    href={`https://solscan.io/account/${encodeURIComponent(escrow)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="min-w-0 overflow-hidden">
                      <Tooltip content={escrow}>
                        <MiddleEllipsis>
                          <code>{escrow}</code>
                        </MiddleEllipsis>
                      </Tooltip>
                    </span>
                    <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                  </a>
                ) : (
                  <p className="text-sm text-content-tertiary">—</p>
                )}
                <p className="text-xs text-content-tertiary mt-2">View on Solscan. Do not send tokens directly.</p>
              </div>
            </div>

            {/* User Subscriptions (conditional) */}
            {userUuid && userSubscriptions.length > 0 && (
              <div className="border-t border-border pt-8">
                <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-2">Your Subscriptions</p>
                <h2 className="text-xl font-bold text-content mb-4">Manage Alerts</h2>

                {subscriptionError && (
                  <div className="mb-4">
                    <StatusBanner tone="error" message={subscriptionError} />
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-surface-inset">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider">OUI</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider">Label</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider">Webhook</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface-raised divide-y divide-border-muted">
                      {userSubscriptions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-surface-inset/50">
                          <td className="px-4 py-3 text-sm">
                            <button onClick={() => setOuiInput(sub.oui?.toString() || "")} className="text-accent-text hover:underline font-medium">
                              {sub.oui ? `OUI ${sub.oui}` : "—"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-content-secondary">
                            {editingSubId === sub.id ? (
                              <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className={inputClassName} />
                            ) : (
                              sub.label || <span className="text-content-tertiary">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-content-secondary">
                            {editingSubId === sub.id ? (
                              <input type="text" value={editWebhook} onChange={(e) => setEditWebhook(e.target.value)} className={inputClassName} />
                            ) : (
                              sub.webhook_url ? "Configured" : <span className="text-content-tertiary">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {editingSubId === sub.id ? (
                              <div className="flex justify-end gap-2">
                                <Tooltip content="Save changes"><button onClick={() => handleUpdateSubscription(sub.id)} aria-label="Save changes" className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"><CheckIcon className="h-4 w-4" /></button></Tooltip>
                                <Tooltip content="Cancel editing"><button onClick={() => setEditingSubId(null)} aria-label="Cancel editing" className="text-content-tertiary hover:text-content-secondary"><XMarkIcon className="h-4 w-4" /></button></Tooltip>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Tooltip content="Edit subscription"><button onClick={() => { setEditingSubId(sub.id); setEditLabel(sub.label || ""); setEditWebhook(sub.webhook_url || ""); }} aria-label="Edit subscription" className="text-content-tertiary hover:text-content-secondary"><PencilIcon className="h-4 w-4" /></button></Tooltip>
                                <Tooltip content="Delete subscription"><button onClick={() => handleDeleteSubscription(sub.id)} aria-label="Delete subscription" className="text-rose-400 hover:text-rose-600 dark:text-rose-500 dark:hover:text-rose-400"><TrashIcon className="h-4 w-4" /></button></Tooltip>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4">
                  <button onClick={handleDeleteUser} className="text-xs text-rose-600 hover:text-rose-500 dark:text-rose-400 hover:underline">
                    Delete my account and all data
                  </button>
                </div>
              </div>
            )}

            {/* Info Footer */}
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-300">
              <p className="font-medium mb-1">Important</p>
              <p>Data transfer halts when escrow reaches $35 (3,500,000 DC). Alerts treat this as zero.</p>
              <a href="https://docs.helium.com/iot/run-an-lns/fund-an-oui/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-900 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100 font-medium mt-2">
                Learn how to fund your OUI <ArrowRightIcon className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Right Column: Persistent Subscribe Sidebar */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="bg-surface-inset rounded-xl p-6 border border-border">
              <p className="text-sm font-mono uppercase tracking-widest text-accent-text mb-1">Subscribe</p>
              <h2 className="text-lg font-bold text-content mb-1">Get Notified</h2>
              <p className="text-sm text-content-secondary mb-6">
                Email alerts at 14, 7, and 1 day remaining. Optional daily webhook.
              </p>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-content-secondary mb-1">Email</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-tertiary">
                      <EnvelopeIcon className="h-4 w-4" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pl-9 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="label" className="block text-sm font-medium text-content-secondary mb-1">
                    Label <span className="text-content-tertiary font-normal">(optional)</span>
                  </label>
                  <input
                    id="label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="block w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="e.g. Prod OUI"
                  />
                </div>

                <div>
                  <label htmlFor="webhook" className="block text-sm font-medium text-content-secondary mb-1">
                    Webhook <span className="text-content-tertiary font-normal">(optional)</span>
                  </label>
                  <input
                    id="webhook"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="block w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="https://..."
                  />
                </div>

                <input type="hidden" name="escrow_account" value={escrow} />

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? (
                    <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Saving…</>
                  ) : (
                    <><BellAlertIcon className="h-4 w-4" /> Subscribe</>
                  )}
                </button>

                <StatusBanner tone={formStatus.tone} message={formStatus.message} />
              </form>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
