import type { CSSObject, SxProps, Theme } from '@mui/material/styles/index.js';

import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
import { rem, sxRem } from '../../../tokens/relative';
import { softSignal } from '../../../tokens/surfaces';
import { actualBarColor, blockToneStyles, breakHatch } from '../ScheduleGrid/schedule-tones';
import type { ScheduleBlockTone } from '../ScheduleGrid/ScheduleGrid.types';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';

/** The container narrow rows answer to (container queries, never media queries). */
export const rootSx: SxProps<Theme> = { containerType: 'inline-size', minWidth: 0, width: '100%', userSelect: 'none' };

/** `@container` below which a row stacks and the coverage and axis rows go. */
function compact(theme: Theme): string {
  return `@container (max-width: ${rem(theme, M.compactBelow)})`;
}

/** Name · track · actions, the coverage row and the axis row share these columns on a computer. */
export const lineSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr) ${rem(theme, M.sideColumn)}`,
  columnGap: rem(theme, M.gap),
  alignItems: 'center',
  [compact(theme)]: { display: 'none' },
});

export const coverageLabelSx: SxProps<Theme> = { fontSize: sxRem(M.meta), color: 'text.secondary' };

export function coverageSx(hours: number): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${hours}, minmax(0, 1fr))`,
    gap: rem(theme, M.coverage.gap),
    height: rem(theme, M.coverage.height),
  });
}

export function coverageCellSx(count: number): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: rem(theme, M.coverage.font),
    borderRadius: rem(theme, M.coverage.radius),
    color: theme.palette.text.primary,
    backgroundColor: count > 0 ? softSignal(theme, 'success') : theme.palette.action.hover,
    border: count > 0 ? `1px solid ${theme.palette.success.main}` : '1px solid transparent',
    minWidth: 0,
    overflow: 'hidden',
  });
}

export const axisSx: SxProps<Theme> = (theme: Theme) => ({
  position: 'relative',
  height: rem(theme, M.axis.height),
  fontSize: rem(theme, M.axis.font),
  color: theme.palette.text.secondary,
  mt: 0.5,
  '& > span': { position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' },
});

export const groupTitleSx: SxProps<Theme> = {
  fontSize: sxRem(M.groupTitle),
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'text.secondary',
  fontWeight: 500,
  pt: 1.5,
  pb: 0.5,
  m: 0,
};

/**
 * One person's row. A computer: name · track · actions on one line. A narrow
 * ruler (a phone): name and actions on top, the track under them, full width.
 */
export const rowSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr) ${rem(theme, M.sideColumn)}`,
  gridTemplateAreas: '"who track actions"',
  columnGap: rem(theme, M.gap),
  alignItems: 'center',
  py: rem(theme, M.rowPaddingY),
  borderBottom: `1px solid ${theme.palette.divider}`,
  [compact(theme)]: {
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateAreas: '"who actions" "track track"',
    rowGap: theme.spacing(1),
    py: theme.spacing(1.5),
  },
});

export const whoSx: SxProps<Theme> = { gridArea: 'who', minWidth: 0 };

export const actionsSx: SxProps<Theme> = {
  gridArea: 'actions',
  display: 'flex',
  gap: 1,
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  minWidth: 0,
};

export const nameButtonSx: SxProps<Theme> = (theme: Theme) => ({
  font: 'inherit',
  background: 'transparent',
  border: 0,
  color: 'inherit',
  p: 0,
  textAlign: 'left',
  cursor: 'pointer',
  minHeight: rem(theme, 24),
  borderRadius: rem(theme, 4),
  '&:hover > span': { textDecoration: 'underline' },
  '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 2) },
});

export const nameSx: SxProps<Theme> = { fontSize: sxRem(M.name), fontWeight: 500, overflowWrap: 'anywhere', display: 'block' };

export function metaSx(tone: 'default' | 'warning'): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'block',
    fontSize: rem(theme, M.meta),
    mt: 0.25,
    overflowWrap: 'anywhere',
    color:
      tone === 'warning'
        ? theme.palette.mode === 'dark'
          ? theme.palette.warning.light
          : theme.palette.warning.dark
        : theme.palette.text.secondary,
  });
}

/** The host's chips under the meta: ONE line; a chip that does not fit shrinks and cuts its label. */
export const chipsSx: SxProps<Theme> = {
  display: 'flex',
  gap: 0.75,
  flexWrap: 'nowrap',
  mt: 0.75,
  minWidth: 0,
  overflow: 'hidden',
  '& > *': { minWidth: 0, flexShrink: 1, maxWidth: '100%' },
};

/** The name and its adornment: one line while both fit, the adornment under the name when not. */
export const nameLineSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 0.75,
  rowGap: 0.25,
  minWidth: 0,
  '& > :first-of-type': { minWidth: 0 },
  '& > [data-dr-adornment]': { flexShrink: 0, display: 'inline-flex' },
};

/** A break inside a block: a hatched band across its height, under its text. `left`/`width` are % of the block. */
export function breakSx(left: number, width: number): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${left}%`,
    width: `${width}%`,
    background: breakHatch(theme, rem(theme, M.breakStripe), rem(theme, M.breakStripe * 2)),
    opacity: 0.7,
    pointerEvents: 'none',
  });
}

