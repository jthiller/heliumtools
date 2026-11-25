// Keeps the page's gateway list in step with the worker's GET /gateways.
//
// The list is a snapshot that the event stream then patches, and a snapshot is
// only as new as the moment the worker read the aggregator. Two rules stop an
// old one from undoing a newer one, and stop a burst of events from becoming a
// burst of requests:
//
// - Only the newest request's answer is applied. An answer that lands after a
//   later request was started is dropped.
// - refreshSoon() asks for one fetch a moment from now. However many calls ask
//   before it starts, there is one request, and it starts after all of them.
//
// Pure module: no React, so the timing is unit-tested (gatewayList.test.js).

export const REFRESH_DELAY_MS = 1000;

/**
 * @param {object} options
 * @param {() => Promise<any>} options.load      fetch the list
 * @param {(data: any) => void} options.apply    use the newest answer
 * @param {(err: unknown) => void} [options.onError]
 * @param {() => void} [options.onSettled]       the newest request finished, either way
 * @param {number} [options.delayMs]
 */
export function createListRefresher({ load, apply, onError, onSettled, delayMs = REFRESH_DELAY_MS }) {
  let newest = 0;
  let timer = null;

  function clearPending() {
    clearTimeout(timer);
    timer = null;
  }

  /** Fetch now. Covers a pending refreshSoon(), since it starts after it was asked for. */
  async function refresh() {
    clearPending();
    const mine = ++newest;
    try {
      const data = await load();
      if (mine === newest) apply(data);
    } catch (err) {
      onError?.(err);
    } finally {
      if (mine === newest) onSettled?.();
    }
  }

  /** Fetch once, `delayMs` from the first call that asked. */
  function refreshSoon() {
    if (timer != null) return;
    timer = setTimeout(refresh, delayMs);
  }

  /** Drop a pending fetch and ignore any answer still on its way. */
  function cancel() {
    clearPending();
    newest++;
  }

  return { refresh, refreshSoon, cancel };
}
