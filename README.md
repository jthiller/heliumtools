# heliumtools.org – Pages + Worker

This repo contains:

- `pages/` – Cloudflare Pages static site for heliumtools.org
- `worker/` – Cloudflare Worker API + cron for OUI notifier (api.heliumtools.org)

## Deployment

Both Pages and Worker auto-deploy from the `main` branch via GitHub.

## Pages

The static HTML lives in `pages/public`. Local development:

```bash
cd pages/public
npm install
npm run dev
```

## Worker

The Worker expects a D1 database bound as `DB` and Resend for outbound email. Secrets (`RESEND_API_KEY`, `SOLANA_RPC_URL`) are set via `wrangler secret put`.

Local development:

```bash
cd worker
wrangler dev
```
