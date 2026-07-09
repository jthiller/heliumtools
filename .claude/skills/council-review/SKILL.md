---
name: council-review
description: Review pending #advisory-council nominations and decide which are safe to publish on heliumtools.org/council + the Framer marketing page. Runs as a LOCAL Claude session (no server API key); reads the worker's admin review endpoint and pushes approve/reject decisions.
---

# Council Review — the moderation gate

The `/council` tool holds every newly-ingested nomination as **pending** until it is
reviewed **approved**. Only approved nominations reach the two public surfaces
(`GET /council/nominations` → the blind page, and `GET /council/cms` → the Framer
marketing page). Your job is to look at what's pending and decide: **approve** (safe to
publish) or **reject** (hold it off the site, with a reason).

Judgment is yours — there is **no server-side LLM/API key by design**. This is the
sanctioned local-review path.

## Preconditions
- Admin token file: `~/.config/heliumtools/council-admin-token`. **Never print, echo, or
  log the token.** Always read it inline: `$(cat ~/.config/heliumtools/council-admin-token)`.
- API base: `https://api.heliumtools.org/council`.

## Procedure
1. **Fetch** the full review list:
   ```bash
   curl -s https://api.heliumtools.org/council/review \
     -H "Authorization: Bearer $(cat ~/.config/heliumtools/council-admin-token)"
   ```
   Returns `{ counts, items: [{ id, status, reason, name, handle, postedAt, link,
   reactionCount, endorsementCount, body }] }`. `status` is `approved` | `rejected` | `pending`.
2. **Judge** every `pending` item with the rubric below. (Also glance at `approved`
   items for anything that slipped through, and reconsider `rejected` ones only if
   context clearly changed.) Read the full `body` — it's the actual nomination text.
3. **Push** decisions:
   ```bash
   curl -s -X POST https://api.heliumtools.org/council/moderate \
     -H "Authorization: Bearer $(cat ~/.config/heliumtools/council-admin-token)" \
     -H "Content-Type: application/json" \
     -d '{"approve":["<id>",...],"reject":[{"id":"<id>","reason":"<short reason>"}]}'
   ```
   `reset` (`{"reset":["<id>"]}`) puts an item back to pending. Rejecting is reversible —
   the worker only hides, never deletes.
4. **Report** a concise summary: counts + each decision with name and reason. Never
   include the token or raw payloads.

## Rubric

**APPROVE only if BOTH hold:**
- It is a genuine advisory-council nomination — a candidate presenting themselves, or a
  bona-fide nomination of a specific named person, with a substantive intro of who they
  are and why they'd serve.
- The content is appropriate to publish on the official Helium site: professional,
  on-topic, no policy problems.

**REJECT (hold off the site), with a short reason, if ANY apply:**
- **Not a nomination** — an endorsement of *other* candidates, general chatter, a
  question, a process/meta post, a "name your favorite candidates" post, or a joke.
  (These are the classifier's most common false positives.)
- **Negative / FUD / disparagement** — "Helium is dead", "earnings are down/collapsing"
  used as a knock, doom-posting, or attacks on the network, the team, or other
  candidates. A candidate soberly discussing real challenges *within their own platform*
  is fine; disparagement or doom framing is not.
- **Scam / phishing / spam** — airdrop or giveaway links, "connect your wallet", token
  shilling, referral spam, or shortened/unknown/wallet/airdrop-looking links.
- **Impersonation** — claiming to be someone they are not.
- **Harassment / hate / personal attacks / doxxing / NSFW.**
- **Off-brand or reputationally risky** content that shouldn't represent Helium publicly.

**When uncertain, DO NOT approve.** Leave it pending (or reject with reason "needs human
look") and flag it in your report. Holding a borderline post costs nothing; auto-publishing
a bad one is the failure we're preventing.

## Notes
- The only write you make is `POST /council/moderate`. Do not touch anything else, do not
  post to Discord, do not publish Framer. Approving simply lets the existing pipeline
  publish; the hourly Framer sync then picks approved items up.
- Approving is all you need to do: the hourly Framer sync create-or-updates by handle, so
  a newly-approved candidate is **auto-created/published** to the marketing collection on
  the next run. (Its name/avatar come from our feed and are un-curated until the designer
  polishes them — note new approvals in your report so they know one landed.)
- This is a temporary election tool; see `worker/src/tools/council/CLAUDE.md` for the full
  picture and teardown.