/** The hour lines: one every `every` hours of a `hours`-long ruler. */
function hourLines(theme: Theme, hours: number, every: number): string {
  const line = theme.palette.divider;
  const step = `${(100 * every) / hours}%`;
  const hairline = `${FIELD_BORDER_WIDTH}px`;
  return `repeating-linear-gradient(to right, ${line} 0, ${line} ${hairline}, transparent ${hairline}, transparent ${step})`;
}

export function trackSx(opts: { hours: number; tickHours: number; interactive: boolean }): SxProps<Theme> {
  return (theme: Theme) => ({
    gridArea: 'track',
    position: 'relative',
    height: rem(theme, M.track.height),
    borderRadius: rem(theme, M.track.radius),
    backgroundColor: theme.palette.action.hover,
    backgroundImage: hourLines(theme, opts.hours, 1),
    cursor: opts.interactive ? 'crosshair' : 'default',
    touchAction: 'auto',
    outline: 'none',
    '&:focus-visible': { boxShadow: `0 0 0 ${rem(theme, M.ring)} ${theme.palette.primary.main}` },
    [compact(theme)]: {
      height: rem(theme, M.track.compactHeight),
      borderRadius: rem(theme, M.track.compactRadius),
      backgroundImage: hourLines(theme, opts.hours, opts.tickHours),
    },
  });
}

/** Where a bar starts and how long it is, both in % of the track. */
export interface Span {
  at: number;
  share: number;
}

export function blockSx(tone: ScheduleBlockTone, span: Span, opts: { selected: boolean; movable: boolean }): SxProps<Theme> {
  return (theme: Theme): CSSObject => ({
    ...blockToneStyles(theme, tone, true),
    position: 'absolute',
    left: `${span.at}%`,
    width: `${span.share}%`,
    top: rem(theme, M.block.top),
    height: rem(theme, M.block.height),
    boxSizing: 'border-box',
    borderRadius: rem(theme, M.block.radius),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `0 ${rem(theme, M.block.paddingX)}`,
    margin: 0,
    font: 'inherit',
    fontSize: rem(theme, M.block.font),
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    cursor: opts.movable ? 'grab' : 'pointer',
    boxShadow: opts.selected ? `0 0 0 ${rem(theme, M.ring)} ${theme.palette.primary.main}` : 'none',
    '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 1) },
    '& [data-dr-text]': { position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
    '& [data-dr-text="short"]': { display: 'none' },
    [compact(theme)]: {
      top: rem(theme, M.block.compactTop),
      height: rem(theme, M.block.compactHeight),
      '&[data-narrow] [data-dr-text="full"]': { display: 'none' },
      '&[data-narrow] [data-dr-text="short"]': { display: 'inline' },
    },
  });
}

export function handleSx(side: 'l' | 'r'): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side === 'l' ? 'left' : 'right']: 0,
    width: rem(theme, M.handle),
    cursor: 'ew-resize',
  });
}

export function actualSx(span: Span): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    left: `${span.at}%`,
    width: `${span.share}%`,
    top: rem(theme, M.actual.top),
    height: rem(theme, M.actual.height),
    borderRadius: rem(theme, M.actual.radius),
    backgroundColor: actualBarColor(theme),
    pointerEvents: 'none',
    [compact(theme)]: { top: rem(theme, M.actual.compactTop), height: rem(theme, M.actual.compactHeight) },
  });
}

export function actualLabelSx(left: number): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    left: `calc(${left}% + ${rem(theme, M.actualLabel.offset)})`,
    top: rem(theme, M.actualLabel.top),
    fontSize: rem(theme, M.actualLabel.font),
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    [compact(theme)]: { display: 'none' },
  });
}

export function nowSx(left: number): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    left: `${left}%`,
    top: rem(theme, -M.now.overhang),
    bottom: rem(theme, -M.now.overhang),
    width: rem(theme, M.now.width),
    backgroundColor: theme.palette.primary.main,
    pointerEvents: 'none',
  });
}

export const skeletonTrackSx: SxProps<Theme> = (theme: Theme) => ({
  gridArea: 'track',
  height: rem(theme, M.track.height),
  borderRadius: rem(theme, M.track.radius),
  backgroundColor: theme.palette.action.hover,
});

export const skeletonNameSx: SxProps<Theme> = (theme: Theme) => ({
  gridArea: 'who',
  height: rem(theme, M.name),
  width: '60%',
  borderRadius: rem(theme, 4),
  backgroundColor: theme.palette.action.hover,
});
