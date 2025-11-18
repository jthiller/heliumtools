import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
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

export default function HomePage() {
  const [ouis, setOuis] = useState([]);
  const [ouiInput, setOuiInput] = useState("");
  const [payer, setPayer] = useState("");
  const [escrow, setEscrow] = useState("");
  const [balance, setBalance] = useState(null);
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
        setBalanceStatus({ tone: "info", message: "Live OUI directory loaded." });
      } catch (err) {
        if (cancelled) return;
        setBalanceStatus({
          tone: "warning",
          message: "Unable to load the OUI list right now. Manual entry still works.",
        });
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

  useEffect(() => {
    if (!ouiInput) return;
    if (matchedOui) {
      setPayer(matchedOui.payer || "");
      setEscrow(matchedOui.escrow || "");
      setBalance(null);
      setBalanceStatus({
        tone: "info",
        message: `Loaded details for OUI ${matchedOui.oui}. Click Check balance to fetch live DC.`,
      });
      if (matchedOui.escrow) {
        localStorage.setItem("ouiNotifierEscrow", matchedOui.escrow);
      }
    } else {
      setPayer("");
      setEscrow("");
      setBalance(null);
      localStorage.removeItem("ouiNotifierEscrow");
    }
  }, [matchedOui, ouiInput]);

  const handleCheckBalance = async () => {
    if (!ouiInput) {
      setBalanceStatus({ tone: "warning", message: "Enter an OUI number to check balance." });
      return;
    }

    setLoadingBalance(true);
    setBalanceStatus({ tone: "info", message: "Fetching live balance and escrow…" });
    setBalance(null);

    try {
      const payload = await fetchBalanceForOui(ouiInput);
      const dc = Number(payload.balance_dc || 0);
      const usd = Number(payload.balance_usd || 0);
      setBalance({ dc, usd });

      if (payload.escrow) {
        setEscrow(payload.escrow);
        localStorage.setItem("ouiNotifierEscrow", payload.escrow);
      }

      setBalanceStatus({ tone: "success", message: `Live balance for OUI ${ouiInput} loaded.` });
    } catch (err) {
      setBalance(null);
      setBalanceStatus({ tone: "error", message: err.message || "Could not fetch balance." });
    } finally {
      setLoadingBalance(false);
    }
  };

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
            <h1 className="text-2xl font-semibold text-slate-900">Helium DC alerts</h1>
            <p className="text-sm text-slate-600">
              Lookup OUIs, fetch live balances, and subscribe to email or webhook alerts.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-indigo-600">Lookup</p>
                  <h2 className="text-xl font-semibold text-slate-900">Find your escrow and check live DC</h2>
                </div>
                <StatusBanner tone={balanceStatus.tone} message={balanceStatus.message} />
              </div>

              <div className="mt-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-[1.1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <label htmlFor="oui" className="text-sm font-semibold text-slate-800">
                      OUI number
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
                          label={`OUI ${org.oui} • payer ${org.payer || "n/a"} • escrow ${org.escrow}`}
                        />
                      ))}
                    </datalist>
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckBalance}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 md:w-auto"
                  >
                    {loadingBalance ? (
                      <>
                        <ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden="true" />
                        Checking balance…
                      </>
                    ) : (
                      <>
                        <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />
                        Check live DC balance
                      </>
                    )}
                  </button>
                </div>

                <dl className="grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                  <div className="space-y-1">
                    <dt className="text-sm font-semibold text-slate-800">Escrow account</dt>
                    <dd className="text-sm text-slate-700 break-all">
                      {escrow ? (
                        <a
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-500"
                          href={`https://solscan.io/account/${encodeURIComponent(escrow)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="truncate">{escrow}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-slate-500">Lookup an OUI to populate the escrow.</span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm font-semibold text-slate-800">Payer</dt>
                    <dd className="text-sm text-slate-700 break-all">
                      {payer || <span className="text-slate-500">—</span>}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm font-semibold text-slate-800">Live balance</dt>
                    <dd className="text-sm text-slate-700">
                      {balance ? (
                        <div className="space-y-0.5 text-sm font-semibold text-slate-900">
                          <p>{numberFormatter.format(balance.dc)} DC</p>
                          <p className="text-slate-600">{usdFormatter.format(balance.usd)}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Not fetched yet</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/60 p-4 text-sm text-slate-700">
                  <p className="font-semibold text-indigo-900">Heads up</p>
                  <p className="mt-1">
                    Data transfer halts when an escrow hits roughly $35 (≈3,500,000 DC). Alerts treat that as zero to
                    keep you ahead of the cutoff.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-indigo-600">Subscribe</p>
                <h2 className="text-xl font-semibold text-slate-900">Email + webhook alerts</h2>
                <p className="text-sm text-slate-600">
                  Daily balance snapshots and 7-day burn estimates trigger alerts at 14, 7, and 1 day from running out.
                </p>
              </div>
              <div className="mt-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
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
