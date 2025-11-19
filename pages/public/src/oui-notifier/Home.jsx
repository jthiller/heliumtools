import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon,
  CheckIcon,
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
});

const classNames = (...classes) => classes.filter(Boolean).join(" ");

function StatusBanner({ tone = "muted", title, message }) {
  const variants = {
    success: {
      wrapper: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100",
      icon: "text-emerald-600",
      Icon: CheckCircleIcon,
    },
    info: {
      wrapper: "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100",
      icon: "text-indigo-600",
      Icon: BellAlertIcon,
    },
    warning: {
      wrapper: "bg-amber-50 text-amber-900 ring-1 ring-amber-100",
      icon: "text-amber-600",
      Icon: ExclamationTriangleIcon,
    },
    error: {
      wrapper: "bg-rose-50 text-rose-900 ring-1 ring-rose-100",
      icon: "text-rose-600",
      Icon: ExclamationTriangleIcon,
    },
    muted: {
      wrapper: "bg-slate-50 text-slate-900 ring-1 ring-slate-200",
      icon: "text-slate-500",
      Icon: BellAlertIcon,
    },
  };

  const { wrapper, icon, Icon } = variants[tone] || variants.muted;

  if (!message) return null;

  return (
    <div className={classNames("flex gap-3 rounded-xl p-4 shadow-sm", wrapper)}>
      <Icon className={classNames("h-5 w-5 shrink-0", icon)} aria-hidden="true" />
      <div className="text-sm leading-6">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p>{message}</p>
      </div>
    </div>
  );
}

function MiddleTruncate({ text, startChars = 6, endChars = 6 }) {
  if (!text || text.length <= startChars + endChars + 3) {
    return <span>{text}</span>;
  }
  const start = text.slice(0, startChars);
  const end = text.slice(-endChars);
  return (
    <span title={text}>
      {start}
      <span className="text-slate-400">...</span>
      {end}
    </span>
  );
}

function SimpleTooltip({ content, children }) {
  return (
    <div className="group relative flex items-center">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 p-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100 z-10">
        {content}
        <div className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900"></div>
      </div>
    </div>
  );
}

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
      className="ml-2 inline-flex items-center text-slate-400 hover:text-indigo-600 transition-colors"
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

