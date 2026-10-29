import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem, remPx } from '../../../tokens/relative';

import { labelPosition, type AreaGeometry, type DrawnRegion, type PlaneBox } from './RegionMap.helpers';
import type { RegionMapModel } from './RegionMap.hooks';
import { labelOrder, placeLabels } from './RegionMap.labels';

export interface RegionMapDrawingProps {
  model: RegionMapModel & { view: PlaneBox };
  showCenter: boolean;
  highlightedIds: readonly string[];
  maxHeight: string | undefined;
  label: string;
  tappable: boolean;
  testId: string;
  theme: Theme;
}

/**
 * The drawing: one `role="img"`, square, with HTML labels laid over it.
 *
 * Strokes are `non-scaling-stroke` and labels are HTML at theme sizes, so the
 * picture reads the same at 320 px and 1600 px; `maxHeight` caps it on a wide
 * screen. Where it sits in a wider box is the host's call.
 *
 * The base areas are a memoised layer: a toggle changes `excluded`, not the
 * geometry, so only the hatch, highlight and label layers re-render.
 */
export function RegionMapDrawing({
  model,
  showCenter,
  highlightedIds,
  maxHeight,
  label,
  tappable,
  testId,
  theme,
}: RegionMapDrawingProps): React.JSX.Element {
  const hatchId = `${React.useId().replace(/:/g, '')}-hatch`;
  const { view, drawn } = model;
  const wanted = new Set(highlightedIds);
  const highlighted = drawn.filter((d) => wanted.has(d.id));
  // Highlighted, then excluded, then larger, then by name: the order labels
  // claim their place in, so a collision hides the less important one.
  const labelled = labelOrder(drawn.filter((d) => d.excluded || wanted.has(d.id)), wanted);
  const boxRef = React.useRef<HTMLDivElement>(null);
  useLabelPlacement(boxRef, labelled.map((d) => d.id).join('|'), remPx(theme, 4));
  const base = drawn.map((d) => ({ id: d.id, name: d.name, geometry: d.geometry, outside: d.outside === true }));
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: maxHeight,
        maxHeight,
        aspectRatio: '1 / 1',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
      data-testid={`${testId}-canvas`}
      ref={boxRef}
    >
      <svg
        viewBox={`${view.minX} ${view.minY} ${view.spanX} ${view.spanY}`}
        role="img"
        aria-label={label}
        onPointerDown={model.onPointerDown}
        onClick={model.onClick}
        style={{ display: 'block', width: '100%', height: '100%', cursor: tappable ? 'pointer' : 'default' }}
      >
        <Hatch id={hatchId} pitch={view.spanX / 70} theme={theme} />
        <BaseAreas areas={base} testId={testId} theme={theme} />
        <ExcludedAreas drawn={drawn} hatchId={hatchId} testId={testId} theme={theme} />
        <Circles radii={model.radii} theme={theme} />
        <Highlights areas={highlighted} testId={testId} theme={theme} />
        {showCenter && (
          <circle
            cx={0}
            cy={0}
            r={view.spanX / 90}
            fill={theme.palette.primary.main}
            stroke={theme.palette.background.paper}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid={`${testId}-center`}
          />
        )}
      </svg>
      {labelled.map((d) => (
        <AreaLabel key={`l-${d.id}`} area={d} view={view} testId={testId} theme={theme} />
      ))}
    </Box>
  );
}

