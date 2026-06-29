import { useMemo, useState } from "react";
import { MagnifyingGlassIcon, MapPinIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

const SEARCH_CLASS =
  "w-full rounded-lg border border-border bg-surface-inset py-2 pl-9 pr-3 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function deviceLabel(deviceType) {
  if (deviceType === "iotFull") return "Full";
  if (deviceType === "iotDataOnly") return "Data-Only";
  return "IoT";
}

function place(h) {
  const parts = [h.city, h.state || h.country].filter(Boolean);
  return parts.join(", ");
}

/**
 * Searchable list of the wallet's IoT Hotspots. Click a row to edit its
 * asserted location. `hotspots` are wallet-dashboard fleet rows (IoT only).
 */
export default function HotspotList({ hotspots, onSelect }) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hotspots;
    return hotspots.filter((h) => {
      const hay = [h.name, h.entityKey, h.city, h.state, h.country]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [hotspots, query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, address, or location"
          className={SEARCH_CLASS}
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-content-tertiary">
          No IoT Hotspots match.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface-raised shadow-soft">
          {rows.map((h) => (
            <li key={h.entityKey}>
              <button
                onClick={() => onSelect(h)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-inset"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-content">
                      {h.name || h.entityKey}
                    </span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-content-secondary">
                      {deviceLabel(h.deviceType)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-content-tertiary">
                    {h.location ? (
                      <>
                        <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{place(h) || "Location asserted"}</span>
                      </>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">No location asserted</span>
                    )}
                  </div>
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-content-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
