import Box from '@mui/material/Box/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import { METRES_PER_DEGREE, type PlaneBox, type PlanePoint, type Projection } from './RegionMap.helpers';
import type { RegionMapModel } from './RegionMap.hooks';
import type { RegionMapCenter, RegionMapCopy, RegionMapDot, RegionMapGhost, RegionMapPin } from './RegionMap.types';

/**
 * The movable centre of a `RegionMap` (`pin`, `ghost`, `dots`): a pin the
 * viewer drags with a mouse or one finger, or focuses and nudges with the
 * arrow keys, while the VIEW stays where `center` put it — so the areas never
 * slide under a dragging finger. The circles follow the pin; a dashed ring
 * and dot stay at `ghost`; `dots` are small points (filled or hollow).
 *
 * The pin is HTML over the drawing, at its point by percent like the labels,
 * carrying `data-region-pin` so a host that zooms the drawing's layers can
 * move it with them. Its moves are reported, never applied: the host passes
 * the new point back.
 */

/** The movable centre and what is drawn with it, as the drawing receives it. */
export interface Moving {
  center: RegionMapCenter;
  pin?: RegionMapPin;
  ghost?: RegionMapGhost;
  dots?: readonly RegionMapDot[];
  copy: RegionMapCopy;
}

type DrawnModel = Pick<RegionMapModel, 'projection' | 'radii'> & { view: PlaneBox };

/**
 * What the movable centre draws inside the SVG: the circles around the pin
 * (else `fallback`, the centre's own circles), the ghost, and the dots.
 */
export function PinShapes({ model, moving, testId, theme, fallback }: { model: DrawnModel; moving: Moving | undefined; testId: string; theme: Theme; fallback: React.ReactNode }): React.JSX.Element {
  const { projection, view } = model;
  if (!moving || !projection) return <>{fallback}</>;
  const pinAt = moving.pin ? projection.project([moving.pin.at.latitude, moving.pin.at.longitude]) : null;
  return (
    <>
      {pinAt ? <PinCircles at={pinAt} radii={model.radii} theme={theme} /> : fallback}
      {pinAt && moving.ghost ? <GhostShapes ghost={moving.ghost} pinAt={pinAt} projection={projection} view={view} testId={testId} theme={theme} /> : null}
      {moving.dots ? <Dots dots={moving.dots} projection={projection} view={view} testId={testId} theme={theme} /> : null}
    </>
  );
}

/** What the movable centre draws over the SVG, in HTML: the pin and the scale bar. */
export function PinOverlay({
  model,
  moving,
  svgRef,
  testId,
  theme,
}: {
  model: DrawnModel;
  moving: Moving | undefined;
  svgRef: React.RefObject<SVGSVGElement | null>;
  testId: string;
  theme: Theme;
}): React.JSX.Element | null {
  if (!moving || !model.projection) return null;
  return (
    <>
      {moving.pin ? <PinMarker pin={moving.pin} center={moving.center} projection={model.projection} view={model.view} svgRef={svgRef} testId={testId} theme={theme} /> : null}
      <ScaleBar view={model.view} copy={moving.copy} svgRef={svgRef} testId={testId} theme={theme} />
    </>
  );
}

/** The flat projection's inverse around `center` — it is linear. */
export function latLngAt(center: RegionMapCenter, point: PlanePoint): RegionMapCenter {
  const kx = METRES_PER_DEGREE * Math.cos((center.latitude * Math.PI) / 180);
  return { latitude: center.latitude - point.y / METRES_PER_DEGREE, longitude: center.longitude + point.x / kx };
}

/** A point of the plane as fractions of the view (0..1 across, 0..1 down). */
function fractionOf(view: PlaneBox, point: PlanePoint): { x: number; y: number } {
  return { x: (point.x - view.minX) / view.spanX, y: (point.y - view.minY) / view.spanY };
}

/** Keep a fraction inside the view, a hair in from its edge (the mock's clamp). */
const clampFraction = (value: number): number => Math.min(0.995, Math.max(0.005, value));

/** A plane point kept inside the view by the same clamp a drag gets. */
function clampToView(view: PlaneBox, point: PlanePoint): PlanePoint {
  const at = fractionOf(view, point);
  return { x: view.minX + clampFraction(at.x) * view.spanX, y: view.minY + clampFraction(at.y) * view.spanY };
}

/** Arrow keys, as metres east and north per press. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** One arrow key: 50 m unless the host says otherwise. */
const DEFAULT_STEP_METRES = 50;

interface PinLayerProps {
  pin: RegionMapPin;
  center: RegionMapCenter;
  projection: Projection;
  view: PlaneBox;
  /** The drawing's SVG, whose on-screen box maps a pointer to the plane (zoomed or not). */
  svgRef: React.RefObject<SVGSVGElement | null>;
  testId: string;
  theme: Theme;
}

