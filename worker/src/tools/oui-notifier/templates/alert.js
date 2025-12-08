
import { baseEmailTemplate } from "./base.js";

export function alertEmailTemplate({
  escrow,
  label,
  balanceDC,
  balanceUSD,
  burn1dDC,
  burn1dUSD,
  burn30dDC,
  burn30dUSD,
  daysRemaining,
  threshold,
  appBaseUrl,
  userUuid,
}) {
  const labelHtml = label ? `<span class="label">${label}</span>` : "";
  const formatDC = (val) => val != null && val > 0 ? val.toFixed(2) : "N/A";
  const formatUSD = (val) => val != null && val > 0 ? `$${val.toFixed(2)}` : "—";

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
          Based on 30d avg burn
        </div>
      </div>
    </div>

    <div class="stat-grid" style="margin-top: 16px;">
      <div class="stat-item">
        <div class="stat-label">1-Day Burn Rate</div>
        <div class="stat-value">${formatDC(burn1dDC)} DC</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">${formatUSD(burn1dUSD)}/day</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">30-Day Avg Burn</div>
        <div class="stat-value">${formatDC(burn30dDC)} DC</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">${formatUSD(burn30dUSD)}/day</div>
      </div>
    </div>

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

