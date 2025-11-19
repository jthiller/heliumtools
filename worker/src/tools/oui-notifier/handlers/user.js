import { getOuiByEscrow } from "../services/ouis.js";

export async function handleGetUser(request, env) {
    const url = new URL(request.url);
    const uuid = url.pathname.split("/").pop();

    if (!uuid) {
        return new Response("Missing UUID", { status: 400 });
    }

    const user = await env.DB.prepare("SELECT id, email, uuid FROM users WHERE uuid = ?")
        .bind(uuid)
        .first();

    if (!user) {
        return new Response("User not found", { status: 404 });
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
        headers: { "content-type": "application/json" },
    });
}

export async function handleDeleteSubscription(request, env) {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
        return new Response("Missing subscription ID", { status: 400 });
    }

    await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();

    return new Response("Subscription deleted", { status: 200 });
}

export async function handleUpdateSubscription(request, env) {
    const url = new URL(request.url);
    const id = url.pathname.split("/").pop();

    if (!id) {
        return new Response("Missing subscription ID", { status: 400 });
    }

    const { label, webhook_url } = await request.json();

    await env.DB.prepare(
        "UPDATE subscriptions SET label = ?, webhook_url = ? WHERE id = ?"
    )
        .bind(label || null, webhook_url || null, id)
        .run();

    return new Response("Subscription updated", { status: 200 });
}

export async function handleDeleteUser(request, env) {
    const url = new URL(request.url);
    const uuid = url.pathname.split("/").pop();

    if (!uuid) {
        return new Response("Missing UUID", { status: 400 });
    }

    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?")
        .bind(uuid)
        .first();

    if (!user) {
        return new Response("User not found", { status: 404 });
    }

    await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ?")
        .bind(user.id)
        .run();

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

    return new Response("User deleted", { status: 200 });
}
