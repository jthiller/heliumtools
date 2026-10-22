import { useEffect } from "react";

// Every Retry on the page is a button whose accessible name starts with
// "Retry" ("Retry Hotspot rewards", "Retry onboard dates", "Retry loading
// Hotspots"): this selector relies on it.
const RETRY = 'button[aria-label^="Retry"]';
// A retry that hasn't settled by then is left alone.
const WATCH_MS = 120_000;

const shown = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const nothingFocused = () => {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement;
};
const retryIn = (home, label) =>
  [...home.querySelectorAll(RETRY)].find((b) => b.getAttribute("aria-label") === label && shown(b)) ?? null;

/**
 * Keeps focus near a Retry the viewer pressed. A Retry sits in the failed
 * state it fixes, so pressing one usually removes it (that spot reads
 * "Checking…" or "Retrying…" while the retry runs, then the figures) and
 * focus would fall to the page. Once the pressed button is gone and nothing
 * else has focus, its nearest remaining container takes focus (a temporary
 * tabindex="-1", dropped on blur), and again if that container goes in turn.
 * If the retry fails again and a Retry with the same name comes back in that
 * container while focus is still there, the Retry gets focus back (a screen
 * reader reads it out again). The page's own focus moves win: a press that
 * didn't focus the button (Safari's mouse clicks), focus or a pointer press
 * anywhere else, or the page moving focus itself, ends the watch. Mounted
 * once by the shell; idle until a Retry is pressed.
 */
export default function useRetryFocus() {
  useEffect(() => {
    let watch = null;

    const stop = () => {
      if (!watch) return;
      watch.observer.disconnect();
      clearTimeout(watch.timer);
      watch = null;
    };

    const hold = (el) => {
      if (!el.hasAttribute("tabindex")) {
        el.setAttribute("tabindex", "-1");
        el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
      }
      el.focus({ preventScroll: true });
    };

    const check = () => {
      const w = watch;
      if (!w || w.btn.isConnected) return;
      const active = document.activeElement;
      if (w.home && active === w.home) {
        // Focus waits on the container: a Retry back there means it failed again.
        const back = retryIn(w.home, w.label);
        if (back) {
          stop();
          back.focus({ preventScroll: true });
        }
        return;
      }
      // Something else has focus (the viewer, or the page's own focus logic).
      if (!nothingFocused()) {
        stop();
        return;
      }
      const home = w.chain.find((el) => el.isConnected && shown(el));
      if (!home) {
        stop();
        return;
      }
      const back = retryIn(home, w.label);
      if (back) {
        stop();
        back.focus({ preventScroll: true });
        return;
      }
      w.home = home;
      hold(home);
    };

    const onClick = (e) => {
      const btn = e.target instanceof Element ? e.target.closest(RETRY) : null;
      const root = btn?.closest(".wd-root");
      if (!btn || !root || document.activeElement !== btn) return;
      stop();
      const chain = [];
      for (let el = btn.parentElement; el && el !== root.parentElement; el = el.parentElement) chain.push(el);
      const observer = new MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true });
      watch = { btn, label: btn.getAttribute("aria-label"), chain, home: null, observer, timer: setTimeout(stop, WATCH_MS) };
    };
    // The viewer moved on: the watch never takes focus back from them.
    const onFocusIn = (e) => {
      if (watch && e.target !== watch.btn && e.target !== watch.home) stop();
    };
    const onPointerDown = (e) => {
      if (watch && !(e.target instanceof Node && watch.btn.contains(e.target))) stop();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      stop();
    };
  }, []);
}
