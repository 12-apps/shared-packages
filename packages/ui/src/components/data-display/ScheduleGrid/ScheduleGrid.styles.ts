import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { CSSObject } from '@mui/material/styles/index.js';

import { rem, sxRem } from '../../../tokens/relative';
import { SCHEDULE_GRID_METRICS as M } from './ScheduleGrid.metrics';
import { blockToneStyles, breakHatch } from './schedule-tones';
import type { ScheduleBlockTone } from './ScheduleGrid.types';

/**
 * The grid's root: the container the column widths answer to (container
 * queries, never media queries — the grid may sit in a narrow pane).
 */
export const rootSx: SxProps<Theme> = { containerType: 'inline-size', minWidth: 0, width: '100%' };

/** The columns a row has: the name, the days, the total (when there is one). */
function trackCount(dayCount: number, hasTotal: boolean): number {
  return 1 + dayCount + (hasTotal ? 1 : 0);
}

/**
 * The column widths, as variables every row reads. On a computer the day
 * columns share what is left (their text ellipsizes) and the grid fits its
 * container. Under a container break each day keeps a minimum width
 * (`dayMin`), so a block still says its hours and note; the grid is then as
 * wide as its minimums and the scroll region around it (`scrollSx`) scrolls
 * it sideways, the name column pinned. Container queries, never media queries.
 */
export function frameSx(dayCount: number, hasTotal: boolean): SxProps<Theme> {
  return (theme: Theme) => {
    const terms = ['var(--sg-name)', `${dayCount} * var(--sg-day)`, `${trackCount(dayCount, hasTotal) - 1} * ${rem(theme, M.gap)}`];
    if (hasTotal) terms.push('var(--sg-total)');
    return {
      '--sg-name': rem(theme, M.nameColumn.wide),
      '--sg-total': rem(theme, M.totalColumn.wide),
      '--sg-day': rem(theme, M.dayMin.wide),
      minWidth: `calc(${terms.join(' + ')})`,
      [`@container (max-width: ${rem(theme, M.containerBreak.medium)})`]: {
        '--sg-name': rem(theme, M.nameColumn.medium),
        '--sg-day': rem(theme, M.dayMin.scrolled),
        // A tablet's grid is read and tapped more than dragged: the grips would
        // eat the room the hours need (Shift+arrows still copy, the middle still moves).
        '& [data-sg-grip]': { display: 'none' },
        '& [data-sg-block]': { paddingLeft: rem(theme, M.cellPadding), paddingRight: rem(theme, M.cellPadding) },
        // The pinned column: the names (and the cell above them, and the group
        // titles) stay while the days scroll under them.
        '& [role="rowheader"], & [data-sg-corner]': {
          position: 'sticky',
          left: 0,
          zIndex: 2,
          backgroundColor: theme.palette.background.default,
          // Covers the gap after it too, so nothing scrolling shows between the name and the days.
          boxShadow: `${rem(theme, M.gap)} 0 0 ${theme.palette.background.default}`,
        },
        '& [data-sg-group-title]': { position: 'sticky', left: 0, width: 'fit-content' },
      },
      [`@container (max-width: ${rem(theme, M.containerBreak.narrow)})`]: {
        '--sg-name': rem(theme, M.nameColumn.narrow),
        '--sg-total': rem(theme, M.totalColumn.narrow),
      },
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    };
  };
}

/**
 * Around the table: under the medium break it scrolls sideways when the days'
 * minimums do not fit (the header row then sticks within it, not the page).
 */
export const scrollSx: SxProps<Theme> = (theme: Theme) => ({
  minWidth: 0,
  [`@container (max-width: ${rem(theme, M.containerBreak.medium)})`]: {
    overflowX: 'auto',
    overscrollBehaviorX: 'contain',
  },
});

/** One line of the grid — the header or a person — as the shared columns. */
/** A style that may sit in an `sx` array next to another. */
type SxPart = (theme: Theme) => CSSObject;

