import { memo } from "react";

// The group isn't clipped (overflow-hidden would cut the focus ring off): the
// end buttons carry the corners, and a focused button rises over its neighbors.
const BTN =
  "flex h-9 w-9 items-center justify-center border-0 bg-surface-raised p-0 text-wd-ink transition-colors first:rounded-t-[10px] last:rounded-b-[10px] hover:bg-wd-well focus-visible:relative focus-visible:z-[1] max-md:h-11 max-md:w-11 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

/**
 * The map's own controls, top right: Zoom in, Zoom out and Fit (back to the
 * fleet, or to the list filter's matches). 36 px, 44 px on phones and touch screens.
 * They sit outside the canvas, so a tap on them never changes the selection.
 */
export const MapControls = memo(function MapControls({ onZoomIn, onZoomOut, onFit, fitLabel = "Fit to fleet" }) {
  return (
    <div className="absolute right-3.5 top-3.5 z-[7] flex flex-col rounded-[10px] bg-surface-raised shadow-soft">
      <button type="button" aria-label="Zoom in" onClick={onZoomIn} className={`${BTN} text-lg font-medium`}>
        <span aria-hidden="true">+</span>
      </button>
      <button type="button" aria-label="Zoom out" onClick={onZoomOut} className={`${BTN} border-t border-wd-line text-lg font-medium`}>
        <span aria-hidden="true">−</span>
      </button>
      <button type="button" aria-label={fitLabel} onClick={onFit} className={`${BTN} border-t border-wd-line text-[11px] font-semibold text-wd-ink-2`}>
        Fit
      </button>
    </div>
  );
});

export default MapControls;