/** The highlighted areas, drawn over everything but the centre. */
function Highlights({
  areas,
  testId,
  theme,
}: {
  areas: readonly DrawnRegion[];
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  return (
    <>
      {areas.map((d) => (
        <path
          key={`h-${d.id}`}
          d={d.geometry.path}
          fillRule="evenodd"
          vectorEffect="non-scaling-stroke"
          fill={alpha(theme.palette.primary.main, 0.3)}
          stroke={theme.palette.primary.main}
          strokeWidth={2.5}
          pointerEvents="none"
          data-testid={`${testId}-highlight-${d.id}`}
        />
      ))}
    </>
  );
}

/** The hatch an excluded area is filled with: lines, not a colour. */
function Hatch({ id, pitch, theme }: { id: string; pitch: number; theme: Theme }): React.JSX.Element {
  return (
    <defs>
      <pattern id={id} width={pitch} height={pitch} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={pitch} height={pitch} fill={alpha(theme.palette.text.primary, 0.1)} />
        <rect width={pitch / 3} height={pitch} fill={theme.palette.text.secondary} />
      </pattern>
    </defs>
  );
}

interface BaseArea {
  id: string;
  name: string;
  geometry: AreaGeometry;
  outside: boolean;
}

interface BaseAreasProps {
  areas: readonly BaseArea[];
  testId: string;
  theme: Theme;
}

/** Same areas, same geometry objects, same look: nothing to re-render. */
function sameBase(a: BaseAreasProps, b: BaseAreasProps): boolean {
  if (a.theme !== b.theme || a.testId !== b.testId || a.areas.length !== b.areas.length) return false;
  return a.areas.every((area, i) => {
    const other = b.areas[i]!;
    return (
      area.id === other.id &&
      area.geometry === other.geometry &&
      area.outside === other.outside &&
      area.name === other.name
    );
  });
}

/** Every area's fill and border — the tap targets. Memoised: see `sameBase`. */
const BaseAreas = React.memo(function BaseAreas({ areas, testId, theme }: BaseAreasProps): React.JSX.Element {
  const { palette } = theme;
  return (
    <>
      {areas.map((d) => (
        <path
          key={d.id}
          d={d.geometry.path}
          fillRule="evenodd"
          vectorEffect="non-scaling-stroke"
          fill={d.outside ? palette.background.paper : palette.action.hover}
          stroke={palette.divider}
          strokeWidth={1}
          data-region-id={d.id}
          data-testid={`${testId}-area-${d.id}`}
        >
          <title>{d.name}</title>
        </path>
      ))}
    </>
  );
}, sameBase);

/** The hatch over every excluded area. */
function ExcludedAreas({
  drawn,
  hatchId,
  testId,
  theme,
}: {
  drawn: readonly DrawnRegion[];
  hatchId: string;
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  return (
    <>
      {drawn
        .filter((d) => d.excluded)
        .map((d) => (
          <path
            key={`x-${d.id}`}
            d={d.geometry.path}
            fillRule="evenodd"
            vectorEffect="non-scaling-stroke"
            fill={`url(#${hatchId})`}
            stroke={theme.palette.text.secondary}
            strokeWidth={1.5}
            pointerEvents="none"
            data-testid={`${testId}-excluded-${d.id}`}
          />
        ))}
    </>
  );
}

/** The dashed circles around the centre. */
function Circles({ radii, theme }: { radii: readonly number[]; theme: Theme }): React.JSX.Element {
  return (
    <>
      {radii.map((radius) => (
        <circle
          key={radius}
          cx={0}
          cy={0}
          r={radius}
          fill="none"
          stroke={theme.palette.info.main}
          strokeWidth={1.75}
          strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/**
 * Places every label the drawing carries, in their DOM order (the priority
 * order), and hides one that would overlap a label already drawn
 * (`placeLabels`). Measured by a ResizeObserver, never in a layout effect: its
 * first call comes after the browser's own layout, so mounting a label on a
 * tap forces no synchronous reflow of the drawing.
 */
function useLabelPlacement(boxRef: React.RefObject<HTMLDivElement | null>, key: string, gap: number): void {
  React.useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const labels = Array.from(box.querySelectorAll<HTMLElement>('[data-region-label]'));
    const place = (): void => {
      const spanX = box.clientWidth;
      const spanY = box.clientHeight;
      if (spanX === 0 || spanY === 0) return;
      const placed = placeLabels(
        labels.map((label) => ({
          fractionX: Number(label.dataset.fractionX),
          fractionY: Number(label.dataset.fractionY),
          spanX: label.offsetWidth,
          spanY: label.offsetHeight,
        })),
        { spanX, spanY },
        gap,
      );
      placed.forEach(({ x, y, visible }, index) => {
        const label = labels[index]!;
        label.style.left = `${(x / spanX) * 100}%`;
        label.style.top = `${(y / spanY) * 100}%`;
        label.style.visibility = visible ? 'visible' : 'hidden';
        label.dataset.hidden = visible ? 'false' : 'true';
      });
    };
    const observer = new ResizeObserver(place);
    observer.observe(box);
    for (const label of labels) observer.observe(label);
    return () => observer.disconnect();
  }, [boxRef, key, gap]);
}

/**
 * An area's name over the drawing, at the theme's type size whatever the
 * width. Placed — and hidden on a collision — by {@link useLabelPlacement}.
 * Decorative (`aria-hidden`): the area's name is its `<title>` and its row in
 * the list.
 */
function AreaLabel({
  area,
  view,
  testId,
  theme,
}: {
  area: DrawnRegion;
  view: PlaneBox;
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const at = labelPosition(area.geometry.rings, view);
  const halo = `0 0 ${rem(theme, 3)} ${theme.palette.background.paper}`;
  return (
    <Typography
      component="span"
      aria-hidden
      data-testid={`${testId}-label-${area.id}`}
      data-region-label=""
      data-fraction-x={at.fractionX}
      data-fraction-y={at.fractionY}
      // Position as an inline style, not `sx`: a per-label class would insert
      // a new CSS rule (and a style recalculation) on every tap.
      style={{
        left: `${(at.fractionX * 100).toFixed(2)}%`,
        top: `${(at.fractionY * 100).toFixed(2)}%`,
      }}
      sx={{
        position: 'absolute',
        transform: 'translate(-50%, -50%)',
        fontSize: rem(theme, 12),
        fontWeight: 700,
        lineHeight: 1.1,
        textAlign: 'center',
        maxWidth: '45%',
        color: 'text.primary',
        pointerEvents: 'none',
        textShadow: `${halo}, ${halo}`,
      }}
    >
      {area.name}
    </Typography>
  );
}