/** The draggable pin, as HTML over the drawing. */
export function PinMarker({ pin, center, projection, view, svgRef, testId, theme }: PinLayerProps): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const live = React.useRef({ pin, center, view });
  live.current = { pin, center, view };
  usePinDrag(ref, svgRef, live);
  const at = fractionOf(view, projection.project([pin.at.latitude, pin.at.longitude]));
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const arrow = ARROWS[event.key];
    if (!arrow || pin.disabled) return;
    event.preventDefault();
    const step = pin.stepMetres ?? DEFAULT_STEP_METRES;
    const plane = projection.project([pin.at.latitude, pin.at.longitude]);
    const next = latLngAt(center, clampToView(view, { x: plane.x + arrow[0] * step, y: plane.y - arrow[1] * step }));
    pin.onMove?.(next);
    pin.onDrop(next);
  };
  return (
    <Box
      ref={ref}
      role="button"
      tabIndex={pin.disabled ? -1 : 0}
      aria-label={pin.ariaLabel}
      aria-disabled={pin.disabled || undefined}
      onKeyDown={onKeyDown}
      data-testid={`${testId}-pin`}
      data-region-pin=""
      style={{ left: `${(at.x * 100).toFixed(3)}%`, top: `${(at.y * 100).toFixed(3)}%` }}
      sx={{
        position: 'absolute',
        transform: 'translate(-50%, -100%)',
        width: rem(theme, 44),
        height: rem(theme, 48),
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        cursor: pin.disabled ? 'default' : 'grab',
        touchAction: 'none',
        zIndex: 2,
        borderRadius: 1,
        '&:focus-visible': { outline: `${rem(theme, 2)} solid`, outlineColor: 'primary.main', outlineOffset: rem(theme, 2) },
      }}
    >
      <Box component="svg" viewBox="0 0 32 42" aria-hidden="true" sx={{ width: rem(theme, 32), height: rem(theme, 42) }}>
        <path
          d="M16 41C16 41 3 25 3 15.5A13 13 0 1 1 29 15.5C29 25 16 41 16 41Z"
          fill={theme.palette.primary.main}
          stroke={theme.palette.background.paper}
          strokeWidth={2}
        />
        <circle cx="16" cy="15.5" r="5" fill={theme.palette.background.paper} />
      </Box>
      <Box
        component="span"
        aria-hidden
        sx={{
          position: 'absolute',
          left: '88%',
          top: 0,
          px: 0.75,
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.primary',
          fontSize: rem(theme, 12),
          fontWeight: 600,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {pin.label}
      </Box>
    </Box>
  );
}

/**
 * The pointer drag: native listeners on the pin, so a host's own listeners on
 * the drawing (a pan, a tap) never see the press; captured, so a finger that
 * leaves the pin keeps dragging it; clamped inside the view.
 */
function usePinDrag(
  ref: React.RefObject<HTMLDivElement | null>,
  svgRef: React.RefObject<SVGSVGElement | null>,
  live: React.RefObject<{ pin: RegionMapPin; center: RegionMapCenter; view: PlaneBox }>,
): void {
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let dragging: number | null = null;
    // Where the last move put the pin: a cancelled gesture (a browser may
    // report 0,0 for it) rests there rather than jumping to the corner.
    let last: RegionMapCenter | null = null;
    const pointAt = (event: PointerEvent): RegionMapCenter | null => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      const { view, center } = live.current;
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
      const fx = clampFraction((event.clientX - box.left) / box.width);
      const fy = clampFraction((event.clientY - box.top) / box.height);
      return latLngAt(center, { x: view.minX + fx * view.spanX, y: view.minY + fy * view.spanY });
    };
    const down = (event: PointerEvent): void => {
      event.stopPropagation();
      if (live.current.pin.disabled) return;
      event.preventDefault();
      dragging = event.pointerId;
      last = null;
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      if (dragging !== event.pointerId) return;
      event.stopPropagation();
      const at = pointAt(event);
      if (!at) return;
      last = at;
      live.current.pin.onMove?.(at);
    };
    const up = (event: PointerEvent): void => {
      if (dragging !== event.pointerId) return;
      event.stopPropagation();
      dragging = null;
      const at = event.type === 'pointercancel' ? last : (pointAt(event) ?? last);
      if (at) live.current.pin.onDrop(at);
    };
    // A click that ends a drag is the drag's, not a tap on the area under it.
    const click = (event: MouseEvent): void => event.stopPropagation();
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('click', click);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('click', click);
    };
  }, [ref, svgRef, live]);
}

