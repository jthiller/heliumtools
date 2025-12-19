import { getOuiByEscrow } from "../services/ouis.js";
import { jsonHeaders } from "../responseUtils.js";

export async function handleGetUser(request, env) {
    const url = new URL(request.url);
    const uuid = url.pathname.split("/").pop();

    if (!uuid) {
        return new Response("Missing UUID", { status: 400, headers: jsonHeaders });
    }

    const user = await env.DB.prepare("SELECT id, uuid FROM users WHERE uuid = ?")
        .bind(uuid)
        .first();

    if (!user) {
        return new Response("User not found", { status: 404, headers: jsonHeaders });
    }

    const { results } = await env.DB.prepare(
        "SELECT id, escrow_account, label, webhook_url, created_at FROM subscriptions WHERE user_id = ?"
    )
        .bind(user.id)
        .all();

    const subscriptions = await Promise.all(
        (results || []).map(async (sub) => {
            const ouiData = await getOuiByEscrow(env, sub.escrow_account);
            return {
                ...sub,
                oui: ouiData ? ouiData.oui : null,
            };
        })
    );

    return new Response(JSON.stringify({ user, subscriptions }), {
        headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,X-User-Uuid",
        },
    });
}

export async function handleDeleteSubscription(request, env) {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    const userUuid = request.headers.get("X-User-Uuid");

    if (!id) {
        return new Response("Missing subscription ID", { status: 400, headers: jsonHeaders });
    }

    if (!userUuid) {
        return new Response("Missing user UUID", { status: 401, headers: jsonHeaders });
    }

    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?")
        .bind(userUuid)
        .first();

    if (!user) {
        return new Response("Invalid user UUID", { status: 403, headers: jsonHeaders });
    }

    const subscription = await env.DB.prepare("SELECT user_id FROM subscriptions WHERE id = ?")
        .bind(id)
        .first();

    if (!subscription) {
        return new Response("Subscription not found", { status: 404, headers: jsonHeaders });
    }

    if (subscription.user_id !== user.id) {
        return new Response("Unauthorized", { status: 403, headers: jsonHeaders });
    }

    // Delete related balances first (legacy table, safe to remove)
    await env.DB.prepare("DELETE FROM balances WHERE subscription_id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();

    return new Response("Subscription deleted", { status: 200, headers: jsonHeaders });
}

export async function handleUpdateSubscription(request, env) {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();
    const userUuid = request.headers.get("X-User-Uuid");

    if (!id) {
        return new Response("Missing subscription ID", { status: 400, headers: jsonHeaders });
    }

    if (!userUuid) {
        return new Response("Missing user UUID", { status: 401, headers: jsonHeaders });
    }

    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?")
        .bind(userUuid)
        .first();

    if (!user) {
        return new Response("Invalid user UUID", { status: 403, headers: jsonHeaders });
    }

    const subscription = await env.DB.prepare("SELECT user_id FROM subscriptions WHERE id = ?")
        .bind(id)
        .first();

    if (!subscription) {
        return new Response("Subscription not found", { status: 404, headers: jsonHeaders });
    }

    if (subscription.user_id !== user.id) {
        return new Response("Unauthorized", { status: 403, headers: jsonHeaders });
    }

    const { label, webhook_url } = await request.json();

    await env.DB.prepare(
        "UPDATE subscriptions SET label = ?, webhook_url = ? WHERE id = ?"
    )
        .bind(label || null, webhook_url || null, id)
        .run();

    return new Response("Subscription updated", { status: 200, headers: jsonHeaders });
}

export async function handleDeleteUser(request, env) {
    const url = new URL(request.url);
    const uuid = url.pathname.split("/").pop();

    if (!uuid) {
        return new Response("Missing UUID", { status: 400, headers: jsonHeaders });
    }

    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?")
        .bind(uuid)
        .first();

    if (!user) {
        return new Response("User not found", { status: 404, headers: jsonHeaders });
    }

    // Delete related balances first (legacy table, safe to remove)
    await env.DB.prepare(
        "DELETE FROM balances WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = ?)"
    )
        .bind(user.id)
        .run();
    await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ?")
        .bind(user.id)
        .run();

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

    return new Response("User deleted", { status: 200, headers: jsonHeaders });
}
