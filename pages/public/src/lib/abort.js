/** AbortError for older signals without `reason`; custom reasons stay intact. */
function abortReason(signal) {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted.", "AbortError")
    : signal.reason;
}

/** Check cancellation without requiring AbortSignal.prototype.throwIfAborted. */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

/**
 * A signal that aborts with the first of `signals` to abort (absent ones
 * skipped). AbortSignal.any is missing before Safari 17.4, Chrome 116 and
 * Firefox 124, so it falls back to a controller of its own.
 */
export function anySignal(...signals) {
  const list = signals.filter(Boolean);
  if (list.length <= 1) return list[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const ctl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctl.abort(abortReason(s));
      break;
    }
    s.addEventListener("abort", () => ctl.abort(abortReason(s)), { once: true });
  }
  return ctl.signal;
}

/** AbortSignal.timeout, with a timer of its own where it's missing (before Safari 16). */
export function timeoutSignal(milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new DOMException("The operation timed out.", "TimeoutError")), milliseconds);
  return ctl.signal;
}

/**
 * Keep the caller's cancellation and the request's own time limit. Shared
 * reads always pass a signal (dedupeAsync's own), so ordinary page loads come
 * through here too: it must work wherever those loads did.
 */
export function withTimeout(signal, milliseconds) {
  return anySignal(signal, timeoutSignal(milliseconds));
}

/** A cancellable wait, including cleanup when it finishes normally. */
export function abortableDelay(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Follow `promise`, but reject with the signal's reason as soon as it aborts.
 * The work behind `promise` keeps going: for a caller that stops waiting on
 * something the page still needs (the page's own load and render).
 */
export function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