/** The circles around the pin: solid in the primary colour, faintly filled. */
export function PinCircles({ at, radii, theme }: { at: PlanePoint; radii: readonly number[]; theme: Theme }): React.JSX.Element {
  return (
    <>
      {radii.map((radius) => (
        <circle
          key={radius}
          cx={at.x}
          cy={at.y}
          r={radius}
          fill={alpha(theme.palette.primary.main, 0.06)}
          stroke={theme.palette.primary.main}
          strokeWidth={2.25}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/** Where the circles stood: a dashed ring and dot at `ghost`, and a dashed line from it to the pin. */
export function GhostShapes({
  ghost,
  pinAt,
  projection,
  view,
  testId,
  theme,
}: {
  ghost: RegionMapGhost;
  pinAt: PlanePoint;
  projection: Projection;
  view: PlaneBox;
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const at = projection.project([ghost.at.latitude, ghost.at.longitude]);
  const stroke = theme.palette.text.secondary;
  const common = { fill: 'none', stroke, vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' } as const;
  return (
    <g data-testid={`${testId}-ghost`}>
      <circle cx={at.x} cy={at.y} r={ghost.radiusMetres} strokeWidth={1.5} strokeDasharray="6 5" {...common} />
      <line x1={at.x} y1={at.y} x2={pinAt.x} y2={pinAt.y} strokeWidth={1.5} strokeDasharray="4 4" {...common} />
      <circle cx={at.x} cy={at.y} r={view.spanX / 110} strokeWidth={2} strokeDasharray="3 2" {...common} fill={alpha(theme.palette.background.paper, 0.7)} />
    </g>
  );
}

/** The dots: filled with the ink, or hollow (paper with an ink ring). */
export function Dots({ dots, projection, view, testId, theme }: { dots: readonly RegionMapDot[]; projection: Projection; view: PlaneBox; testId: string; theme: Theme }): React.JSX.Element {
  return (
    <g data-testid={`${testId}-dots`}>
      {dots.map((dot) => {
        const at = projection.project([dot.at.latitude, dot.at.longitude]);
        return (
          <circle
            key={dot.id}
            cx={at.x}
            cy={at.y}
            r={view.spanX / 150}
            fill={dot.filled ? theme.palette.text.primary : theme.palette.background.paper}
            stroke={theme.palette.text.primary}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-filled={dot.filled ? 'true' : 'false'}
          />
        );
      })}
    </g>
  );
}

/** Nice lengths a scale bar may take, in metres. */
const SCALE_STEPS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

/** The longest nice length that fits in a quarter of the drawing's width. */
export function scaleMetres(view: PlaneBox): number {
  const quarter = view.spanX / 4;
  return SCALE_STEPS.filter((step) => step <= quarter).at(-1) ?? SCALE_STEPS[0]!;
}

/**
 * A scale bar, bottom-left, when the host gives `copy.scale`. It reads what is
 * on screen: a host that zooms the drawing's layers (a CSS scale on the SVG)
 * shows fewer metres per pixel, so after every render the bar compares the
 * SVG's drawn width with its laid-out width — both off the SVG itself — and
 * spans the drawing's own width, so its share of it is a share of the view.
 */
export function ScaleBar({
  view,
  copy,
  svgRef,
  testId,
  theme,
}: {
  view: PlaneBox;
  copy: RegionMapCopy;
  svgRef: React.RefObject<SVGSVGElement | null>;
  testId: string;
  theme: Theme;
}): React.JSX.Element | null {
  // What the drawing shows on screen: its laid-out width, and its width as
  // drawn (a host's CSS scale on the SVG), both read off the SVG itself.
  const [screen, setScreen] = React.useState({ laidOut: 0, drawn: 0 });
  const wanted = copy.scale !== undefined;
  React.useLayoutEffect(() => {
    if (!wanted) return;
    const svg = svgRef.current;
    const next = { laidOut: svg?.clientWidth ?? 0, drawn: svg?.getBoundingClientRect().width ?? 0 };
    if (next.laidOut !== screen.laidOut || Math.abs(next.drawn - screen.drawn) > 0.5) setScreen(next);
  });
  if (!copy.scale) return null;
  const zoom = screen.laidOut > 0 && screen.drawn > 0 ? screen.drawn / screen.laidOut : 1;
  const metres = scaleMetres({ ...view, spanX: view.spanX / zoom });
  // The bar's share of the drawing's width: metres on screen over the metres the width shows.
  const share = (metres * zoom) / view.spanX;
  return (
    <Box
      data-testid={`${testId}-scale`}
      aria-hidden
      sx={{ position: 'absolute', left: 0, right: 0, bottom: rem(theme, 10), pointerEvents: 'none', zIndex: 1 }}
    >
      <Box component="span" sx={{ display: 'block', ml: rem(theme, 10), fontSize: rem(theme, 11), color: 'text.secondary' }}>
        {copy.scale(metres)}
      </Box>
      <Box
        component="span"
        sx={{ display: 'block', height: rem(theme, 4), ml: rem(theme, 10), width: `${(share * 100).toFixed(2)}%`, borderStyle: 'solid', borderWidth: `0 ${rem(theme, 1.5)} ${rem(theme, 1.5)}`, borderColor: 'text.secondary' }}
      />
    </Box>
  );
}
