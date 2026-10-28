import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import { labelPosition, type PlaneBox } from './RegionMap.helpers';
import type { RegionMapModel } from './RegionMap.hooks';

type Drawn = RegionMapModel['drawn'][number];

export interface RegionMapDrawingProps {
  model: RegionMapModel & { view: PlaneBox };
  showCenter: boolean;
  highlightedId: string | null;
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
 * screen and centres it.
 */
export function RegionMapDrawing({
  model,
  showCenter,
  highlightedId,
  maxHeight,
  label,
  tappable,
  testId,
  theme,
}: RegionMapDrawingProps): React.JSX.Element {
  const hatchId = `${React.useId().replace(/:/g, '')}-hatch`;
  const { view, drawn } = model;
  const highlighted = drawn.find((d) => d.id === highlightedId) ?? null;
  const labelled = [
    ...drawn.filter((d) => d.excluded),
    ...(highlighted && !highlighted.excluded ? [highlighted] : []),
  ];
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: maxHeight,
        maxHeight,
        aspectRatio: '1 / 1',
        mx: 'auto',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
      data-testid={`${testId}-canvas`}
    >
      <svg
        viewBox={`${view.minX} ${view.minY} ${view.spanX} ${view.spanY}`}
        role="img"
        aria-label={label}
        onClick={model.onClick}
        style={{ display: 'block', width: '100%', height: '100%', cursor: tappable ? 'pointer' : 'default' }}
      >
        <Hatch id={hatchId} pitch={view.spanX / 70} theme={theme} />
        <AreaLayers
          drawn={drawn}
          hatchId={hatchId}
          radii={model.radii}
          highlighted={highlighted}
          testId={testId}
          theme={theme}
        />
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

/** Areas, then the hatch over the excluded ones, the circles and the highlight. */
function AreaLayers({
  drawn,
  hatchId,
  radii,
  highlighted,
  testId,
  theme,
}: {
  drawn: readonly Drawn[];
  hatchId: string;
  radii: readonly number[];
  highlighted: Drawn | null;
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const { palette } = theme;
  const line = { vectorEffect: 'non-scaling-stroke', fillRule: 'evenodd' } as const;
  return (
    <>
      {drawn.map((d) => (
        <path
          key={d.id}
          {...line}
          d={d.path}
          fill={d.outside ? palette.background.paper : palette.action.hover}
          stroke={palette.divider}
          strokeWidth={1}
          data-region-id={d.id}
          data-testid={`${testId}-area-${d.id}`}
        >
          <title>{d.name}</title>
        </path>
      ))}
      {drawn
        .filter((d) => d.excluded)
        .map((d) => (
          <path
            key={`x-${d.id}`}
            {...line}
            d={d.path}
            fill={`url(#${hatchId})`}
            stroke={palette.text.secondary}
            strokeWidth={1.5}
            pointerEvents="none"
            data-testid={`${testId}-excluded-${d.id}`}
          />
        ))}
      {radii.map((radius) => (
        <circle
          key={radius}
          cx={0}
          cy={0}
          r={radius}
          fill="none"
          stroke={palette.info.main}
          strokeWidth={1.75}
          strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
      {highlighted && (
        <path
          {...line}
          d={highlighted.path}
          fill={alpha(palette.primary.main, 0.3)}
          stroke={palette.primary.main}
          strokeWidth={2.5}
          pointerEvents="none"
          data-testid={`${testId}-highlight`}
        />
      )}
    </>
  );
}

/** An area's name over the drawing, at the theme's type size whatever the width. */
function AreaLabel({
  area,
  view,
  testId,
  theme,
}: {
  area: Drawn;
  view: PlaneBox;
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const at = labelPosition(area.plane.rings, view);
  const halo = `0 0 ${rem(theme, 3)} ${theme.palette.background.paper}`;
  return (
    <Typography
      component="span"
      aria-hidden
      data-testid={`${testId}-label-${area.id}`}
      sx={{
        position: 'absolute',
        left: `${(at.fractionX * 100).toFixed(2)}%`,
        top: `${(at.fractionY * 100).toFixed(2)}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: rem(theme, 11),
        fontWeight: 700,
        lineHeight: 1.1,
        textAlign: 'center',
        maxWidth: '40%',
        color: 'text.primary',
        pointerEvents: 'none',
        textShadow: `${halo}, ${halo}`,
      }}
    >
      {area.name}
    </Typography>
  );
}
