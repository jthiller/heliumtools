import { isValidEmail, isLikelyBase58 } from "../utils.js";
import { sendEmail } from "../services/email.js";
import { verifyEmailTemplate } from "../templates/verify.js";

export async function handleSubscribe(request, env) {
    try {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
            return new Response("Invalid content-type; expected form submission.", { status: 400 });
        }

        const form = await request.formData();
        const email = (form.get("email") || "").toString().trim().toLowerCase();
        const escrowAccount = (form.get("escrow_account") || "").toString().trim();
        const label = (form.get("label") || "").toString().trim();
        const webhookUrlRaw = (form.get("webhook_url") || "").toString().trim();

        if (!email || !escrowAccount) {
            return new Response("Email and escrow token account are required.", { status: 400 });
        }

        if (!isValidEmail(email)) {
            return new Response("Invalid email address.", { status: 400 });
        }

        if (!isLikelyBase58(escrowAccount)) {
            return new Response("Escrow token account is not a valid Solana base58 address.", { status: 400 });
        }

        let webhookUrl = null;
        if (webhookUrlRaw) {
            try {
                const u = new URL(webhookUrlRaw);
                if (u.protocol !== "http:" && u.protocol !== "https:") {
                    return new Response("Webhook URL must be HTTP or HTTPS.", { status: 400 });
                }
                webhookUrl = u.toString();
            } catch {
                return new Response("Webhook URL is not a valid URL.", { status: 400 });
            }
        }

        const nowIso = new Date().toISOString();

        let user = await env.DB.prepare(
            "SELECT * FROM users WHERE email = ?"
        )
            .bind(email)
            .first();

        let userId;
        let verifyToken;

        if (!user) {
            verifyToken = crypto.randomUUID();
            const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            const result = await env.DB.prepare(
                "INSERT INTO users (email, verified, verify_token, verify_expires_at, created_at) VALUES (?, 0, ?, ?, ?)"
            )
                .bind(email, verifyToken, verifyExpiresAt, nowIso)
                .run();

            userId = result.lastRowId;
        } else {
            userId = user.id;
            if (!user.verified) {
                verifyToken = crypto.randomUUID();
                const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                await env.DB.prepare(
                    "UPDATE users SET verify_token = ?, verify_expires_at = ? WHERE id = ?"
                )
                    .bind(verifyToken, verifyExpiresAt, userId)
                    .run();
            } else {
                verifyToken = user.verify_token;
            }
        }

        const existingSub = await env.DB.prepare(
            "SELECT * FROM subscriptions WHERE user_id = ? AND escrow_account = ?"
        )
            .bind(userId, escrowAccount)
            .first();

        if (!existingSub) {
            await env.DB.prepare(
                "INSERT INTO subscriptions (user_id, escrow_account, label, webhook_url, created_at, last_notified_level, last_balance_dc) VALUES (?, ?, ?, ?, ?, 0, NULL)"
            )
                .bind(userId, escrowAccount, label || null, webhookUrl || null, nowIso)
                .run();
        } else {
            await env.DB.prepare(
                "UPDATE subscriptions SET label = ?, webhook_url = ? WHERE id = ?"
            )
                .bind(label || existingSub.label, webhookUrl || existingSub.webhook_url, existingSub.id)
                .run();
        }

        if (!user || !user.verified) {
            const verifyUrl = `${env.APP_BASE_URL || ""}/verify?token=${encodeURIComponent(
                verifyToken
            )}&email=${encodeURIComponent(email)}`;

            const appName = env.APP_NAME || "Helium DC Alerts";
            const htmlBody = verifyEmailTemplate({ verifyUrl, appName });

            const sent = await sendEmail(env, {
                to: email,
                subject: `[${appName}] Verify your email`,
                text: `Hi,

Please verify your email address for ${appName} by clicking this link:

${verifyUrl}

This link will expire in 24 hours.

If you did not request this, you can ignore this message.

Thanks!`,
                html: htmlBody,
            });

            if (!sent) {
                return new Response(
                    "Subscription saved, but we could not send the verification email. Please try again later.",
                    { status: 500 }
                );
            }

            return new Response(
                "Subscription saved. Please check your inbox to verify your email before alerts are sent.",
                { status: 200 }
            );
        }

        return new Response("Subscription saved. Email already verified.", { status: 200 });
    } catch (err) {
        console.error("Error in /subscribe", err);
        return new Response("Error while saving your subscription.", { status: 500 });
    }
}
