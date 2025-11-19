export async function handleVerify(request, env) {
    try {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const email = (url.searchParams.get("email") || "").toLowerCase().trim();
        const redirectParam = url.searchParams.get("redirect");

        if (!token || !email) {
            return new Response("Missing verification token or email.", { status: 400 });
        }

        const user = await env.DB.prepare(
            "SELECT * FROM users WHERE email = ?"
        )
            .bind(email)
            .first();

        if (!user) {
            return new Response("User not found for this email.", { status: 404 });
        }

        if (!user.verify_token || user.verify_token !== token) {
            return new Response("Invalid or expired verification token.", { status: 400 });
        }

        if (user.verify_expires_at) {
            const exp = new Date(user.verify_expires_at).getTime();
            if (Date.now() > exp) {
                return new Response("Verification link has expired. Please subscribe again.", { status: 400 });
            }
        }

        let redirectBase = env.APP_BASE_URL || "https://heliumtools.org/oui-notifier";
        if (redirectParam) {
            try {
                const candidate = new URL(redirectParam);
                if (candidate.protocol === "http:" || candidate.protocol === "https:") {
                    redirectBase = candidate.toString();
                }
            } catch {
                // ignore bad redirect params
            }
        }

        await env.DB.prepare(
            "UPDATE users SET verified = 1, verify_token = NULL, verify_expires_at = NULL WHERE id = ?"
        )
            .bind(user.id)
            .run();

        const redirectUrl = new URL(redirectBase);
        redirectUrl.searchParams.set("verified", "1");
        return Response.redirect(redirectUrl.toString(), 302);
    } catch (err) {
        console.error("Error in /verify", err);
        return new Response("Error while verifying your email.", { status: 500 });
    }
}
