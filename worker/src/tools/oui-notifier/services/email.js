import { safeText } from "../utils.js";

export async function sendEmail(env, { to, subject, text }) {
  if (!to) return false;

  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.FROM_EMAIL;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not configured.");
    return false;
  }
  if (!fromEmail) {
    console.error("FROM_EMAIL is not configured.");
    return false;
  }

  const fromAddress = `${env.APP_NAME || "Helium DC Alerts"} <${fromEmail}>`;

  const payload = {
    from: fromAddress,
    to: [to],
    subject,
    text,
  };

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Resend request failed", err);
    return false;
  }

  if (!res.ok) {
    const body = await safeText(res);
    console.error("Resend error", res.status, body);
    return false;
  }

  return true;
}
