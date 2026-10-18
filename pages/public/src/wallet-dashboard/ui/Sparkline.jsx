// Geometry per size: the table's 54×20 (6 px bars, 2 px gaps) and the phone
// row's 34×14 (4 px bars, 1 px gaps). `lift` sits the bars on the text
// baseline of the figure beside them.
const DIM = {
  20: { w: 54, h: 20, bar: 6, gap: 2, min: 3, stub: 6, load: 4, round: "rounded-t-[1.5px]", lift: "mb-0.5" },
  14: { w: 34, h: 14, bar: 4, gap: 1, min: 2, stub: 4, load: 3, round: "rounded-t-[1px]", lift: "mb-[3px]" },
};
const NOTCH = 2;

/**
 * A Hotspot's last 7 UTC days of HNT as a CSS-only sparkline (oldest first;
 * decorative, `aria-hidden`: the total beside it carries the value). Every
 * row shares one `scaleMax` (the list's largest single-Hotspot day, capped at
 * the 95th percentile above 200 rows); a day above it is clipped and gets a
 * 2 px ink notch. Day states: ok (violet, the six earlier days at 65%), a real
 * zero (1 px baseline), missing (a hatched stub, never 0), failed (a gray
 * stub), loading (a stub that pulses only under no-preference motion).
 * `size` 20 (table) or 14 (phone list).
 */
export function Sparkline({ days, scaleMax, size = 20, className = "" }) {
  const d = DIM[size] ?? DIM[20];
  if (!days?.length) return null;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-end ${d.lift} ${className}`}
      style={{ width: d.w, height: d.h, gap: d.gap }}
    >
      {days.map((day, i) => {
        const key = day.day ?? i;
        const box = { width: d.bar, flex: "none" };
        if (day.state === "missing") return <i key={key} className="wd-hatch block" style={{ ...box, height: d.stub }} />;
        if (day.state === "failed") return <i key={key} className="block bg-wd-ink-4" style={{ ...box, height: d.stub }} />;
        if (day.state !== "ok") return <i key={key} className="block bg-wd-line motion-safe:animate-pulse" style={{ ...box, height: d.load }} />;
        if (!(day.hnt > 0)) return <i key={key} className="block bg-wd-control" style={{ ...box, height: 1 }} />;
        const clipped = scaleMax > 0 && day.hnt > scaleMax;
        const share = scaleMax > 0 ? Math.min(day.hnt, scaleMax) / scaleMax : 0;
        const h = Math.max(d.min, Math.round(share * d.h));
        const fill = `block ${d.round} bg-wd-mobile ${i === days.length - 1 ? "" : "opacity-65"}`;
        if (!clipped) return <i key={key} className={fill} style={{ ...box, height: h }} />;
        return (
          <span key={key} className="flex flex-col" style={box}>
            <i className="block bg-wd-ink" style={{ height: NOTCH }} />
            <i className={fill} style={{ height: h - NOTCH }} />
          </span>
        );
      })}
    </span>
  );
}

export default Sparkline;