export function rowGridSx(dayCount: number, hasTotal: boolean): SxPart {
  return (theme: Theme) => ({
    display: 'grid',
    gridTemplateColumns: `var(--sg-name) repeat(${dayCount}, minmax(var(--sg-day), 1fr))${hasTotal ? ' var(--sg-total)' : ''}`,
    gap: rem(theme, M.gap),
    alignItems: 'stretch',
  });
}

/** The header row: opaque, and pinned to the top of whatever scrolls the grid. */
export function headerSx(stickyTop: number): SxPart {
  return (theme: Theme) => ({
    position: 'sticky',
    top: rem(theme, stickyTop),
    zIndex: 1,
    backgroundColor: theme.palette.background.default,
    paddingTop: theme.spacing(0.75),
    paddingBottom: theme.spacing(0.75),
  });
}

export function headerCellSx(today: boolean): SxProps<Theme> {
  return {
    fontSize: sxRem(M.headerLabel),
    fontWeight: 500,
    color: today ? 'primary.main' : 'text.primary',
    p: 0.5,
    minWidth: 0,
    '& > *': { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  };
}

export const headerSublabelSx: SxProps<Theme> = {
  fontSize: sxRem(M.headerSublabel),
  fontWeight: 400,
  color: 'text.secondary',
};

export const totalHeaderSx: SxProps<Theme> = {
  fontSize: sxRem(M.total),
  color: 'text.secondary',
  textAlign: 'right',
  alignSelf: 'end',
  p: 0.5,
  pr: 0,
};

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

/** A person's line: one grid row, then the gap below it. */
export const personRowSx: SxPart = (theme: Theme) => ({ marginBottom: rem(theme, M.gap) });

export const nameCellSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  pr: 0.5,
  minWidth: 0,
};

export const totalCellSx: SxProps<Theme> = {
  fontSize: sxRem(M.total),
  color: 'text.secondary',
  textAlign: 'right',
  alignSelf: 'center',
  whiteSpace: 'nowrap',
};

/** What a cell is drawing right now. */
export interface CellLook {
  today: boolean;
  blocked: boolean;
  /** A create or copy will land here: dashed, with the hours as ghost text. */
  target: boolean;
  /** The pointer is over it while a block moves. */
  over: boolean;
  /** The cell's own "+" button may be pressed. */
  interactive: boolean;
}

function hatch(theme: Theme): string {
  const a = theme.palette.action.hover;
  const b = theme.palette.action.selected;
  const w = rem(theme, M.hatch);
  const w2 = rem(theme, M.hatch * 2);
  return `repeating-linear-gradient(135deg, ${a} 0, ${a} ${w}, ${b} ${w}, ${b} ${w2})`;
}

export function cellSx(look: CellLook): SxProps<Theme> {
  return (theme: Theme): CSSObject => {
    const base: CSSObject = {
      position: 'relative',
      minHeight: rem(theme, M.cellMinHeight),
      borderRadius: rem(theme, M.cellRadius),
      backgroundColor: theme.palette.action.hover,
      border: `1px solid ${look.today ? theme.palette.primary.main : theme.palette.divider}`,
      padding: rem(theme, M.cellPadding),
      display: 'flex',
      flexDirection: 'column',
      gap: rem(theme, M.blockGap),
      boxSizing: 'border-box',
      minWidth: 0,
      cursor: look.interactive ? 'cell' : 'default',
    };
    if (look.blocked) {
      return { ...base, background: hatch(theme), borderColor: theme.palette.divider, cursor: 'not-allowed' };
    }
    if (look.target) {
      return {
        ...base,
        border: `${rem(theme, M.targetBorder)} dashed ${theme.palette.primary.main}`,
        backgroundColor: theme.palette.action.selected,
      };
    }
    if (look.over) return { ...base, borderColor: theme.palette.primary.main, backgroundColor: theme.palette.action.selected };
    return base;
  };
}

