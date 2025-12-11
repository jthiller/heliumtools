
import { baseEmailTemplate } from "./base.js";

export function alertEmailTemplate({
  label,
  payerKey,
  oui,
  balanceDC,
  balanceUSD,
  burn1dDC,
  burn1dUSD,
  daysRemaining,
  threshold,
  appBaseUrl,
  userUuid,
}) {
  const formatDC = (val) => val != null && val >= 0 ? Math.round(val).toLocaleString("en-US") : "N/A";
  const formatUSD = (val) => val != null && val >= 0 ? `$${val.toFixed(2)}` : "—";
  const managementUrl = `${appBaseUrl}?uuid=${userUuid}`;

  const getDaysColor = (days) => {
    if (days <= 1) return "#dc2626";
    if (days <= 7) return "#dc7526";
    if (days <= 14) return "#FFCC00";
    return "#16a34a";
  };

  const content = `
    <!-- Alert Header -->
    <div style="margin-bottom: 24px;">
      <p style="margin: 0 0 4px; font-size: 13px; color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">Alert</p>
      <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #0f172a;">${label || 'OUI ' + oui}</h2>
    </div>

    <!-- Warning Message -->
    <p style="margin: 0 0 32px; font-size: 15px; color: #475569; line-height: 1.6;">
      Your DC balance has crossed the <strong>${threshold}-day threshold</strong>. Consider topping up soon to avoid service interruption.
    </p>

    <!-- Key Metrics -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px;">
      <div>
        <p style="margin: 0 0 2px; font-size: 13px; color: #64748b; font-weight: 500;">Current Balance</p>
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em; line-height: 1.1;">${formatUSD(balanceUSD)}</p>
        <p style="margin: 2px 0 0; font-size: 13px; color: #64748b;">${Number(balanceDC).toLocaleString("en-US")} DC</p>
      </div>
      <div>
        <p style="margin: 0 0 2px; font-size: 13px; color: #64748b; font-weight: 500;">Days Remaining</p>
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${getDaysColor(daysRemaining)}; letter-spacing: -0.025em; line-height: 1.1;">${daysRemaining}</p>
        <p style="margin: 2px 0 0; font-size: 13px; color: #64748b;">at ${formatDC(burn1dDC)} DC (${formatUSD(burn1dUSD)}) per day</p>
      </div>
    </div>

    <!-- Divider -->
    <div style="height: 1px; background-color: #e2e8f0; margin-bottom: 24px;"></div>

    <!-- Payer Key Section -->
    <div style="margin-bottom: 32px;">
      <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; font-weight: 500;">Payer Key <span style="color: #94a3b8;">· OUI ${oui}</span></p>
      <p style="margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #334155; word-break: break-all; background-color: #f8fafc; padding: 12px 14px; border-radius: 6px; border: 1px solid #e2e8f0; line-height: 1.5;">
        ${payerKey}
      </p>
      <p style="margin: 8px 0 0; font-size: 13px; color: #64748b;">
        Delegate Data Credits to this address to top up.
      </p>
    </div>

    <!-- CTA -->
    <div style="text-align: center;">
      <a href="${managementUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">View Dashboard</a>
    </div>
  `;

  return baseEmailTemplate(content, managementUrl);
}
