import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  EnvelopeIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  TrashIcon,
  PencilIcon,
  XMarkIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import MiddleEllipsis from "react-middle-ellipsis";
import { classNames } from "../lib/utils.js";
import {
  API_BASE,
  fetchBalanceForOui,
  fetchOuiIndex,
  subscribeToAlerts,
} from "../lib/api.js";

const numberFormatter = new Intl.NumberFormat("en-US");
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
  roundingMode: "floor",
});

// Tailwind color values for chart (matches slate and sky palettes)
const CHART_COLORS = {
  stroke: "#0ea5e9",      // sky-500
  grid: "#e2e8f0",        // slate-200
  tickText: "#94a3b8",    // slate-400
  tooltipBorder: "#e2e8f0", // slate-200
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center text-slate-400 hover:text-slate-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-emerald-500" />
      ) : (
        <ClipboardDocumentIcon className="h-4 w-4" />
      )}
    </button>
  );
}

// Standard input class for consistency
const inputClassName = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20";

export default function HomePage() {
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
    const savedEmail = localStorage.getItem("ouiNotifierEmail");
    if (savedEmail) setEmail(savedEmail);

    const params = new URLSearchParams(window.location.search);
    const uuid = params.get("uuid");
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
    if (email) localStorage.setItem("ouiNotifierEmail", email);
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
    if (balance?.usd != null && burnRate?.burn1dUSD > 0) {
      return Math.max(0, (balance.usd - 35) / burnRate.burn1dUSD);
    }
    return null;
  }, [balance, burnRate]);

  const getDaysColor = (days) => {
    if (days === null) return "text-slate-300";
    if (days <= 7) return "text-red-600";
    if (days <= 14) return "text-amber-500";
    return "text-emerald-600";
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
      const res = await fetch(`${API_BASE}/api/user/${userUuid}`, { method: "DELETE" });
      if (res.ok) {
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
    <div className="min-h-screen bg-white">
      <Header />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Page Header */}
        <div className="mb-8">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-1">OUI Notifier</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Helium Data Credit Alerts</h1>
        </div>

        {/* Main Grid: Content + Sidebar */}
        <div className="grid lg:grid-cols-[1fr,340px] gap-8 lg:gap-12">

          {/* Left Column: OUI Data */}
          <div className="space-y-8">
            {/* OUI Input + Balance/Days Grid */}
            <div className="space-y-6">
              {/* OUI Input */}
              <div>
                <label htmlFor="oui" className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2 block">
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
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xl font-semibold text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  {loadingBalance && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <ArrowPathIcon className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  )}
                </div>
                <datalist id="oui-options">
                  {ouis.map((org) => <option key={org.oui} value={org.oui} />)}
                </datalist>
              </div>

              {/* Metrics Row */}
              <div className="grid sm:grid-cols-2 gap-px bg-slate-200 rounded-xl overflow-hidden">
                <div className="bg-white p-6">
                  <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">Balance</p>
                  <p className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
                    {balance ? usdFormatter.format(balance.usd) : '—'}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    {balance ? `${numberFormatter.format(balance.dc)} DC` : 'Enter OUI above'}
                  </p>
                </div>
                <div className="bg-white p-6">
                  <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">Days Remaining</p>
                  <p className={classNames("text-3xl sm:text-4xl font-bold tracking-tight", getDaysColor(daysRemaining))}>
                    {daysRemaining !== null ? (() => { const rounded = Math.round(daysRemaining * 10) / 10; return rounded % 1 === 0 ? rounded : rounded.toFixed(1); })() : '—'}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    {burnRate?.burn1dUSD != null ? `at ${usdFormatter.format(burnRate.burn1dUSD)}/day` : 'Waiting for data'}
                  </p>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-slate-50 rounded-xl p-6">
              <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-4">30-Day History</p>
              <div className="h-40">
                {timeseries.length > 5 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeseries} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.stroke} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={CHART_COLORS.stroke} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                      <YAxis domain={["dataMin", "dataMax"]} hide />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: CHART_COLORS.tickText }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                        tickFormatter={(str) => { const d = new Date(str); return `${d.getMonth() + 1}/${d.getDate()}`; }}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: `1px solid ${CHART_COLORS.tooltipBorder}`, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: "13px" }}
                        formatter={(val) => [usdFormatter.format(val), "Balance"]}
                        labelFormatter={(label) => new Date(label).toLocaleDateString()}
                      />
                      <Area type="monotone" dataKey="balance_usd" stroke={CHART_COLORS.stroke} strokeWidth={2} fill="url(#balanceGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">
                    Enter an OUI to see balance history
                  </div>
                )}
              </div>
            </div>

            {/* Account Details */}
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2">
                  Payer Key {ouiInput && <span className="text-slate-300">· OUI {ouiInput}</span>}
                </p>
                {payer ? (
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <MiddleEllipsis>
                        <code className="text-sm text-slate-700" title={payer}>{payer}</code>
                      </MiddleEllipsis>
                    </div>
                    <CopyButton text={payer} />
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">—</p>
                )}
                <p className="text-xs text-slate-400 mt-2">Delegate DC to this address to top up.</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2">Escrow Account</p>
                {escrow ? (
                  <a
                    className="text-sm text-sky-600 hover:text-sky-500 inline-flex items-center gap-1 max-w-full"
                    href={`https://solscan.io/account/${encodeURIComponent(escrow)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="min-w-0 overflow-hidden">
                      <MiddleEllipsis>
                        <code title={escrow}>{escrow}</code>
                      </MiddleEllipsis>
                    </span>
                    <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                  </a>
                ) : (
                  <p className="text-sm text-slate-400">—</p>
                )}
                <p className="text-xs text-slate-400 mt-2">View on Solscan. Do not send tokens directly.</p>
              </div>
            </div>

            {/* User Subscriptions (conditional) */}
            {userUuid && userSubscriptions.length > 0 && (
              <div className="border-t border-slate-200 pt-8">
                <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2">Your Subscriptions</p>
                <h2 className="text-xl font-bold text-slate-900 mb-4">Manage Alerts</h2>

                {subscriptionError && (
                  <div className="mb-4">
                    <StatusBanner tone="error" message={subscriptionError} />
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">OUI</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Label</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Webhook</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {userSubscriptions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm">
                            <button onClick={() => setOuiInput(sub.oui?.toString() || "")} className="text-sky-600 hover:underline font-medium">
                              {sub.oui ? `OUI ${sub.oui}` : "—"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {editingSubId === sub.id ? (
                              <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className={inputClassName} />
                            ) : (
                              sub.label || <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {editingSubId === sub.id ? (
                              <input type="text" value={editWebhook} onChange={(e) => setEditWebhook(e.target.value)} className={inputClassName} />
                            ) : (
                              sub.webhook_url ? "Configured" : <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {editingSubId === sub.id ? (
                              <div className="flex justify-end gap-2">
                                <button onClick={() => handleUpdateSubscription(sub.id)} aria-label="Save changes" title="Save changes" className="text-emerald-600 hover:text-emerald-500"><CheckIcon className="h-4 w-4" /></button>
                                <button onClick={() => setEditingSubId(null)} aria-label="Cancel editing" title="Cancel editing" className="text-slate-400 hover:text-slate-600"><XMarkIcon className="h-4 w-4" /></button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button onClick={() => { setEditingSubId(sub.id); setEditLabel(sub.label || ""); setEditWebhook(sub.webhook_url || ""); }} aria-label="Edit subscription" title="Edit subscription" className="text-slate-400 hover:text-slate-600"><PencilIcon className="h-4 w-4" /></button>
                                <button onClick={() => handleDeleteSubscription(sub.id)} aria-label="Delete subscription" title="Delete subscription" className="text-rose-400 hover:text-rose-600"><TrashIcon className="h-4 w-4" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4">
                  <button onClick={handleDeleteUser} className="text-xs text-rose-600 hover:text-rose-500 hover:underline">
                    Delete my account and all data
                  </button>
                </div>
              </div>
            )}

            {/* Info Footer */}
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">Important</p>
              <p>Data transfer halts when escrow reaches $35 (3,500,000 DC). Alerts treat this as zero.</p>
              <a href="https://docs.helium.com/iot/run-an-lns/fund-an-oui/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-900 hover:text-amber-700 font-medium mt-2">
                Learn how to fund your OUI <ArrowRightIcon className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Right Column: Persistent Subscribe Sidebar */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-1">Subscribe</p>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Get Notified</h2>
              <p className="text-sm text-slate-600 mb-6">
                Email alerts at 14, 7, and 1 day remaining. Optional daily webhook.
              </p>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <EnvelopeIcon className="h-4 w-4" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="label" className="block text-sm font-medium text-slate-700 mb-1">
                    Label <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    placeholder="e.g. Prod OUI"
                  />
                </div>

                <div>
                  <label htmlFor="webhook" className="block text-sm font-medium text-slate-700 mb-1">
                    Webhook <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="webhook"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    placeholder="https://..."
                  />
                </div>

                <input type="hidden" name="escrow_account" value={escrow} />

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50"
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
