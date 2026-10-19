import { fmtCount } from "../format.js";
import { Btn2 } from "../ui/Controls.jsx";

/**
 * Paging over the applied order (not virtualization, so tab order and
 * find-in-page stay stable over the rendered rows): "Showing 100 of 1,659",
 * "Show 100 more (1,559 left)" and, in the table, "Show all 1,659". `phone`
 * is the list's full-width "Show 50 more". `onMore` / `onAll` grow the page;
 * the list moves focus to the first new row.
 */
export default function Pager({ shown, total, step, onMore, onAll, phone = false }) {
  const left = Math.max(0, total - shown);
  if (!left) return null;
  const more = `Show ${fmtCount(Math.min(step, left))} more (${fmtCount(left)} left)`;
  if (phone) {
    return (
      <div className="border-t border-wd-line-2 px-4 py-3">
        <p className="m-0 mb-2 text-center text-wd-cap text-wd-ink-2">
          Showing {fmtCount(shown)} of {fmtCount(total)}
        </p>
        <Btn2 onClick={onMore} className="w-full text-sm">
          {more}
        </Btn2>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-wd-sm text-wd-ink-2">
        Showing {fmtCount(shown)} of {fmtCount(total)}
      </span>
      <Btn2 onClick={onMore} className="text-sm">
        {more}
      </Btn2>
      <Btn2 onClick={onAll} className="text-sm">
        Show all {fmtCount(total)}
      </Btn2>
    </div>
  );
}
