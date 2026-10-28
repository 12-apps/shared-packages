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

/**
 * The column widths, as variables every row reads: the name column narrows
 * with the container, the day columns share what is left and may shrink to
 * nothing (their text ellipsizes), so the grid never overflows sideways.
 */
export const frameSx: SxProps<Theme> = (theme: Theme) => ({
  '--sg-name': rem(theme, M.nameColumn.wide),
  '--sg-total': rem(theme, M.totalColumn.wide),
  '& [data-sg-col="short"]': { display: 'none' },
  [`@container (max-width: ${rem(theme, M.containerBreak.medium)})`]: {
    '--sg-name': rem(theme, M.nameColumn.medium),
  },
  [`@container (max-width: ${rem(theme, M.containerBreak.narrow)})`]: {
    '--sg-name': rem(theme, M.nameColumn.narrow),
    '--sg-total': rem(theme, M.totalColumn.narrow),
    // A narrow grid is read, not dragged (a phone shows the day list): the
    // grips would cover the whole block, and the columns say their short name.
    '& [data-sg-grip]': { display: 'none' },
    '& [data-sg-block]': { paddingLeft: rem(theme, M.cellPadding), paddingRight: rem(theme, M.cellPadding) },
    '& [data-sg-col="short"]': { display: 'block' },
    '& [role="columnheader"]': { paddingLeft: 0, paddingRight: 0, textAlign: 'center' },
    '& [data-sg-col="full"]:has(+ [data-sg-col="short"]), & [data-sg-col="sub"]': { display: 'none' },
  },
  display: 'flex',
  flexDirection: 'column',
  userSelect: 'none',
});

/** One line of the grid — the header or a person — as the shared columns. */
/** A style that may sit in an `sx` array next to another. */
type SxPart = (theme: Theme) => CSSObject;

export function rowGridSx(dayCount: number, hasTotal: boolean): SxPart {
  return (theme: Theme) => ({
    display: 'grid',
    gridTemplateColumns: `var(--sg-name) repeat(${dayCount}, minmax(0, 1fr))${hasTotal ? ' var(--sg-total)' : ''}`,
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

/** The name as a button: it reads as text, underlines under the pointer. */
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

export const nameTextSx: SxProps<Theme> = {
  fontSize: sxRem(M.rowName),
  fontWeight: 500,
  overflowWrap: 'anywhere',
  display: 'block',
};

export function metaSx(tone: 'default' | 'warning'): SxProps<Theme> {
  return (theme: Theme) => ({
    fontSize: rem(theme, M.rowMeta),
    color:
      tone === 'warning'
        ? theme.palette.mode === 'dark'
          ? theme.palette.warning.light
          : theme.palette.warning.dark
        : theme.palette.text.secondary,
    mt: 0.25,
    overflowWrap: 'anywhere',
  });
}

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
        border: `${rem(theme, 1.5)} dashed ${theme.palette.primary.main}`,
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

export const blockedLabelSx: SxProps<Theme> = (theme: Theme) => ({
  fontSize: rem(theme, M.blockFont),
  color: theme.palette.text.secondary,
  px: 0.75,
  py: 0.5,
  lineHeight: 1.3,
});

export function blockSx(tone: ScheduleBlockTone, opts: { selected: boolean; movable: boolean }): SxProps<Theme> {
  return (theme: Theme): CSSObject => ({
    ...blockToneStyles(theme, tone),
    position: 'relative',
    display: 'block',
    width: '100%',
    minWidth: 0,
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
    '&:focus-visible': { outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 1) },
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
    background: breakHatch(theme, rem(theme, M.breakStripe), rem(theme, M.breakStripe * 2)),
    opacity: 0.7,
    pointerEvents: 'none',
  });
}

/** The name and its adornment: one line while both fit, the adornment under the name when not. */
export const nameLineSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 0.75,
  rowGap: 0.25,
  minWidth: 0,
  '& > :first-of-type': { minWidth: 0 },
  '& > [data-sg-adornment]': { flexShrink: 0, display: 'inline-flex' },
};

/** The host's chips under the meta: ONE line; a chip that does not fit shrinks and cuts its label. */
export const chipsSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'nowrap',
  gap: 0.75,
  mt: 0.5,
  minWidth: 0,
  overflow: 'hidden',
  '& > *': { minWidth: 0, flexShrink: 1, maxWidth: '100%' },
};

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
      borderRadius: rem(theme, 2),
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
