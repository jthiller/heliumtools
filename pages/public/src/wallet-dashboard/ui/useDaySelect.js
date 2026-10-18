import { useCallback, useState } from "react";

const keyOfDay = (d, i) => d?.day ?? d?.month ?? d?.key ?? i;

/** The day a chart shows when nobody picked one: its first gap (missing or failed), else the latest. */
export function defaultDayIndex(days) {
  const gap = days.findIndex((d) => d?.state === "missing" || d?.state === "failed");
  return gap >= 0 ? gap : days.length - 1;
}

/**
 * The read-a-day model of a per-day chart (`days` oldest first). A day is
 * always shown: the picked one, else `defaultIndex` (default: the first gap,
 * else the latest). Hovering a column previews it, a click or tap picks it,
 * Left/Right move from the day on screen, Home/End jump to the ends, and
 * Escape returns to the default (consumed only when that changes something,
 * so an enclosing dialog still closes on a plain Escape). The pick is kept by
 * day key (`day`, `month` or `key`), so it survives a window that slides; a
 * day that left the window falls back to the default.
 *
 * Returns
 *   index         the day on screen (preview, else pick, else default)
 *   selectedIndex the picked or default day, ignoring the hover preview
 *   previewIndex  the hovered day, or null
 *   keyboard      the keyboard moved last (announce politely only then)
 *   handlers      props for the focusable chart group (onKeyDown, onMouseLeave, onBlur)
 *   dayProps(i)   props for day i's column (onPointerEnter, onClick)
 *   select(i), reset()
 */
export default function useDaySelect(days, { defaultIndex } = {}) {
  const n = days.length;
  const [picked, setPicked] = useState(null); // day key | null
  const [preview, setPreview] = useState(null); // day key | null
  const [keyboard, setKeyboard] = useState(false);

  const keys = days.map(keyOfDay);
  const fallback = Math.min(Math.max(defaultIndex ?? defaultDayIndex(days), 0), Math.max(n - 1, 0));
  const pickedIndex = picked == null ? -1 : keys.indexOf(picked);
  const selectedIndex = pickedIndex >= 0 ? pickedIndex : fallback;
  const previewAt = preview == null ? -1 : keys.indexOf(preview);
  const previewIndex = previewAt >= 0 ? previewAt : null;
  const index = n === 0 ? -1 : (previewIndex ?? selectedIndex);

  const keyAt = (i) => keys[i];
  const select = (i) => {
    setPreview(null);
    setPicked(keyAt(i) ?? null);
  };
  const reset = useCallback(() => {
    setPicked(null);
    setPreview(null);
    setKeyboard(false);
  }, []);

  const onKeyDown = (e) => {
    if (n === 0) return;
    let next;
    if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, index + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      if (pickedIndex < 0 && previewIndex == null) return;
      e.preventDefault();
      e.stopPropagation();
      setPicked(null);
      setPreview(null);
      setKeyboard(true);
      return;
    } else return;
    e.preventDefault();
    setKeyboard(true);
    setPreview(null);
    setPicked(keyAt(next));
  };

  return {
    index,
    selectedIndex,
    previewIndex,
    keyboard,
    handlers: {
      onKeyDown,
      onMouseLeave: () => setPreview(null),
      onBlur: () => setKeyboard(false),
    },
    dayProps: (i) => ({
      onPointerEnter: (e) => {
        if (e.pointerType === "mouse") {
          setKeyboard(false);
          setPreview(keyAt(i));
        }
      },
      onClick: () => {
        setKeyboard(false);
        select(i);
      },
    }),
    select,
    reset,
  };
}

export { useDaySelect };
