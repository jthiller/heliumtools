import { classNames } from "../../lib/utils.js";

/** Shared class for the icon-prefixed search / address inputs. */
export const SEARCH_INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-inset py-2 pl-9 pr-3 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** Bento tile shell: rounded card with an optional title row and action slot. */
export function Card({ title, subtitle, action, className = "", bodyClassName = "", children }) {
  return (
    <section
      className={classNames(
        "flex flex-col rounded-2xl border border-border bg-surface-raised overflow-hidden",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-content">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-content-tertiary">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={classNames("flex-1 px-5 pb-5", !title && "pt-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** A labeled stat: caption + large value + optional sub-line. */
export function Stat({ label, value, sub, valueClass = "text-content" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </div>
      <div className={classNames("mt-1 font-display text-2xl font-semibold tabular-nums", valueClass)}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-xs text-content-tertiary">{sub}</div>}
    </div>
  );
}

/** Shimmer placeholder. */
export function Skeleton({ className = "" }) {
  return <div className={classNames("animate-pulse rounded-md bg-surface-inset", className)} />;
}

/** A labeled horizontal distribution bar. */
export function DistroBar({ label, count, total, color, suffix }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="truncate text-content-secondary">{label}</span>
        <span className="ml-2 shrink-0 tabular-nums text-content-tertiary">
          {count}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-inset">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color || "rgb(var(--color-accent))" }}
        />
      </div>
    </div>
  );
}

/** Indeterminate-friendly progress bar (done / total). */
export function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
      <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small colored dot (network/token legend). */
export function Dot({ color, className = "" }) {
  return (
    <span
      className={classNames("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

/** Pill badge. */
export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "border-border text-content-secondary",
    accent: "border-accent/30 bg-accent-surface text-accent-text",
    warn: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300",
    ok: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone] || tones.default,
      )}
    >
      {children}
    </span>
  );
}

/** Centered empty/placeholder text for a card body. */
export function CardEmpty({ children }) {
  return (
    <div className="flex h-full min-h-[80px] items-center justify-center text-center text-sm text-content-tertiary">
      {children}
    </div>
  );
}
