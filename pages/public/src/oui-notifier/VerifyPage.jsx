import { useEffect, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { API_BASE } from "../lib/api.js";
import Header from "../components/Header.jsx";

const classNames = (...classes) => classes.filter(Boolean).join(" ");

function StatusBanner({ tone = "info", message }) {
  if (!message) return null;
  const config = {
    success: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", Icon: CheckCircleIcon },
    error: { bg: "bg-rose-50 border-rose-200", text: "text-rose-800", Icon: ExclamationTriangleIcon },
    info: { bg: "bg-sky-50 border-sky-200", text: "text-sky-800", Icon: ArrowPathIcon },
  };
  const { bg, text, Icon } = config[tone] || config.info;

  return (
    <div className={classNames("flex gap-3 rounded-lg border p-4", bg)}>
      <Icon className={classNames("h-5 w-5 shrink-0", text)} aria-hidden="true" />
      <p className={classNames("text-sm", text)}>{message}</p>
    </div>
  );
}

export default function VerifyPage() {
  const [state, setState] = useState({ tone: "info", message: "Verifying your email…" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified");
    const token = params.get("token");
    const email = params.get("email");
    const uuid = params.get("uuid");

    if (verified === "1") {
      setState({ tone: "success", message: "Your email has been verified. You are now subscribed.", uuid });
      return;
    }

    if (!token || !email) {
      setState({
        tone: "error",
        message: "The verification link is missing required details. Please try subscribing again.",
      });
      return;
    }

    const redirectTarget = `${window.location.origin}${window.location.pathname}`;
    const url = new URL(`${API_BASE}/verify`);
    url.searchParams.set("token", token);
    url.searchParams.set("email", email);
    url.searchParams.set("redirect", redirectTarget);

    setState({ tone: "info", message: "Contacting verification service…" });
    window.location.href = url.toString();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-8">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">
            OUI Notifier
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
            Verify Your Email
          </h1>
          <p className="text-slate-600">
            We verify emails before sending alerts.
          </p>
        </div>

        {/* Status */}
        <div className="mb-8">
          <StatusBanner tone={state.tone} message={state.message} />
        </div>

        {/* Action */}
        <a
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          href={state.uuid ? `/oui-notifier/?uuid=${state.uuid}` : "/oui-notifier/"}
        >
          Back to OUI Notifier
        </a>
      </main>
    </div>
  );
}
