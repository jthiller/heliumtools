
import { baseEmailTemplate } from "./base.js";

export function verifyEmailTemplate({ verifyUrl, appName }) {
    const content = `
    <p style="font-size: 16px; margin-bottom: 24px;">Hi there,</p>
    
    <p style="margin-bottom: 24px;">
      Please verify your email address for <strong>${appName}</strong> by clicking the button below.
    </p>

    <div style="text-align: center;">
      <a href="${verifyUrl}" class="button">Verify Email Address</a>
    </div>

    <p style="margin-top: 24px; font-size: 13px; color: #64748b;">
      This link will expire in 24 hours. If you did not request this, you can safely ignore this message.
    </p>
  `;

    return baseEmailTemplate(content);
}
