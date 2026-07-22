import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { fetchMobileFees, fetchGatewayStatus } from "../lib/mobileOnboardApi.js";
import { parseGatewayToken } from "./gatewayToken.js";
import usePersistedDrafts from "./usePersistedDrafts.js";
import IntroStep from "./IntroStep.jsx";
import TokenStep from "./TokenStep.jsx";
import IssueStep from "./IssueStep.jsx";
import OnboardStep from "./OnboardStep.jsx";
import CertStep from "./CertStep.jsx";
import ConfigureStep from "./ConfigureStep.jsx";

const STEPS = [
  { key: "token", label: "Token" },
  { key: "issue", label: "Register" },
  { key: "onboard", label: "Location" },
  { key: "cert", label: "Certificates" },
  { key: "configure", label: "AP setup" },
];

/**
 * The onboarding step machine: intro → token → issue → onboard → cert →
 * configure. Owns the wizard state and mirrors it into a localStorage draft
 * after every completed step so an interrupted flow (browser closed after
 * the issue transaction, DC top-up detour, …) resumes cleanly. Resume always
 * re-derives the true step from /status — chain state wins over the draft.
 */
export default function OnboardWizard({ onOpenGuide }) {
  const { connected, publicKey } = useWallet();
  const walletB58 = publicKey ? publicKey.toBase58() : null;
  const { drafts, saveDraft, deleteDraft } = usePersistedDrafts();

  const [step, setStep] = useState("intro");
  const [gateway, setGateway] = useState(null); // { b58, name }
  const [token, setToken] = useState(null);
  const [issuePayload, setIssuePayload] = useState(null);
  const [fees, setFees] = useState(null);
  const [location, setLocation] = useState({ lat: "", lng: "" });
  const [certForm, setCertForm] = useState({ address: "", nasId: "" });
  const [resumeState, setResumeState] = useState(null); // null | "checking" | error string

  useEffect(() => {
    let cancelled = false;
    fetchMobileFees()
      .then((data) => !cancelled && setFees(data))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleToken = ({ gateway: gw, token: tok, issuePayload: payload }) => {
    setGateway(gw);
    setToken(tok);
    setIssuePayload(payload);
    saveDraft({ gateway: gw.b58, name: gw.name, token: tok, wallet: walletB58, step: "token" });
  };

  const handleIssued = () => {
    // The token was consumed on-chain — drop it from the draft.
    saveDraft({ gateway: gateway.b58, name: gateway.name, token: null, wallet: walletB58, step: "issued" });
    setStep("onboard");
  };

  const handleLocationChange = (next) => {
    setLocation(next);
    saveDraft({ gateway: gateway.b58, lat: next.lat, lng: next.lng });
  };

  const handleOnboarded = () => {
    saveDraft({ gateway: gateway.b58, step: "onboarded" });
    setStep("cert");
  };

  const handleCertForm = (next) => {
    setCertForm(next);
    saveDraft({ gateway: gateway.b58, address: next.address, nasId: next.nasId });
  };

  const handleCertDone = () => {
    saveDraft({ gateway: gateway.b58, step: "cert" });
    setStep("configure");
  };

  // Skipping certs still advances to AP setup, but the draft must not claim
  // "certificates issued" — a resume lands back on the cert step.
  const handleCertSkip = () => {
    saveDraft({ gateway: gateway.b58, step: "onboarded" });
    setStep("configure");
  };

  const handleFinish = () => {
    deleteDraft(gateway.b58);
    setGateway(null);
    setToken(null);
    setIssuePayload(null);
    setLocation({ lat: "", lng: "" });
    setCertForm({ address: "", nasId: "" });
    setStep("intro");
  };

  const handleResume = async (draft) => {
    if (resumeState === "checking") return; // one resume at a time — no interleaving two drafts' state
    setResumeState("checking");
    setGateway({ b58: draft.gateway, name: draft.name });
    setToken(draft.token || null);
    setLocation({ lat: draft.lat || "", lng: draft.lng || "" });
    setCertForm({ address: draft.address || "", nasId: draft.nasId || "" });
    try {
      const status = await fetchGatewayStatus(draft.gateway);
      if (status.onboarded) {
        setStep(draft.step === "cert" ? "configure" : "cert");
      } else if (status.issued) {
        if (draft.token) {
          saveDraft({ gateway: draft.gateway, token: null, step: "issued" });
        }
        setStep("onboard");
      } else if (draft.token) {
        const parsed = parseGatewayToken(draft.token);
        setIssuePayload({ unsignedMsgHex: parsed.unsignedMsgHex, signatureHex: parsed.signatureHex });
        setStep("issue");
      } else {
        setResumeState("This draft has no token and the Hotspot isn't on-chain, so it can't be resumed. Delete it and start over.");
        return;
      }
      setResumeState(null);
    } catch (err) {
      setResumeState(err.message);
    }
  };

  // Everything past the intro needs the wallet (it pays, owns, and signs).
  if (step !== "intro" && !connected) {
    return (
      <div className="rounded-2xl bg-surface-raised p-8 text-center shadow-soft">
        <p className="mb-4 text-sm text-content-secondary">
          Connect the Solana wallet that will own this Hotspot to continue.
        </p>
        <div className="flex justify-center">
          <WalletMultiButton className="!rounded-lg !text-sm" />
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
      {step !== "intro" && (
        <div className="mb-5 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
              <div className={`h-1 w-full rounded-full ${i <= stepIndex ? "bg-accent" : "bg-border"}`} />
              <span className={`text-[10px] ${i === stepIndex ? "font-medium text-content" : "text-content-tertiary"}`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {resumeState === "checking" && (
        <p className="mb-4 text-sm text-content-tertiary">Checking on-chain state…</p>
      )}
      {resumeState && resumeState !== "checking" && (
        <p className="mb-4 text-sm text-rose-500">{resumeState}</p>
      )}

      {step === "intro" && (
        <IntroStep
          drafts={drafts}
          walletB58={walletB58}
          connected={connected}
          onStart={() => { setResumeState(null); setStep("token"); }}
          onResume={handleResume}
          onDeleteDraft={(g) => { setResumeState(null); deleteDraft(g); }}
          onOpenGuide={onOpenGuide}
        />
      )}
      {step === "token" && (
        <TokenStep
          gateway={gateway}
          token={token}
          onToken={handleToken}
          onContinue={() => setStep("issue")}
        />
      )}
      {step === "issue" && (
        <IssueStep gateway={gateway} issuePayload={issuePayload} onIssued={handleIssued} />
      )}
      {step === "onboard" && (
        <OnboardStep
          gateway={gateway}
          fees={fees}
          location={location}
          onLocationChange={handleLocationChange}
          onOnboarded={handleOnboarded}
        />
      )}
      {step === "cert" && (
        <CertStep
          gateway={gateway}
          address={certForm.address}
          nasId={certForm.nasId}
          onFormChange={handleCertForm}
          onDone={handleCertDone}
          onSkip={handleCertSkip}
        />
      )}
      {step === "configure" && (
        <ConfigureStep gateway={gateway} onFinish={handleFinish} />
      )}
    </div>
  );
}
