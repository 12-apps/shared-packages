import { alpha, type CSSObject, type SxProps, type Theme } from '@mui/material/styles/index.js';

import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
import { rem, sxRem } from '../../../tokens/relative';
import { actualBarColor, blockToneStyles, breakHatch } from '../ScheduleGrid/schedule-tones';
import type { ScheduleBlockTone } from '../ScheduleGrid/ScheduleGrid.types';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';

/** The container narrow rows answer to (container queries, never media queries). */
/**
 * `--dr-actions`: the actions column, 220px when any row has actions and
 * nothing when none does (no empty column at the end of every row).
 */
export function rootSx(hasActions: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    containerType: 'inline-size',
    minWidth: 0,
    width: '100%',
    userSelect: 'none',
    '--dr-actions': hasActions ? rem(theme, M.sideColumn) : '0%',
  });
}

/** `@container` below which a row stacks (the coverage and axis rows go full width). Bounds are "from px up". */
function compact(theme: Theme): string {
  return `@container (width < ${rem(theme, M.compactBelow)})`;
}

/** `@container` below which the pane is phone-sized: no coverage row, no axis. Bounds are "from px up". */
function phone(theme: Theme): string {
  return `@container (width < ${rem(theme, M.phoneBelow)})`;
}

/** Name · track · actions, the coverage row and the axis row share these columns on a computer. */
export const lineSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr) var(--dr-actions)`,
  columnGap: rem(theme, M.gap),
  alignItems: 'center',
  // Stacked: across the full width, like the tracks; the label above the counts.
  [compact(theme)]: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    rowGap: rem(theme, M.coverage.gap),
    '& > span:empty': { display: 'none' },
  },
  [phone(theme)]: { display: 'none' },
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

/**
 * How strongly a staffed hour is filled: the prototype's tonal success step, deeper with each
 * person on the escala (0.18 + 0.09 per person, at most 0.85). An empty hour has none.
 */
export function coverageStrength(count: number): number {
  if (count <= 0) return 0;
  return Math.min(0.85, 0.18 + count * 0.09);
}

export function coverageCellSx(count: number): SxProps<Theme> {
  return (theme: Theme) => {
    const strength = coverageStrength(count);
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: rem(theme, M.coverage.font),
      borderRadius: rem(theme, M.coverage.radius),
      color: theme.palette.text.primary,
      // A tonal fill, as the prototype's coverage line draws it — never an outline (FUT-3831). It is
      // the success colour over the page, so a staffed hour is LIGHTER than an empty one in dark mode
      // and plainly green in light, where the soft-signal blend read as the empty grey. The hairline
      // stays transparent so a count never shifts its cell.
      backgroundColor: strength > 0 ? alpha(theme.palette.success.main, strength) : theme.palette.action.hover,
      border: '1px solid transparent',
      minWidth: 0,
      overflow: 'hidden',
    };
  };
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
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr) var(--dr-actions)`,
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

/** A break inside a block: a hatched band across its height, under its text. `span` is in % of the block. */
export function breakSx(span: Span): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${span.at}%`,
    width: `${span.share}%`,
    background: breakHatch(theme, rem(theme, M.breakStripe.ink), rem(theme, M.breakStripe.ink + M.breakStripe.gap)),
    pointerEvents: 'none',
    // Where the band meets an end of the block it takes the block's rounding:
    // on a phone the block does not clip (its hit area reaches past it).
    ...(span.at <= 0.01 ? { borderTopLeftRadius: 'inherit', borderBottomLeftRadius: 'inherit' } : {}),
    ...(span.at + span.share >= 99.99 ? { borderTopRightRadius: 'inherit', borderBottomRightRadius: 'inherit' } : {}),
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
    '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, M.ringOffset) },
    '& [data-dr-text]': { position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
    '& [data-dr-text="short"]': { display: 'none' },
    [compact(theme)]: {
      top: rem(theme, M.block.compactTop),
      height: rem(theme, M.block.compactHeight),
      // A 40px hit area around the 20px bar, the look unchanged: the text cuts
      // itself (its spans ellipsize), so the block need not clip.
      overflow: 'visible',
      '&::after': {
        content: '""',
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: rem(theme, M.block.hitArea),
        transform: 'translateY(-50%)',
      },
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
  borderRadius: rem(theme, M.skeletonNameRadius),
  backgroundColor: theme.palette.action.hover,
});

/** A group's count line (FUT-3882): plain counts on the hours' columns, a marked hour outlined in the warning ink. */
export function footerCellSx(marked: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: rem(theme, M.coverage.font),
    borderRadius: rem(theme, M.coverage.radius),
    color: marked ? theme.palette.warning.main : theme.palette.text.primary,
    fontWeight: marked ? 500 : 400,
    // The hairline is always there, transparent when unmarked, so a mark never shifts a count.
    border: `1px solid ${marked ? theme.palette.warning.main : 'transparent'}`,
    minWidth: 0,
    overflow: 'hidden',
  });
}

/** A group's trend line: as tall as the coverage row, drawn in the primary colour. */
export const trendSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'block',
  width: '100%',
  height: rem(theme, M.coverage.height + M.coverage.height / 2),
  color: theme.palette.primary.main,
  overflow: 'visible',
});

