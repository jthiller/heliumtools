import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Card, Dot, Skeleton, SEARCH_INPUT_CLASS, ACTION_BTN } from "./primitives.jsx";
import IotTrafficDetail from "../IotTrafficDetail.jsx";
import { downloadTextFile } from "../../lib/download.js";
import {
  deviceLabel,
  fmtCount,
  fmtDate,
  fmtDayRange,
  fmtToken,
  lifetimeUi,
  isEarning,
  isTrafficKnown,
  iotActionRank,
  IOT_STATUS_LABEL,
  IOT_STATUS_COLOR,
  ONBOARDED_NOTE,
  IOT_HEALTH,
  IOT_HEALTH_ORDER,
  IOT_MESSAGES_NOTE,
  IOT_CONNECTIVITY_NOTE,
  IOT_TRAFFIC_STATE_NOTE,
} from "../format.js";

const COLUMN_COUNT = 8;

/** A row's IoT verdicts when it isn't an IoT Hotspot (no entry in `iotStatus.rows`). */
const NON_IOT = { status: null, traffic: null, health: null, messages: null };

// First click on a column sorts ascending, except counts (biggest first).
const SORT_FIRST_DIR = { messages: "desc" };

const IOT_STATUS_TEXT = {
  active: "text-emerald-600 dark:text-emerald-400",
  inactive: "text-rose-600 dark:text-rose-400",
  settingUp: "text-amber-600 dark:text-amber-400",
  unknown: "text-content-tertiary",
};
// Machine names for the CSV export. "pending" is emitted as-is so a mid-scan
// export is distinguishable from a non-IoT row (blank); only null maps to "".
const IOT_STATUS_CSV = {
  active: "active",
  inactive: "inactive",
  settingUp: "setting_up",
  unknown: "unknown",
  pending: "pending",
};
// Second line under the Status label, only for the two health states worth
// acting on (the other two would just restate the label).
const HEALTH_NOTE = { inactiveTraffic: "had traffic", activeQuiet: "no traffic in 30d" };
// Why a Messages cell shows a dash, keyed by the row's trafficState.
const TRAFFIC_DASH_TITLE = { none: "Not an IoT Hotspot", ...IOT_TRAFFIC_STATE_NOTE };

/** The Messages cell's state: "ok" (known block) | "pending" | "unavailable" |
 * "unpublished" | "none" (not an IoT Hotspot). */
const trafficStateOf = (traffic) => (isTrafficKnown(traffic) ? "ok" : traffic ?? "none");

const DETAIL_ID = "fleet-traffic-detail";

/** Table cell for IoT connectivity, plus a health note when it's actionable. */
function IotStatusCell({ status, health }) {
  if (status === null) return <span className="text-content-tertiary">—</span>;
  if (status === "pending") return <span className="text-content-tertiary">…</span>;
  const note = HEALTH_NOTE[health];
  return (
    <>
      <span className={`inline-flex items-center gap-1.5 ${IOT_STATUS_TEXT[status]}`}>
        <Dot color={IOT_STATUS_COLOR[status]} />
        {IOT_STATUS_LABEL[status]}
      </span>
      {note && (
        <div title={IOT_HEALTH[health].hint} className={`whitespace-nowrap pl-3.5 text-[11px] ${IOT_HEALTH[health].textClass}`}>
          {note}
        </div>
      )}
    </>
  );
}

/**
 * Table cell for 30-day delivered messages. A fixed-width slot after the
 * number holds the detail toggle (Hotspots with traffic) so the numbers stay
 * right-aligned across rows.
 */
