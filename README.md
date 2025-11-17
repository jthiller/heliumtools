# heliumtools.org – Pages + Worker

This repo contains:

- `pages/` – Cloudflare Pages static site for heliumtools.org
- `worker/` – Cloudflare Worker API + cron for OUI notifier (api.heliumtools.org)

## Pages

Deploy `pages/` as a Cloudflare Pages project. The static HTML lives in `pages/public`.

## Worker

Deploy `worker/` as a Cloudflare Worker:

```bash
cd worker
wrangler dev
wrangler publish
```

The Worker expects a D1 database bound as `DB` and MailChannels for outbound email.
