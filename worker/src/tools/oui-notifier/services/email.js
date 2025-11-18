import { safeText } from "../utils.js";

const RETRY_DELAYS_MS = [500, 1500, 3000];

export async function sendEmail(env, { to, subject, text, html }) {
  if (!to) return { ok: false, id: null };

  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.FROM_EMAIL;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not configured.");
    return { ok: false, id: null };
  }
  if (!fromEmail) {
    console.error("FROM_EMAIL is not configured.");
    return { ok: false, id: null };
  }

  const fromAddress = `${env.APP_NAME || "Helium DC Alerts"} <${fromEmail}>`;

  const payload = {
    from: fromAddress,
    to: [to],
    subject,
    text,
  };

  if (html) {
    payload.html = html;
  }

  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
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
      lastError = err;
      console.error(`Resend request failed (attempt ${attempt + 1})`, err);
    }

    if (res && res.ok) {
      let messageId = null;
      try {
        const data = await res.json();
        messageId = data?.id || null;
      } catch (parseErr) {
        console.error("Unable to parse Resend response", parseErr);
      }
      if (messageId) {
        console.log(`Resend message accepted (id=${messageId}) for ${to}`);
      }
      return { ok: true, id: messageId };
    }

    const body = res ? await safeText(res) : String(lastError || "");
    console.error(
      `Resend error (attempt ${attempt + 1})`,
      res ? res.status : "request_failed",
      body
    );

    const delay = RETRY_DELAYS_MS[attempt];
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { ok: false, id: null };
}
