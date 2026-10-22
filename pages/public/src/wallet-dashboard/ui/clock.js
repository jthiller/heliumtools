// One minute ticker for every relative time on the page (TimeAgo). It runs
// only while something subscribes: the first subscriber arms one timeout to
// the next wall-clock minute, then a single setInterval; the last one to leave
// clears it. A tab coming back into view ticks at once, since hidden tabs
// throttle timers. "Show all" on a 1,659-row list mounts ~1,650 TimeAgos and
// still runs one interval.

const MINUTE_MS = 60_000;

const listeners = new Set();
let tick = 0;
let timeout = 0;
let interval = 0;

function emit() {
  tick += 1;
  for (const fn of listeners) fn();
}

function onVisibility() {
  if (document.visibilityState === "visible") emit();
}

function start() {
  timeout = setTimeout(() => {
    timeout = 0;
    emit();
    interval = setInterval(emit, MINUTE_MS);
  }, MINUTE_MS - (Date.now() % MINUTE_MS));
  document.addEventListener("visibilitychange", onVisibility);
}

function stop() {
  clearTimeout(timeout);
  clearInterval(interval);
  timeout = 0;
  interval = 0;
  document.removeEventListener("visibilitychange", onVisibility);
}

/** Subscribe to the minute tick; returns the unsubscribe. (useSyncExternalStore's shape.) */
export function subscribeMinute(fn) {
  listeners.add(fn);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}

/** The tick count: changes once a minute (and when the tab comes back into view). */
export function minuteTick() {
  return tick;
}
