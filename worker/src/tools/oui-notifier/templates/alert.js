
import { baseEmailTemplate } from "./base.js";

export function alertEmailTemplate({
  escrow,
  label,
  balanceDC,
  balanceUSD,
  avgBurn,
  daysRemaining,
  threshold,
  burnLookbackDays,
  appBaseUrl,
  userUuid,
}) {
  const labelHtml = label ? `<span class="label">${label}</span>` : "";

  const content = `
    <div class="alert-box">
      <strong>Heads up!</strong> Your DC balance has crossed the ${threshold}-day threshold.
    </div>

    <p style="margin-bottom: 16px;">
      Helium DC alert for escrow account:
    </p>
    
    <div class="info-box">
      <div style="font-family: monospace; word-break: break-all; color: #475569;">
        ${escrow}
      </div>
      ${labelHtml}
    </div>

    <div class="stat-grid">
      <div class="stat-item">
        <div class="stat-label">Current Balance</div>
        <div class="stat-value">${balanceDC.toLocaleString("en-US")} DC</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">
          ~$${balanceUSD.toFixed(2)}
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Est. Days Remaining</div>
        <div class="stat-value">${daysRemaining.toFixed(1)} days</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">
          Based on recent burn
        </div>
      </div>
    </div>

    <p style="font-size: 14px; color: #475569;">
      Average daily burn (last ${burnLookbackDays} days): <strong>${avgBurn.toFixed(2)} DC/day</strong>
    </p>

    <div style="text-align: center; margin-top: 32px;">
      <a href="${appBaseUrl}" class="button">View Dashboard</a>
    </div>

    <p style="margin-top: 24px; font-size: 13px; color: #94a3b8; text-align: center;">
      If you recently topped up your DC balance, alerts will reset on the next run.
    </p>
  `;

  const managementUrl = `${appBaseUrl}?uuid=${userUuid}`;
  return baseEmailTemplate(content, managementUrl);
}
