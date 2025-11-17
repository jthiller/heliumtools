import { safeText } from "../utils.js";

export async function sendEmail(env, { to, subject, text }) {
  if (!to) return false;
  const fromEmail = env.FROM_EMAIL;
  if (!fromEmail) {
    console.error("FROM_EMAIL is not configured.");
    return false;
  }

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: env.APP_NAME || "Helium DC Alerts" },
    subject,
    content: [{ type: "text/plain", value: text }],
  };

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await safeText(res);
    console.error("MailChannels error", res.status, body);
    return false;
  }
  return true;
}
