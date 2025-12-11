
import { baseEmailTemplate } from "./base.js";

export function verifyEmailTemplate({ verifyUrl, appName }) {
  const content = `
    <p style="margin: 0 0 24px; font-size: 15px; color: #334155;">Hi there,</p>
    
    <p style="margin: 0 0 32px; font-size: 15px; color: #475569; line-height: 1.6;">
      Please verify your email address for <strong style="color: #0f172a;">${appName}</strong> by clicking the button below.
    </p>

    <div style="text-align: center; margin-bottom: 32px;">
      <a href="${verifyUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Verify Email Address</a>
    </div>

    <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
      This link will expire in 24 hours. If you did not request this, you can safely ignore this message.
    </p>
  `;

  return baseEmailTemplate(content);
}
