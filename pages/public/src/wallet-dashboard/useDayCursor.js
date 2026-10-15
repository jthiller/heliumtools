import { useState } from "react";

/**
 * The read-a-day cursor of a per-day chart with `n` days (index 0 = oldest):
 * `point(i)` for hover and tap, `onKeyDown` for focus + Left/Right (from the
 * newest day when none is active), Home and End; Escape and `clear` (blur,
 * a mouse leaving) clear it. `keyboard`: the keyboard placed it, so only
 * keyboard reading is announced (hover would chatter).
 */
export default function useDayCursor(n) {
  const [active, setActive] = useState(null); // day index | null
  const [keyboard, setKeyboard] = useState(false);

  const point = (i) => {
    setKeyboard(false);
    setActive(i);
  };
  const clear = () => setActive(null);

  const onKeyDown = (e) => {
    let next;
    if (e.key === "ArrowLeft") next = active == null ? n - 1 : Math.max(0, active - 1);
    else if (e.key === "ArrowRight") next = active == null ? n - 1 : Math.min(n - 1, active + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape" && active != null) {
      // Consume it so an enclosing panel doesn't close on the same press.
      e.preventDefault();
      e.stopPropagation();
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setKeyboard(true);
    setActive(next);
  };

  return { active, keyboard, point, clear, onKeyDown };
}
