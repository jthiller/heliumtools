import { useState, useMemo, useCallback, memo } from "react";
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { Card, Dot, Skeleton, SEARCH_INPUT_CLASS } from "./primitives.jsx";
import {
  deviceLabel,
  fmtDate,
  fmtToken,
  lifetimeUi,
  isEarning,
  iotStatusOf,
  IOT_STATUS_LABEL,
  IOT_STATUS_COLOR,
} from "../format.js";

// Per-surface maps keyed by the iotStatusOf vocabulary (IOT_STATUS_LABEL keys
// plus "pending"). Sort ranks put actionable states first; non-IoT rows (null
// status) fall through the ?? to rank last in ascending order.
const IOT_STATUS_RANK = { inactive: 0, settingUp: 1, unknown: 2, active: 3, pending: 4 };
const iotStatusRank = (s) => IOT_STATUS_RANK[s] ?? 99;
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

/** Table cell for the IoT connectivity column. */
function IotStatusCell({ status }) {
  if (status === null) return <span className="text-content-tertiary">—</span>;
  if (status === "pending") return <span className="text-content-tertiary">…</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 ${IOT_STATUS_TEXT[status]}`}>
      <Dot color={IOT_STATUS_COLOR[status]} />
      {IOT_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * One table row, memo'd so the progressive scans stay cheap: a status flush
 * re-renders only the rows whose `status` prop actually changed (row object
 * identities are stable across status flushes — see the rows memo below).
 * Rewards flushes re-clone the row objects, so those still repaint every row.
 */
const FleetRow = memo(function FleetRow({ row: r, status, rewardsDone }) {
  return (
    <tr className="hover:bg-surface-inset/60">
      <td className="px-3 py-2">
        <div className="max-w-[180px] truncate font-medium text-content">{r.name || "—"}</div>
        <div className="max-w-[180px] truncate font-mono text-[10px] text-content-tertiary">{r.entityKey}</div>
      </td>
      <td className="px-3 py-2 text-content-secondary">{deviceLabel(r.deviceType)}</td>
      <td className="px-3 py-2 text-content-secondary">
        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
      </td>
      <td className="px-3 py-2 text-content-secondary">{r.createdAt ? fmtDate(r.createdAt) : "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums text-content-secondary">
        {r._hntLife ? fmtToken(r._hntLife, { max: 2 }) : rewardsDone ? "0" : "…"}
      </td>
      <td className="px-3 py-2">
        <IotStatusCell status={status} />
      </td>
      <td className="px-3 py-2">
        {r._earning == null ? (
          <span className="text-content-tertiary">…</span>
        ) : r._earning ? (
          <span className="text-emerald-600 dark:text-emerald-400">Earning</span>
        ) : (
          <span className="text-content-tertiary">Idle</span>
        )}
      </td>
    </tr>
  );
});

const ACTION_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary transition hover:border-content-tertiary";

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

export default function FleetTableCard({
  hotspots,
  rewardsByKey,
  rewardsDone,
  iotStatusByKey,
  iotDataThrough,
  loading,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [copied, setCopied] = useState(null);

  // Status is deliberately NOT baked into the memo'd rows: the scan's periodic
  // statusByKey flushes would otherwise re-clone and re-sort the whole table
  // each time. Cells derive it per render (O(1) lookup per visible row), and
  // the memo depends on the live map only while actually sorting by status.
  const statusOf = (h) => iotStatusOf(h, iotStatusByKey?.[h.entityKey], iotDataThrough);
  const statusSortByKey = sort.key === "status" ? iotStatusByKey : null;
  const statusSortDataThrough = sort.key === "status" ? iotDataThrough : null;

  const rows = useMemo(() => {
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
    const enriched = list.map((h) => {
      const r = rewardsByKey[h.entityKey];
      return { ...h, _earning: isEarning(r), _iotLife: lifetimeUi(r, "iot"), _hntLife: lifetimeUi(r, "hnt") };
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    // Derive status ranks once per row, not once per comparison (n vs n·log n
    // iotStatusOf calls per sort).
    const rankByKey =
      sort.key === "status" ? new Map(enriched.map((h) => [h.entityKey, iotStatusRank(statusOf(h))])) : null;
    enriched.sort((a, b) => {
      let av, bv;
      switch (sort.key) {
        case "device": av = a.deviceType || ""; bv = b.deviceType || ""; break;
        case "location": av = `${a.state || ""}${a.city || ""}`; bv = `${b.state || ""}${b.city || ""}`; break;
        case "created": av = a.createdAt || ""; bv = b.createdAt || ""; break;
        case "lifetime": av = a._hntLife; bv = b._hntLife; break;
        case "status": av = rankByKey.get(a.entityKey); bv = rankByKey.get(b.entityKey); break;
        default: av = (a.name || "").toLowerCase(); bv = (b.name || "").toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return enriched;
    // statusSort* stand in for the live status map/anchor so status flushes
    // only invalidate the pipeline while the user is sorted by status. Any new
    // statusOf use inside this memo must go through the same stand-ins.
  }, [hotspots, rewardsByKey, statusSortByKey, statusSortDataThrough, query, sort]);

  const onSort = useCallback(
    (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })),
    [],
  );

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
      "city", "state", "country", "h3_location", "created_at", "iot_status", "lifetime_iot", "lifetime_hnt",
    ];
    const esc = (v) => {
      let s = v == null ? "" : String(v);
      // Neutralize spreadsheet formula injection (a Hotspot name like "=cmd()").
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [r.name, r.entityKey, r.assetId, r.network, r.deviceType, r.city, r.state, r.country, r.location, r.createdAt, IOT_STATUS_CSV[statusOf(r)] ?? "", r._iotLife, r._hntLife]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotspots.csv";
    a.click();
    URL.revokeObjectURL(url);
    // statusOf reads iotStatusByKey/iotDataThrough — export reflects the live scan.
  }, [rows, iotStatusByKey, iotDataThrough]);

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

      <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-inset text-left text-xs text-content-tertiary">
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="device" sort={sort} onSort={onSort}>Device</Th>
              <Th sortKey="location" sort={sort} onSort={onSort}>Location</Th>
              <Th sortKey="created" sort={sort} onSort={onSort}>Created</Th>
              <Th sortKey="lifetime" sort={sort} onSort={onSort} className="text-right">Lifetime HNT</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>
                <span title="IoT connectivity: connected to the Helium Packet Router during the most recent reported day">
                  Status
                </span>
              </Th>
              <th className="px-3 py-2 font-medium">Rewards</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={7} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-content-tertiary">
                  {query ? "No Hotspots match your search." : "No Hotspots."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <FleetRow key={r.entityKey} row={r} status={statusOf(r)} rewardsDone={rewardsDone} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