export default function HomePage() {
  const [ouis, setOuis] = useState([]);
  const [ouiInput, setOuiInput] = useState("");
  const [payer, setPayer] = useState("");
  const [escrow, setEscrow] = useState("");
  const [balance, setBalance] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [balanceStatus, setBalanceStatus] = useState({ tone: "muted", message: "" });
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [formStatus, setFormStatus] = useState({ tone: "muted", message: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const savedEmail = localStorage.getItem("ouiNotifierEmail");
    const savedEscrow = localStorage.getItem("ouiNotifierEscrow");
    if (savedEmail) setEmail(savedEmail);
    if (savedEscrow) setEscrow(savedEscrow);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await fetchOuiIndex();
        if (cancelled) return;
        setOuis(directory);
      } catch (err) {
        if (cancelled) return;
        console.error("Unable to load OUI list", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (email) {
      localStorage.setItem("ouiNotifierEmail", email);
    }
  }, [email]);

  const matchedOui = useMemo(() => {
    const numeric = Number(ouiInput);
    if (!Number.isInteger(numeric)) return null;
    return ouis.find((o) => o.oui === numeric) || null;
  }, [ouiInput, ouis]);

  // Debounced balance check
  useEffect(() => {
    const numericOui = Number(ouiInput);
    if (!ouiInput || !Number.isInteger(numericOui)) {
      setPayer("");
      setEscrow("");
      setBalance(null);
      setTimeseries([]);
      localStorage.removeItem("ouiNotifierEscrow");
      return;
    }

    // Optimistic update from directory
    if (matchedOui) {
      setPayer(matchedOui.payer || "");
      setEscrow(matchedOui.escrow || "");
      if (matchedOui.escrow) {
        localStorage.setItem("ouiNotifierEscrow", matchedOui.escrow);
      }
    }

    const timer = setTimeout(async () => {
      setLoadingBalance(true);
      try {
        const payload = await fetchBalanceForOui(numericOui);
        const dc = Number(payload.balance_dc || 0);
        const usd = Number(payload.balance_usd || 0);
        setBalance({ dc, usd });
        setTimeseries(payload.timeseries || []);

        if (payload.escrow) {
          setEscrow(payload.escrow);
          localStorage.setItem("ouiNotifierEscrow", payload.escrow);
        }
        // If we didn't have payer from directory, maybe we could get it here if API returned it,
        // but currently API mostly returns balance/escrow.
      } catch (err) {
        console.error("Failed to fetch balance", err);
        setBalance(null);
        setTimeseries([]);
      } finally {
        setLoadingBalance(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [ouiInput, matchedOui]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email) {
      setFormStatus({ tone: "error", message: "Enter an email address to subscribe." });
      return;
    }
    if (!escrow) {
      setFormStatus({
        tone: "error",
        message: "Look up your OUI so we can capture the escrow account before subscribing.",
      });
      return;
    }

    setSaving(true);
    setFormStatus({ tone: "info", message: "Saving your alert preferences…" });

    try {
      const message = await subscribeToAlerts({
        email,
        label: label || undefined,
        webhook_url: webhookUrl || undefined,
        escrow_account: escrow,
      });
      setFormStatus({ tone: "success", message });
    } catch (err) {
      setFormStatus({ tone: "error", message: err.message || "Unable to save subscription." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-indigo-600">OUI Notifier</p>
            <h1 className="text-2xl font-semibold text-slate-900">Helium DC Alerts</h1>
            <p className="text-sm text-slate-600">
              Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 space-y-6">
              <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-indigo-600">Lookup</p>
                    <h2 className="text-xl font-semibold text-slate-900">
                      Find your OUI
                    </h2>
                  </div>
                  {loadingBalance && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full">
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Fetching...
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="oui" className="text-sm font-semibold text-slate-800">
                      OUI Number
                    </label>
                    <input
                      id="oui"
                      name="oui"
                      type="number"
                      inputMode="numeric"
                      placeholder="e.g. 3"
                      list="oui-options"
                      value={ouiInput}
                      onChange={(e) => setOuiInput(e.target.value)}
                      className="block w-full rounded-xl border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <datalist id="oui-options">
                      {ouis.map((org) => (
                        <option
                          key={org.oui}
                          value={org.oui}
                          label={`OUI ${org.oui} • Payer ${org.payer || "n/a"}`}
                        />
                      ))}
                    </datalist>
                  </div>

                  <dl className="grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[0.5fr_1fr_1fr_1fr]">
                    <div className="space-y-1">
                      <dt className="text-sm font-semibold text-slate-800">OUI</dt>
                      <dd className="text-sm text-slate-700">
                        {ouiInput ? (
                          <span>{ouiInput}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                        Escrow account
                        <SimpleTooltip content="Helium uses this account to burn Data Credits as they are used. It is provided here as a link for direct reference. Do not send tokens here.">
                          <InformationCircleIcon className="h-4 w-4 text-slate-400 hover:text-slate-600 cursor-help" />
                        </SimpleTooltip>
                      </dt>
                      <dd className="text-sm text-slate-700">
                        {escrow ? (
                          <a
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-500 max-w-full"
                            href={`https://solscan.io/account/${encodeURIComponent(escrow)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MiddleTruncate text={escrow} startChars={6} endChars={6} />
                            <span aria-hidden="true" className="shrink-0">
                              ↗
                            </span>
                          </a>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                        Payer
                        <SimpleTooltip content="This key is used when delegating tokens to your OUI. Tokens must be _delegated_ to this address in order to appear in the escrow account.">
                          <InformationCircleIcon className="h-4 w-4 text-slate-400 hover:text-slate-600 cursor-help" />
                        </SimpleTooltip>
                      </dt>
                      <dd className="text-sm text-slate-700 flex items-center">
                        {payer ? (
                          <>
                            <MiddleTruncate text={payer} startChars={6} endChars={6} />
                            <CopyButton text={payer} />
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="space-y-1 overflow-hidden">
                      <dt className="text-sm font-semibold text-slate-800">Balance</dt>
                      <dd className="text-sm text-slate-700">
                        {balance ? (
                          <div className="space-y-0.5 text-sm font-semibold text-slate-900">
                            <p className={balance.usd > 35 ? 'text-green-600' : 'text-slate-600'}>
                              {usdFormatter.format(balance.usd)}
                            </p>
                            <p>{numberFormatter.format(balance.dc)} DC</p>
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/60 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-indigo-900">Heads up</p>
                    <p className="mt-1">
                      Data transfer halts when an escrow hits $35 (3,500,000 DC). Alerts treat that
                      as zero to keep you ahead of the cutoff.
                    </p>
                  </div>
                </div>
              </div>

              {timeseries.length > 0 && (
                <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
                  <h3 className="text-base font-semibold text-slate-900 mb-4">
                    30-Day DC Balance History
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={timeseries}
                        margin={{ top: 5, right: 0, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorDc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 12, fill: "#64748b" }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={30}
                          tickFormatter={(str) => {
                            const d = new Date(str);
                            return `${d.getMonth() + 1}/${d.getDate()}`;
                          }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: "#64748b" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(val) =>
                            val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "8px",
                            border: "none",
                            boxShadow:
                              "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
                          }}
                          formatter={(val) => [numberFormatter.format(val), "DC"]}
                          labelFormatter={(label) => new Date(label).toLocaleDateString()}
                        />
                        <Area
                          type="monotone"
                          dataKey="balance_dc"
                          stroke="#4f46e5"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorDc)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100 h-fit">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-indigo-600">Subscribe</p>
                <h2 className="text-xl font-semibold text-slate-900">Email + webhook alerts</h2>
                <p className="text-sm text-slate-600">
                  Daily balance snapshots and 7-day burn estimates trigger alerts at 14, 7, and 1
                  day from running out.
                </p>
              </div>
              <div className="mt-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 w-fit">
                {API_BASE.replace("https://", "")}
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-semibold text-slate-800">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <EnvelopeIcon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-xl border-slate-200 bg-white px-3 py-2.5 pl-10 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="label" className="text-sm font-semibold text-slate-800">
                    Label (optional)
                  </label>
                  <input
                    id="label"
                    name="label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="block w-full rounded-xl border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Prod IoT OUI"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="webhook" className="text-sm font-semibold text-slate-800">
                    Webhook URL (optional)
                  </label>
                  <input
                    id="webhook"
                    name="webhook_url"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="block w-full rounded-xl border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="https://example.com/helium-webhook"
                  />
                </div>

                <input type="hidden" name="escrow_account" value={escrow} />

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden="true" />
                      Saving subscription…
                    </>
                  ) : (
                    <>
                      <BellAlertIcon className="h-5 w-5" aria-hidden="true" />
                      Subscribe to alerts
                    </>
                  )}
                </button>

                <StatusBanner tone={formStatus.tone} message={formStatus.message} />
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