function MessagesCell({ row: r, messages, trafficState, expanded, onToggle }) {
  let value;
  if (trafficState === "pending") value = <span className="text-content-tertiary">…</span>;
  else if (trafficState !== "ok") {
    value = <span className="text-content-tertiary" title={TRAFFIC_DASH_TITLE[trafficState]}>—</span>;
  } else {
    value = <span className={messages > 0 ? "text-content-secondary" : "text-content-tertiary"}>{fmtCount(messages)}</span>;
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {value}
      {messages > 0 || expanded ? (
        <button
          type="button"
          onClick={(e) => onToggle(r.entityKey, e.currentTarget)}
          aria-expanded={expanded}
          aria-controls={expanded ? DETAIL_ID : undefined}
          aria-label={`${expanded ? "Hide" : "Show"} daily traffic for ${r.name || r.entityKey}`}
          className="rounded p-0.5 text-content-tertiary transition hover:bg-surface-inset hover:text-content"
        >
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * One table row, memo'd so the progressive scans stay cheap: it takes only
 * primitives derived from the scan (plus the row object and a stable toggle),
 * so a status flush re-renders only the rows whose values actually changed
 * (row object identities are stable across status and onboard-date flushes —
 * see the rows memo below). Rewards flushes re-clone the row objects, so those
 * still repaint every row.
 */
const FleetRow = memo(function FleetRow({
  row: r,
  onboardedAt,
  status,
  health,
  messages,
  trafficState,
  expanded,
  onToggle,
  rewardsDone,
}) {
  return (
    <tr className={expanded ? "bg-accent-surface" : "hover:bg-surface-inset/60"}>
      <td className="px-3 py-2">
        <div className="max-w-[180px] truncate font-medium text-content">{r.name || "—"}</div>
        <div className="max-w-[180px] truncate font-mono text-[10px] text-content-tertiary">{r.entityKey}</div>
      </td>
      <td className="px-3 py-2 text-content-secondary">{deviceLabel(r.deviceType)}</td>
      <td className="px-3 py-2 text-content-secondary">
        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
      </td>
      <td className="px-3 py-2 text-content-secondary">
        {onboardedAt === undefined ? <span className="text-content-tertiary">…</span> : fmtDate(onboardedAt)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-content-secondary">
        {r._hntLife ? fmtToken(r._hntLife, { max: 2 }) : rewardsDone ? "0" : "…"}
      </td>
      <td className="px-3 py-2">
        <IotStatusCell status={status} health={health} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <MessagesCell
          row={r}
          messages={messages}
          trafficState={trafficState}
          expanded={expanded}
          onToggle={onToggle}
        />
      </td>
      <td className="px-3 py-2">
        {r._earning == null ? (
          <span className="text-content-tertiary">…</span>
        ) : r._earning ? (
          <span className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">Ever rewarded</span>
        ) : (
          <span className="whitespace-nowrap text-content-tertiary">Never rewarded</span>
        )}
      </td>
    </tr>
  );
});

const CHIP_BTN = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition";
const CHIP_ON = "border-accent/30 bg-accent-surface text-accent-text";
const CHIP_OFF = "border-border text-content-secondary hover:border-content-tertiary hover:text-content";

function FilterChip({ pressed, onClick, title, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={`${CHIP_BTN} ${pressed ? CHIP_ON : CHIP_OFF}`}
    >
      {children}
    </button>
  );
}

function Th({ children, sortKey, sort, onSort, className = "" }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const Icon = !active ? ChevronUpDownIcon : sort.dir === "asc" ? ChevronUpIcon : ChevronDownIcon;
  return (
    <th aria-sort={ariaSort} className={`px-3 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 ${active ? "text-content" : ""}`}
      >
        {children}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-60"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * @param iotStatus  the shell's `aggregateIotStatus` result: per-row verdicts
 *                   (`rows`), health counts and data days — derived once per
 *                   scan flush, never recomputed here.
 * @param onboardedByKey  the onboard scan's dates (ISO | null; absent = loading)
 */
export default function FleetTableCard({
  hotspots,
  rewardsByKey,
  rewardsDone,
  onboardedByKey,
  iotStatus,
  iotFilter = null,
  onIotFilterChange,
  loading,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [copied, setCopied] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const detailRef = useRef(null);
  // The toggle that opened the detail, so closing it (Close / Escape) returns
  // focus there.
  const openerRef = useRef(null);
  const restoreFocusRef = useRef(false);

  const iotRows = iotStatus?.rows;
  const scanOf = (h) => iotRows?.get(h.entityKey) ?? NON_IOT;
  const healthCounts = iotStatus?.traffic.health;

  // Searched + enriched rows. Independent of the IoT scan, so its periodic
  // flushes keep these row objects (and the memo'd FleetRows) as they are.
  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = hotspots || [];
    if (q) {
      list = list.filter(
        (h) =>
          (h.name || "").toLowerCase().includes(q) ||
          (h.entityKey || "").toLowerCase().includes(q) ||
          (h.city || "").toLowerCase().includes(q) ||
          (h.state || "").toLowerCase().includes(q),
      );
    }
    return list.map((h) => {
      const r = rewardsByKey[h.entityKey];
      return { ...h, _earning: isEarning(r), _iotLife: lifetimeUi(r, "iot"), _hntLife: lifetimeUi(r, "hnt") };
    });
  }, [hotspots, rewardsByKey, query]);

  // Filter + order. Reads the scan only when sorting by status/messages or
  // filtering by health, so other orderings don't re-sort on every flush.
  const readsScan = sort.key === "status" || sort.key === "messages" || Boolean(iotFilter);
  const scanRows = readsScan ? iotRows : null;
  // Likewise the onboard dates, only while sorting by them.
  const sortDates = sort.key === "onboarded" ? onboardedByKey : null;
  const rows = useMemo(() => {
    const scan = (r) => scanRows?.get(r.entityKey) ?? NON_IOT;
    const list = iotFilter ? baseRows.filter((r) => scan(r).health === iotFilter) : [...baseRows];
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let av, bv;
      switch (sort.key) {
        case "device": av = a.deviceType || ""; bv = b.deviceType || ""; break;
        case "location": av = `${a.state || ""}${a.city || ""}`; bv = `${b.state || ""}${b.city || ""}`; break;
        case "onboarded": av = sortDates?.[a.entityKey] || ""; bv = sortDates?.[b.entityKey] || ""; break;
        case "lifetime": av = a._hntLife; bv = b._hntLife; break;
        case "status": {
          const sa = scan(a);
          const sb = scan(b);
          const ra = iotActionRank(sa.status, sa.health);
          const rb = iotActionRank(sb.status, sb.health);
          if (ra !== rb) return (ra - rb) * dir;
          // Within a group, most messages first in either direction.
          return (sb.messages ?? -1) - (sa.messages ?? -1);
        }
        case "messages":
          av = scan(a).messages;
          bv = scan(b).messages;
          // Unknown counts (pending, unavailable, non-IoT) sink in both directions.
          if (av == null || bv == null) return (av == null) - (bv == null);
          break;
        default: av = (a.name || "").toLowerCase(); bv = (b.name || "").toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }, [baseRows, scanRows, sortDates, iotFilter, sort]);

  // One open detail at a time; collapse it when its row leaves the table
  // (search, filter, wallet change) rather than reopening it on return.
  useEffect(() => {
    if (expandedKey && !rows.some((r) => r.entityKey === expandedKey)) setExpandedKey(null);
  }, [rows, expandedKey]);

  const onSort = useCallback(
    (key) =>
      setSort((s) =>
        s.key === key
          ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
          : { key, dir: SORT_FIRST_DIR[key] || "asc" },
      ),
    [],
  );

  const toggleExpanded = useCallback((key, opener) => {
    openerRef.current = opener || null;
    setExpandedKey((k) => (k === key ? null : key));
  }, []);
  const closeDetail = useCallback(() => {
    restoreFocusRef.current = true;
    setExpandedKey(null);
  }, []);
  const expandedRow = expandedKey ? rows.find((r) => r.entityKey === expandedKey) : null;

  // The detail opens BELOW the table's scroll box (not as an inline row): a
  // 30-day chart + OUI table inside the 480px scroller would need nested
  // scrolling, clip the chart tooltips, and ride the table's sideways scroll on
  // phones. Bring it into view and move focus into it when a row opens it, so
  // keyboard users land on what they opened.
  useEffect(() => {
    if (!expandedKey) {
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        if (openerRef.current?.isConnected) openerRef.current.focus();
      }
      return;
    }
    const el = detailRef.current;
    el?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    el?.focus({ preventScroll: true });
  }, [expandedKey]);

  const copy = useCallback(
    async (kind) => {
      const text =
        kind === "keys"
          ? rows.map((r) => r.entityKey).join("\n")
          : rows.map((r) => r.name || r.entityKey).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        setCopied(kind);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        /* ignore */
      }
    },
    [rows],
  );

  const downloadCsv = useCallback(() => {
    const header = [
      "name", "entity_key", "asset_id", "network", "device_type",
      "city", "state", "country", "h3_location", "onboarded_at",
      "iot_status", "iot_health", "iot_messages_30d", "iot_oui_ids", "iot_traffic_through",
      "lifetime_iot", "lifetime_hnt",
    ];
    const esc = (v) => {
      let s = v == null ? "" : String(v);
      // Neutralize spreadsheet formula injection (a Hotspot name like "=cmd()").
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      const { status, traffic, health, messages } = scanOf(r);
      const block = isTrafficKnown(traffic) ? traffic : null;
      lines.push(
        [
          r.name, r.entityKey, r.assetId, r.network, r.deviceType, r.city, r.state, r.country, r.location, onboardedByKey?.[r.entityKey],
          IOT_STATUS_CSV[status] ?? "", health ? IOT_HEALTH[health].csv : "", messages, block?.ouis.join(";"), block?.dataThrough,
          r._iotLife, r._hntLife,
        ]
          .map(esc)
          .join(","),
      );
    }
    downloadTextFile("hotspots.csv", lines.join("\n"), "text/csv;charset=utf-8");
    // scanOf reads iotRows — the export reflects the scans as they stand.
  }, [rows, iotRows, onboardedByKey]);

  // The chip row exists from the first frame for any fleet with IoT Hotspots
  // (a placeholder while the scan has nothing yet), so the table never shifts
  // down when health results land. It's dropped only if the finished scan
  // yielded no health at all (traffic unpublished/unavailable). An active
  // filter stays visible (even at a zero count) so it can always be cleared.
  const anyHealth = Boolean(healthCounts) && IOT_HEALTH_ORDER.some((k) => healthCounts[k] > 0);
  const iotScanInProgress = Boolean(iotStatus) && iotStatus.counted < iotStatus.iotTotal;
  const showHealthChips = Boolean(iotFilter) || anyHealth || iotScanInProgress;

  const statusTitle = `IoT connectivity${
    iotStatus?.livenessRange ? ` (${fmtDayRange(iotStatus.livenessRange)} UTC)` : ""
  }. ${IOT_CONNECTIVITY_NOTE}`;
  const messagesTitle = `Messages over ${
    iotStatus?.trafficRange ? `the 30 days through ${fmtDayRange(iotStatus.trafficRange)} (UTC)` : "30 days"
  }. ${IOT_MESSAGES_NOTE}`;

  const emptyText = iotFilter
    ? query
      ? "No Hotspots match your search and filter."
      : "No Hotspots match this filter."
    : query
      ? "No Hotspots match your search."
      : "No Hotspots.";

  return (
    <Card
      title="Hotspots"
      subtitle={loading ? "Loading…" : `${rows.length} shown`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => copy("keys")} className={ACTION_BTN}>
            {copied === "keys" ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
            Keys
          </button>
          <button type="button" onClick={() => copy("names")} className={ACTION_BTN}>
            {copied === "names" ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
            Names
          </button>
          <button type="button" onClick={downloadCsv} className={ACTION_BTN}>
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      }
    >
      <div className="relative mb-3">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-tertiary" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Hotspots by name, entity key, or city"
          placeholder="Search name, entity key, city…"
          className={SEARCH_INPUT_CLASS}
        />
      </div>

      {showHealthChips && (
        <div role="group" aria-label="Filter by IoT connectivity and traffic" className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip pressed={!iotFilter} onClick={() => onIotFilterChange(null)}>
            All
          </FilterChip>
          {!anyHealth && !iotFilter && (
            <span className={`${CHIP_BTN} border-dashed border-border text-content-tertiary`}>
              Checking IoT health…
            </span>
          )}
          {IOT_HEALTH_ORDER.filter((k) => healthCounts[k] > 0 || k === iotFilter).map((k) => (
            <FilterChip
              key={k}
              pressed={iotFilter === k}
              onClick={() => onIotFilterChange(iotFilter === k ? null : k)}
              title={IOT_HEALTH[k].hint}
            >
              <Dot color={IOT_HEALTH[k].color} />
              {IOT_HEALTH[k].label}
              <span className="font-normal tabular-nums">{fmtCount(healthCounts[k])}</span>
            </FilterChip>
          ))}
        </div>
      )}

      <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-inset text-left text-xs text-content-tertiary">
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="device" sort={sort} onSort={onSort}>Device</Th>
              <Th sortKey="location" sort={sort} onSort={onSort}>Location</Th>
              <Th sortKey="onboarded" sort={sort} onSort={onSort}>
                <span title={ONBOARDED_NOTE}>Onboarded</span>
              </Th>
              <Th sortKey="lifetime" sort={sort} onSort={onSort} className="text-right">Lifetime HNT</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>
                <span title={statusTitle}>Status</span>
              </Th>
              <Th sortKey="messages" sort={sort} onSort={onSort} className="whitespace-nowrap text-right">
                <span title={messagesTitle}>Messages (30d)</span>
              </Th>
              <th className="px-3 py-2 font-medium">
                <span title="Whether the Hotspot has received any rewards over its lifetime">Rewards</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={COLUMN_COUNT} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-3 py-10 text-center text-sm text-content-tertiary">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const scan = scanOf(r);
                return (
                  <FleetRow
                    key={r.entityKey}
                    row={r}
                    onboardedAt={onboardedByKey?.[r.entityKey]}
                    status={scan.status}
                    health={scan.health}
                    messages={scan.messages}
                    trafficState={trafficStateOf(scan.traffic)}
                    expanded={r.entityKey === expandedKey}
                    onToggle={toggleExpanded}
                    rewardsDone={rewardsDone}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {expandedRow && (
        <section
          ref={detailRef}
          id={DETAIL_ID}
          tabIndex={-1}
          aria-label={`Daily traffic for ${expandedRow.name || expandedRow.entityKey}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeDetail();
          }}
          className="mt-3 scroll-mt-24 rounded-lg border border-border bg-surface-inset/40 p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent-text sm:p-4"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-content">{expandedRow.name || "Unnamed Hotspot"}</div>
              <div className="truncate font-mono text-[10px] text-content-tertiary">{expandedRow.entityKey}</div>
            </div>
            <button
              type="button"
              onClick={closeDetail}
              aria-label="Close daily traffic"
              className="shrink-0 rounded p-0.5 text-content-tertiary transition hover:bg-surface-inset hover:text-content"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <IotTrafficDetail entityKey={expandedRow.entityKey} traffic={scanOf(expandedRow).traffic} />
        </section>
      )}
    </Card>
  );
}
