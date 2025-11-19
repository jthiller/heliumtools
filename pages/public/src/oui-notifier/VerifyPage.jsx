import { useEffect, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { API_BASE } from "../lib/api.js";
import Header from "../components/Header.jsx";

const classNames = (...classes) => classes.filter(Boolean).join(" ");

function Status({ tone = "info", message }) {
  if (!message) return null;
  const toneMap = {
    success: "bg-emerald-50 text-emerald-900 ring-emerald-100",
    error: "bg-rose-50 text-rose-900 ring-rose-100",
    info: "bg-indigo-50 text-indigo-900 ring-indigo-100",
  };
  const iconMap = {
    success: CheckCircleIcon,
    error: ExclamationTriangleIcon,
    info: ArrowPathIcon,
  };
  const Icon = iconMap[tone] || ArrowPathIcon;
  return (
    <div className={classNames("flex items-start gap-3 rounded-xl p-4 ring-1", toneMap[tone])}>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <p className="text-sm leading-6">{message}</p>
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
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="py-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-indigo-600">OUI Notifier</p>
              <h1 className="text-2xl font-semibold text-slate-900">Verify your email</h1>
              <p className="text-sm text-slate-600">
                We verify emails before sending alerts.
              </p>
            </div>
            <div className="mt-4">
              <Status tone={state.tone} message={state.message} />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                href={state.uuid ? `/oui-notifier/?uuid=${state.uuid}` : "/oui-notifier/"}
              >
                Back to alerts
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
