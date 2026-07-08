import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { SEARCH_INPUT_CLASS } from "../wallet-dashboard/cards/primitives.jsx";
import { classNames, numberFormatter } from "../lib/utils.js";
import { fetchNominations } from "../lib/councilApi.js";

// The channel this scrape mirrors — #advisory-council in the Helium Discord.
const CHANNEL_URL =
  "https://discord.com/channels/404106811252408320/1524096173206536242";
// The worker serves everyone from a KV snapshot refreshed by the scrape push,
// so there's no value in polling fast — this just re-pulls the cached view.
const POLL_MS = 60_000;

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "endorsed", label: "Most endorsed" },
];

// ─── formatting ────────────────────────────────────────────────────────────

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Relative time from a ms epoch (Vote's relTime takes seconds; this takes ms).
function relTime(ms) {
  if (!ms) return "";
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(ms);
}

// ─── discord text ─────────────────────────────────────────────────────────────

// Discord wraps entities in angle-bracket tokens. The scraper can't resolve the
// ids to names, so we degrade them to readable plain text rather than pretend:
// custom emoji <:name:id> / <a:name:id> → :name:, and user/role/channel mentions
// → @member / #channel.
function degradeTokens(text) {
  return text
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<#\d+>/g, "#channel")
    .replace(/<@[!&]?\d+>/g, "@member");
}

// Render scraped content as React-escaped text nodes, emitting <a> only for bare
// https:// URLs. No dangerouslySetInnerHTML and no markdown parsing, so a hostile
// post can't inject markup.
function renderDiscordContent(text) {
  if (!text) return null;
  const parts = degradeTokens(text).split(/(https:\/\/[^\s<]+)/g);
  return parts.map((part, i) =>
    /^https:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-text hover:opacity-80 break-all"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function DiscordText({ text, className = "" }) {
  return (
    <p className={classNames("whitespace-pre-wrap break-words", className)}>
      {renderDiscordContent(text)}
    </p>
  );
}

// The worker builds every `link` as an https discord.com URL, but never trust a
// field blindly as an href: only render the external-link anchor for an https URL.
function safeHttps(link) {
  return typeof link === "string" && link.startsWith("https://") ? link : null;
}

// ─── candidate name ─────────────────────────────────────────────────────────────

// Words that mark a first line as a greeting rather than a name ("Iconic Afternoon",
// "Hey everyone"), so we don't mistake a salutation for the candidate's name.
const GREETING_WORDS = /\b(hi|hey|hello|hiya|yo|gm|greetings|welcome|morning|afternoon|evening|sup|howdy)\b/i;
// A plausible person name: starts with a letter, then only letters, spaces, and the
// punctuation that shows up in names (comma, period, apostrophe, hyphen). No digits,
// mentions, colons, or urls — those disqualify a line from being a name header.
const NAME_LIKE = /^[\p{L}][\p{L} .,'-]{0,44}$/u;

// Drop trailing emoji / symbols / whitespace (e.g. "Iconic Afternoon 🫡" → "Iconic Afternoon").
function trimTrailingSymbols(s) {
  return s.replace(/[\s\p{Extended_Pictographic}\p{So}\p{Sk}️‍]+$/u, "").trim();
}

// Nomination posts usually open with a name header — "Jacob Brady - <@id>",
// "Jeremy Mahrle / @jay", or a bare "Samuel Andrews, MD" line — which is redundant
// once the name is in the card header. Lift that name out (returns null if the first
// line isn't clearly a name header). Deliberately conservative: a greeting or a
// sentence is left alone, so "Iconic Afternoon 🫡\n\nI'm Omar Henry…" isn't touched.
function parseCandidateName(rawContent) {
  const content = rawContent || "";
  const nl = content.indexOf("\n");
  const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim();
  if (!firstLine) return null;

  // "Name <separator> @mention" — the trailing mention makes this an unambiguous header.
  const sep = firstLine.match(/^(.{2,44}?)\s*[-–—/|]\s*(?:<@[!&]?\d+>|@[\w.]+)\s*$/u);
  if (sep) {
    const name = trimTrailingSymbols(sep[1]);
    if (name && NAME_LIKE.test(name) && !GREETING_WORDS.test(name)) return name;
  }

  // A short, name-like line on its own (e.g. "Samuel Andrews, MD" / "Jeremy Harris").
  const bare = trimTrailingSymbols(firstLine);
  if (
    bare &&
    NAME_LIKE.test(bare) &&
    !GREETING_WORDS.test(bare) &&
    bare.split(/\s+/).length <= 5 &&
    !/[.!?]$/.test(bare)
  ) {
    return bare;
  }
  return null;
}

// Drop the first line (the lifted name header) plus any blank lines after it.
function stripNameHeader(content) {
  const nl = (content || "").indexOf("\n");
  if (nl === -1) return "";
  return content.slice(nl + 1).replace(/^\s+/, "");
}

// ─── avatar ─────────────────────────────────────────────────────────────────

// Initials-tile tones lifted from the Landing icon tiles, so a null or broken
// avatar falls back to a colored monogram instead of a blank circle.
const AVATAR_TONES = [
  "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
  "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
  "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
];

function initialsFor(name) {
  // Only consider words that start with a letter/number, so an emoji or symbol in
  // a display name (e.g. "Maknbank 🏦 📡") doesn't produce a replacement-char tile.
  const words = (name || "").trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";
  const letters = (w) => w.replace(/[^a-z0-9]/gi, "");
  if (words.length === 1) return letters(words[0]).slice(0, 2).toUpperCase() || "?";
  return (letters(words[0])[0] + letters(words[words.length - 1])[0]).toUpperCase();
}

// Deterministic tone so the same author always gets the same tile.
function toneFor(key) {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function Avatar({ url, name, id, className = "h-10 w-10", textClassName = "text-xs" }) {
  // Track the URL that failed, not a boolean, so a later scrape delivering a fresh
  // avatarUrl re-attempts the <img> instead of being stuck on the initials tile
  // (cards are keyed by stable message id, so this Avatar instance persists).
  const [failedUrl, setFailedUrl] = useState(null);
  const broken = url != null && failedUrl === url;
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={classNames("shrink-0 rounded-full bg-surface-inset object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={classNames(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        toneFor(id || name),
        textClassName,
        className,
      )}
    >
      {initialsFor(name)}
    </div>
  );
}

// ─── nomination card ──────────────────────────────────────────────────────────

function ReactionPill({ reaction }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-surface-inset px-2 py-0.5 text-xs">
      <span>{reaction.emoji}</span>
      <span className="font-mono tabular-nums text-content-tertiary">{reaction.count}</span>
    </span>
  );
}

function EndorsementRow({ endorsement: e }) {
  return (
    <div className="flex gap-2.5">
      <Avatar
        url={e.avatarUrl}
        name={e.authorDisplayName}
        id={e.authorId}
        className="mt-0.5 h-7 w-7"
        textClassName="text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-content">{e.authorDisplayName}</span>
          {e.authorUsername && (
            <span className="font-mono text-[11px] text-content-tertiary">@{e.authorUsername}</span>
          )}
          <span className="font-mono text-[11px] tabular-nums text-content-tertiary">
            {relTime(e.postedAt)}
          </span>
          {safeHttps(e.link) && (
            <a
              href={safeHttps(e.link)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-content-tertiary hover:text-content-secondary"
              aria-label="View reply on Discord"
            >
              <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </a>
          )}
        </div>
        <DiscordText text={e.content} className="mt-0.5 text-[13px] leading-relaxed text-content-secondary" />
      </div>
    </div>
  );
}

function NominationCard({ nomination: n }) {
  const [open, setOpen] = useState(false);
  const reactions = useMemo(
    () => [...(n.reactions || [])].sort((a, b) => b.count - a.count),
    [n.reactions],
  );
  const endorsements = n.endorsements || [];
  // Lift the candidate's name out of the nomination's first line into the header,
  // and drop that redundant preface from the body. Falls back to the Discord
  // display name when the first line isn't a clear name header.
  const { name, body } = useMemo(() => {
    const lifted = parseCandidateName(n.content);
    return {
      name: lifted || n.authorDisplayName,
      body: lifted ? stripNameHeader(n.content) : n.content,
    };
  }, [n.content, n.authorDisplayName]);

  return (
    <article className="rounded-2xl bg-surface-raised shadow-soft">
      <header className="flex items-start gap-3 border-b border-border-muted px-5 py-4">
        <Avatar url={n.avatarUrl} name={name} id={n.authorId} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-content">
              {name}
            </span>
            {n.authorUsername && (
              <span className="font-mono text-xs text-content-tertiary">@{n.authorUsername}</span>
            )}
          </div>
          <span className="font-mono text-[11px] tabular-nums text-content-tertiary">
            {relTime(n.postedAt)}
          </span>
        </div>
        {safeHttps(n.link) && (
          <a
            href={safeHttps(n.link)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-content-tertiary hover:text-content-secondary"
            aria-label="View nomination on Discord"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </a>
        )}
      </header>

      <div className="px-5 py-4">
        <DiscordText text={body} className="text-sm leading-relaxed text-content-secondary" />
      </div>

      {(reactions.length > 0 || endorsements.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          {reactions.map((r, i) => (
            <ReactionPill key={i} reaction={r} />
          ))}
          {endorsements.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide text-content-secondary hover:border-content-tertiary hover:text-content transition"
              aria-expanded={open}
            >
              {numberFormatter.format(endorsements.length)}{" "}
              {endorsements.length === 1 ? "endorsement" : "endorsements"}
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}

      {open && endorsements.length > 0 && (
        <div className="space-y-3 border-t border-border-muted bg-surface-inset/30 px-5 py-4">
          {endorsements.map((e) => (
            <EndorsementRow key={e.id} endorsement={e} />
          ))}
        </div>
      )}
    </article>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Council() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  // Monotonic request id: a manual Refresh racing the poll must not let an older
  // in-flight response overwrite a newer one.
  const reqSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++reqSeq.current;
    setRefreshing(true);
    try {
      const d = await fetchNominations();
      if (seq !== reqSeq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e);
    } finally {
      if (seq === reqSeq.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh while the tab is visible.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const nominations = data?.nominations || [];
  const scrapedAt = data?.scrapedAt || null;
  const unattached = data?.unattachedSupports || 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = nominations;
    if (q) {
      list = list.filter((n) =>
        [
          n.authorDisplayName,
          n.authorUsername,
          n.authorUsername && `@${n.authorUsername}`,
          n.content,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    const sorted = [...list];
    if (sort === "endorsed") {
      sorted.sort((a, b) => {
        const d = (b.endorsements?.length || 0) - (a.endorsements?.length || 0);
        return d !== 0 ? d : (b.postedAt || 0) - (a.postedAt || 0);
      });
    } else {
      sorted.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    }
    return sorted;
  }, [nominations, query, sort]);

  const count = nominations.length;

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Council" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Title block */}
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
              Helium Advisory Council
            </span>
            <div className="flex items-center gap-3">
              {scrapedAt && (
                <span
                  className="font-mono text-[11px] tabular-nums text-content-tertiary"
                  title="Reflects the last time this page's scrape of the Discord channel ran, not live Discord state."
                >
                  data {relTime(scrapedAt)}
                </span>
              )}
              <button
                onClick={() => refresh()}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wide text-content-secondary hover:text-content hover:border-content-tertiary transition disabled:opacity-50"
                aria-label="Refresh"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-content tracking-[-0.03em] leading-tight">
            Nominations
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-content-secondary">
            {count > 0 && (
              <>
                <span className="tabular-nums">{numberFormatter.format(count)}</span>{" "}
                {count === 1 ? "nomination" : "nominations"} collected from the{" "}
              </>
            )}
            {count === 0 && "Nominations are collected from the "}
            <a
              href={CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text hover:opacity-80"
            >
              #advisory-council channel
            </a>{" "}
            in the Helium Discord. Posts are read from the browser on a schedule, so the page
            is only as current as the last scrape.
          </p>
        </div>

        {loading && !data && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">Loading nominations…</p>
          </div>
        )}

        {error && !data && (
          <StatusBanner tone="error" message={error.message || "Failed to load nominations."} />
        )}

        {data && count === 0 && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">No nominations yet.</p>
          </div>
        )}

        {data && count > 0 && (
          <>
            {/* Toolbar */}
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative sm:max-w-xs sm:flex-1">
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-tertiary"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search nominations by name, handle, or text"
                  placeholder="Search name, handle, text…"
                  className={SEARCH_INPUT_CLASS}
                />
              </div>
              <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface-inset p-0.5 text-[11px] font-mono uppercase tracking-wide">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSort(s.key)}
                    className={classNames(
                      "rounded-md px-3 py-1.5 transition",
                      sort === s.key
                        ? "bg-surface-raised text-content shadow-sm"
                        : "text-content-tertiary hover:text-content-secondary",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-8 py-12 text-center">
                <p className="text-sm text-content-secondary">No nominations match your search.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {visible.map((n) => (
                  <NominationCard key={n.id} nomination={n} />
                ))}
              </div>
            )}
          </>
        )}

        {unattached > 0 && (
          <p className="mt-8 text-center text-[11px] text-content-tertiary">
            {numberFormatter.format(unattached)}{" "}
            {unattached === 1 ? "supporting reply" : "supporting replies"} could not be
            matched to a nomination.
          </p>
        )}

        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-[11px] font-mono text-content-tertiary">
          <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
          Scraped from the Helium Discord
        </p>
      </main>
    </div>
  );
}
