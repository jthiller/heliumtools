// The map itself: the basemap, the dots and the hover tooltip. It owns the
// camera and the hover, so a pan, a zoom or a pointer move re-renders this
// component (or only its tooltip) and never the page around it. Docs: ./CLAUDE.md.
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import { PROP, topDotAt } from "./data.js";
import { MapTooltip } from "./panels.jsx";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const INITIAL_VIEW = { longitude: 5, latitude: 40, zoom: 1.6, pitch: 0, bearing: 0 };
// The dots smooth their own edges in the fragment shader, so the canvas gets no
// multisampling: with the whole network in view it was most of the frame's GPU
// time and drew the same picture. Nothing reads the canvas back either, so the
// browser may swap the drawing buffer instead of copying it every frame.
const DEVICE_PROPS = { webgl: { antialias: false, preserveDrawingBuffer: false } };

/**
 * The tooltip beside the pointer. It holds its own state, so moving from one
 * dot to the next renders this and nothing else.
 */
const HoverTip = forwardRef(function HoverTip({ win }, ref) {
  const [hover, setHover] = useState(null); // { row, point }
  const el = useRef(null);
  const at = useRef({ x: 0, y: 0 });
  useImperativeHandle(
    ref,
    () => ({
      show(row, point, x, y) {
        at.current = { x, y };
        // Follow the pointer through the DOM: only a change of dot renders.
        if (el.current) {
          el.current.style.left = `${x + 12}px`;
          el.current.style.top = `${y - 12}px`;
        }
        setHover((prev) => (prev && prev.point === point && prev.row === row ? prev : { row, point }));
      },
      hide() {
        setHover(null);
      },
    }),
    [],
  );
  if (!hover) return null;
  return <MapTooltip hover={{ ...hover, packets: hover.point[PROP[win]] }} win={win} tooltipRef={el} initialPos={at.current} />;
});

/**
 * Props: `scene` and `sizes` (data.js buildScene / sceneSizes), `ring` ({ lng,
 * lat } of a clicked spot, or null), `win`, `isDark`, `isMobile`, `boxRef`
 * (the element the map fills), `onPick({ x, y, viewport })` for a click on the
 * map and `onUserMove()` when the user drags or zooms. The ref exposes
 * `fitBounds([west, south, east, north])`.
 */