/** The empty cell's button: the whole cell, a quiet "+" in its middle. */
export const plusButtonSx: SxProps<Theme> = (theme: Theme) => ({
  flex: '1 1 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: 'inherit',
  background: 'transparent',
  border: 0,
  p: 0,
  m: 0,
  color: theme.palette.text.disabled,
  cursor: 'inherit',
  borderRadius: rem(theme, M.cellRadius - M.cellPadding),
  '& svg': { fontSize: rem(theme, M.plusIcon) },
  // The "+" is swapped for the ghost on pointer down: were it the press's
  // target, the browser would drop the click once it left the DOM.
  '& > *': { pointerEvents: 'none' },
  '&:hover': { color: theme.palette.text.secondary },
  '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: 0 },
  // A drag's ghost text sits where the prototype writes it: top left.
  '&[data-ghost]': { justifyContent: 'flex-start', alignItems: 'flex-start' },
});

/** The ghost text of a cell a create or copy will land on. */
export const ghostSx: SxProps<Theme> = (theme: Theme) => ({
  fontSize: rem(theme, M.blockFont),
  fontWeight: 500,
  color: theme.palette.primary.main,
  px: 0.75,
  py: 0.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** A closed day's word ("Afastamento"): one line inside its cell, cut with an ellipsis (the full word in `title`). */
export const blockedLabelSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'block',
  fontSize: rem(theme, M.blockFont),
  color: theme.palette.text.secondary,
  px: 0.75,
  py: 0.5,
  lineHeight: 1.3,
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export function blockSx(tone: ScheduleBlockTone, opts: { selected: boolean; movable: boolean }): SxProps<Theme> {
  return (theme: Theme): CSSObject => ({
    ...blockToneStyles(theme, tone),
    position: 'relative',
    display: 'block',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    font: 'inherit',
    fontSize: rem(theme, M.blockFont),
    fontWeight: 500,
    lineHeight: 1.35,
    borderRadius: rem(theme, M.blockRadius),
    padding: `${rem(theme, M.blockPadding.y)} ${rem(theme, M.blockPadding.end)} ${rem(theme, M.blockPadding.y)} ${rem(theme, M.blockPadding.start)}`,
    cursor: opts.movable ? 'grab' : 'pointer',
    margin: 0,
    boxShadow: opts.selected ? `0 0 0 ${rem(theme, M.ring)} ${theme.palette.primary.main}` : 'none',
    '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, M.ringOffset) },
    '& > [data-sg-line]': { position: 'relative', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '& > [data-sg-line="note"]': { fontWeight: 400 },
  });
}

/** A break inside a block: a hatched band across its height, under its text. */
export function breakSx(span: { start: number; end: number }): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${span.start * 100}%`,
    width: `${(span.end - span.start) * 100}%`,
    background: breakHatch(theme, rem(theme, M.breakStripe.ink), rem(theme, M.breakStripe.ink + M.breakStripe.gap)),
    pointerEvents: 'none',
  });
}

export function gripSx(side: 'l' | 'r'): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side === 'l' ? 'left' : 'right']: 0,
    width: rem(theme, M.grip.width),
    cursor: 'ew-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&::before': {
      content: '""',
      display: 'block',
      width: rem(theme, M.grip.barWidth),
      height: rem(theme, M.grip.barHeight),
      borderRadius: rem(theme, M.grip.barRadius),
      backgroundColor: 'currentColor',
      opacity: 0.5,
    },
  });
}

export const skeletonCellSx: SxProps<Theme> = (theme: Theme) => ({
  minHeight: rem(theme, M.cellMinHeight),
  borderRadius: rem(theme, M.cellRadius),
  backgroundColor: theme.palette.action.hover,
});

export const SR_ONLY_SX: SxProps<Theme> = {
  position: 'absolute',
  width: sxRem(1),
  height: sxRem(1),
  padding: 0,
  margin: sxRem(-1),
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
