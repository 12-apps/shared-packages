import type { CSSObject, SxProps, Theme } from '@mui/material/styles/index.js';

import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
import { rem, sxRem } from '../../../tokens/relative';
import { softSignal } from '../../../tokens/surfaces';
import { actualBarColor, blockToneStyles, breakHatch, dashedLabelGround } from '../ScheduleGrid/schedule-tones';
import type { ScheduleBlockTone } from '../ScheduleGrid/ScheduleGrid.types';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';

/** The container the ruler's layout answers to — named, so no other container between the root and a row can stand in for it. */
const CONTAINER = 'day-ruler';

/** The ruler's root: the named container every layout query reads. */
export const rootSx: SxProps<Theme> = {
  containerType: 'inline-size',
  containerName: CONTAINER,
  minWidth: 0,
  width: '100%',
  userSelect: 'none',
};

/** `@container` below which a row stacks (the coverage and axis rows go full width). Bounds are "from px up". */
function compact(theme: Theme): string {
  return `@container ${CONTAINER} (width < ${rem(theme, M.compactBelow)})`;
}

/** `@container` below which the pane is phone-sized: no coverage row, no axis. Bounds are "from px up". */
function phone(theme: Theme): string {
  return `@container ${CONTAINER} (width < ${rem(theme, M.phoneBelow)})`;
}

/**
 * Name · track: the coverage row and the axis row share these columns with
 * every row on a computer, so the hours line up down the whole ruler.
 */
export const lineSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr)`,
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
 * One person's row. A computer: name (its actions under it) · track, the
 * track the same width on every row whether or not the row has actions. A
 * narrow ruler (a phone): name and actions on top, the track under them, full
 * width.
 */
export const rowSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: `${rem(theme, M.sideColumn)} minmax(0, 1fr)`,
  gridTemplateRows: 'auto auto',
  gridTemplateAreas: '"who track" "actions track"',
  columnGap: rem(theme, M.gap),
  alignItems: 'center',
  py: rem(theme, M.rowPaddingY),
  borderBottom: `1px solid ${theme.palette.divider}`,
  [compact(theme)]: {
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateRows: 'none',
    gridTemplateAreas: '"who actions" "track track"',
    rowGap: theme.spacing(1),
    py: theme.spacing(1.5),
  },
});

export const whoSx: SxProps<Theme> = { gridArea: 'who', minWidth: 0 };

export const actionsSx: SxProps<Theme> = (theme: Theme) => ({
  gridArea: 'actions',
  display: 'flex',
  gap: 1,
  alignItems: 'center',
  justifyContent: 'flex-start',
  flexWrap: 'wrap',
  minWidth: 0,
  pt: rem(theme, M.actionsTop),
  [compact(theme)]: { justifyContent: 'flex-end', pt: 0 },
});

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

/** How far a bar's hit band may reach, in % of the track: the midpoints to its neighbours, or the track's ends. */
export interface HitBounds {
  lo: number;
  hi: number;
}

/**
 * The hit band round a bar on a narrow ruler (FUT-3831): `hitArea` tall and
 * at least `hitArea` wide, centred on the bar, then cut to `bounds` so it never
 * reaches past the midpoint to a neighbour. Positioned in % of the bar's
 * PADDING box (the pseudo-element's containing block, the bar less its
 * border), so a point at `k` bar-widths from the bar's outer left edge is
 * `k × (100% + 2 border) − border`; the px floor is the layout's to resolve.
 */
function hitBand(theme: Theme, span: Span, bounds: HitBounds): CSSObject {
  // Every tone's border is the 1px hairline (`blockToneStyles`), the field border's width.
  const border = `${FIELD_BORDER_WIDTH}px`;
  const half = `max(calc(50% + ${border}), ${rem(theme, M.block.hitArea / 2)})`;
  if (!(span.share > 0)) return { left: `calc(50% - ${half})`, width: `calc(2 * ${half})` };
  const rel = (pct: number): string => `calc(${(pct - span.at) / span.share} * (100% + 2 * ${border}) - ${border})`;
  const left = `max(${rel(bounds.lo)}, calc(50% - ${half}))`;
  const right = `min(${rel(bounds.hi)}, calc(50% + ${half}))`;
  return { left, width: `calc(${right} - ${left})` };
}

export function blockSx(
  tone: ScheduleBlockTone,
  span: Span,
  opts: { selected: boolean; movable: boolean; hit: HitBounds },
): SxProps<Theme> {
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
    // The label sits above the "agora" line (drawn under the blocks): on a fill
    // that is not opaque it takes an opaque ground, so the line never cuts it.
    '& [data-dr-text]': {
      position: 'relative',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      minWidth: 0,
      backgroundColor: dashedLabelGround(theme, tone),
    },
    '& [data-dr-text="short"]': { display: 'none' },
    // By pixels, at every width: the full text, else the start, else nothing — never a cut text.
    '&[data-fit="short"] [data-dr-text="full"]': { display: 'none' },
    '&[data-fit="short"] [data-dr-text="short"]': { display: 'inline' },
    '&[data-fit="none"] [data-dr-text]': { display: 'none' },
    [compact(theme)]: {
      top: rem(theme, M.block.compactTop),
      height: rem(theme, M.block.compactHeight),
      // A 40px × 40px-or-wider hit area round the 20px bar, the look
      // unchanged: the text never overflows (it fits or it is not shown), so
      // the block need not clip.
      overflow: 'visible',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: '50%',
        height: rem(theme, M.block.hitArea),
        transform: 'translateY(-50%)',
        ...hitBand(theme, span, opts.hit),
      },
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

/**
 * "Agora": drawn UNDER the blocks (before them in the track), so it never
 * crosses a block's label — "07:30–1|3:00" at 1280 (FUT-3831). It still shows
 * above and below each bar, where it overhangs the track, and through a
 * block's fill where that fill is not opaque — never through its text.
 */
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