const MapCanvas = forwardRef(function MapCanvas({ scene, sizes, ring, win, isDark, isMobile, boxRef, onPick, onUserMove }, ref) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const tip = useRef(null);
  const pointer = useRef(null); // where the pointer last was over the map: { x, y }
  const overDot = useRef(false);
  // Read by handlers that outlive a render.
  const live = useRef(null);
  live.current = { scene, sizes, viewState, isMobile };

  // ---- camera ----
  const handleViewStateChange = useCallback(
    ({ viewState: next, interactionState }) => {
      if (interactionState?.isDragging || interactionState?.isZooming || interactionState?.isPanning) onUserMove();
      setViewState(next);
    },
    [onUserMove],
  );

  useImperativeHandle(
    ref,
    () => ({
      fitBounds([w, s, e, n]) {
        const box = boxRef.current;
        if (!box) return;
        // Keep the data clear of the sidebar (desktop) or the sheet (phones).
        const padding = live.current.isMobile ? { top: 32, bottom: 120, left: 24, right: 24 } : { top: 48, bottom: 48, left: 436, right: 56 };
        let target;
        try {
          target = new WebMercatorViewport({ width: box.clientWidth, height: box.clientHeight }).fitBounds(
            [[w, s], [e, n]],
            { padding, maxZoom: 10 },
          );
        } catch {
          // A box smaller than the padding: centre without it.
          target = { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom: 2 };
        }
        setViewState((prev) => ({
          ...prev,
          longitude: target.longitude,
          latitude: target.latitude,
          zoom: Math.max(0.5, target.zoom),
          transitionDuration: 600,
        }));
      },
    }),
    [boxRef],
  );

  // ---- hover ----
  // The page's own hit test over the scene's arrays (data.js topDotAt), not a
  // deck.gl picking pass: no layer is pickable, so a pointer move costs a loop
  // over typed arrays instead of a second render and a GPU readback.
  const hoverAt = useCallback((x, y, viewport) => {
    const { scene: s, sizes: z } = live.current;
    const i = topDotAt(s, z.radius, { x, y, project: (c) => viewport.project(c), unproject: (c) => viewport.unproject(c) });
    overDot.current = i >= 0;
    if (i >= 0) tip.current?.show(s.rows[s.rowIndex[i]], s.points[i], x, y);
    else tip.current?.hide();
  }, []);

  // deck.gl calls this once per frame while the pointer moves over the map
  // (not during a drag), and with x = y = -1 when it leaves.
  const handleHover = useCallback(
    ({ x, y, viewport }) => {
      if (!viewport || !(x >= 0) || !(y >= 0)) {
        pointer.current = null;
        overDot.current = false;
        tip.current?.hide();
        return;
      }
      pointer.current = { x, y };
      hoverAt(x, y, viewport);
    },
    [hoverAt],
  );

  // The dots changed under a resting pointer (a filter moved, more operators
  // loaded): look again, so the tooltip never names a dot that is gone.
  useEffect(() => {
    const at = pointer.current;
    const box = boxRef.current;
    if (!at || !box) return;
    const { longitude, latitude, zoom, pitch, bearing } = live.current.viewState;
    hoverAt(at.x, at.y, new WebMercatorViewport({ width: box.clientWidth, height: box.clientHeight, longitude, latitude, zoom, pitch, bearing }));
  }, [scene, sizes, hoverAt, boxRef]);

  const handleClick = useCallback(
    (info, event) => {
      if (event?.srcEvent?.target?.closest?.(".maplibregl-ctrl")) return;
      if (!info.viewport || info.x == null) return;
      onPick({ x: info.x, y: info.y, viewport: info.viewport });
    },
    [onPick],
  );

  const getCursor = useCallback(({ isDragging }) => (isDragging ? "grabbing" : overDot.current ? "pointer" : "grab"), []);

  // ---- layers ----
  // Positions and colors change only when data loads. deck.gl skips an
  // attribute whose descriptor object is the one it already has, so keeping
  // these two stable means a filter move uploads the two size arrays alone.
  const fixed = useMemo(
    () => ({ getPosition: { value: scene.positions, size: 2 }, getFillColor: { value: scene.colors, size: 4 } }),
    [scene],
  );
  const data = useMemo(
    () => ({
      length: scene.length,
      attributes: { ...fixed, getRadius: { value: sizes.radius, size: 1 }, getLineWidth: { value: sizes.lineWidth, size: 1 } },
    }),
    [scene, fixed, sizes],
  );
  const layers = useMemo(() => {
    const out = [];
    if (data.length) {
      out.push(
        // Every operator in one layer and one draw call, in draw order.
        new ScatterplotLayer({
          id: "hotspots",
          data,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          stroked: true,
          getLineColor: isDark ? [17, 17, 19, 220] : [255, 255, 255, 255],
        }),
      );
    }
    if (ring) {
      out.push(
        new ScatterplotLayer({
          id: "selection",
          data: [ring],
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 15,
          radiusUnits: "pixels",
          filled: false,
          stroked: true,
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          getLineColor: isDark ? [255, 255, 255, 235] : [28, 25, 23, 235],
        }),
      );
    }
    return out;
  }, [data, ring, isDark]);

  return (
    <>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        onHover={handleHover}
        onClick={handleClick}
        controller={true}
        deviceProps={DEVICE_PROPS}
        getCursor={getCursor}
      >
        <MapGL mapStyle={isDark ? BASEMAP_DARK : BASEMAP_LIGHT}>
          <NavigationControl position={isMobile ? "top-left" : "bottom-right"} showCompass={false} />
        </MapGL>
      </DeckGL>
      {!isMobile && <HoverTip ref={tip} win={win} />}
    </>
  );
});

export default memo(MapCanvas);
