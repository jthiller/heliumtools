import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api.js";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { setLocalStorageItem } from "../lib/utils.js";

export default function VerifyPage() {
  const [state, setState] = useState({ tone: "loading", message: "Verifying your email…" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified");
    const token = params.get("token");
    const email = params.get("email");
    const uuid = params.get("uuid");

    if (verified === "1") {
      // Store UUID in localStorage for session persistence across visits
      if (uuid) {
        setLocalStorageItem("ouiNotifierUuid", uuid);
      }
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

    setState({ tone: "loading", message: "Contacting verification service…" });
    window.location.href = url.toString();
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="OUI Notifier" />

      <main className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-8">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
            OUI Notifier
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-2">
            Verify Your Email
          </h1>
          <p className="text-content-secondary">
            We verify emails before sending alerts.
          </p>
        </div>

        {/* Status */}
        <div className="mb-8">
          <StatusBanner tone={state.tone} message={state.message} />
        </div>

        {/* Action */}
        <a
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          href={state.uuid ? `/oui-notifier/?uuid=${state.uuid}` : "/oui-notifier/"}
        >
          Back to OUI Notifier
        </a>
      </main>
    </div>
  );
}
