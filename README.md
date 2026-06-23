# heliumtools.org – Pages + Worker

This repo contains:

- `pages/` – Cloudflare Pages static site for heliumtools.org
- `worker/` – Cloudflare Worker API + cron for OUI notifier (api.heliumtools.org)

## About this repo

This repo is published as a **reference for LLM-built tooling** — operator utilities for the Helium network built with an AI coding agent. Use it as a reference when building your own tools: read `CLAUDE.md` for the conventions the agent follows and adapt what fits. It is a starting point to learn from, not a drop-in dependency.

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

The Worker expects a D1 database bound as `DB` and Resend for outbound email. Local secrets live in `worker/.dev.vars` (gitignored); in production the same values are set via `wrangler secret put <NAME> --env production`. See `worker/.dev.vars.example` for the full list of variables the Worker reads.

Local development:

```bash
cd worker
cp .dev.vars.example .dev.vars   # then fill in real values
npm install
wrangler dev
```
