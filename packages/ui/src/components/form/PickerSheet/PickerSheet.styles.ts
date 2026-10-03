import { alpha, type CSSObject, type Theme } from '@mui/material/styles/index.js';

import { fieldBorder, fieldHeight } from '../../../tokens/field-height';
import { fieldRadiusPx } from '../../../tokens/field-radius';
import { uiInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

/**
 * The prototype's measurements, verbatim, in the design's px.
 *
 * Each is drawn through `rem()` where it is read, so the sheet follows a
 * density mode the way every other surface in the package does. Colours come
 * from the palette (a white-labelled tenant and dark mode carry through).
 */
const METRICS = {
  dialogWidthPx: 520,
  dialogMaxHeightPx: 780,
  dialogRadiusPx: 14,
  /** The gap a centred dialog keeps from the viewport edge. */
  dialogMarginPx: 32,
  sheetRadiusPx: 16,
  headGapPx: 10,
  closeButtonPx: 36,
  controlRadiusPx: 8,
  bodyPaddingPx: 16,
  bodyGapPx: 12,
  listMaxHeightPx: 380,
  listGapPx: 2,
  rowPaddingPx: 10,
  rowMinHeightPx: 44,
  /** Left padding per level of `indent` (`.pitem.ind{padding-left:28px}` at depth 1). */
  rowIndentStepPx: 28,
  checkGlyphPx: 16,
  searchGlyphPx: 15,
} as const;

/** The panel's shadow: `0 16px 48px` of ink at 0.28. */
const panelShadow = (theme: Theme): string =>
  `${rems(theme, 0, 16, 48)} ${alpha(uiInk(theme).panelShadowInk, 0.28)}`;

/** The centred dialog's paper, on a pointer. */
export const dialogPaperSx = (theme: Theme): CSSObject => ({
  width: rem(theme, METRICS.dialogWidthPx),
  maxWidth: `calc(100% - ${rem(theme, METRICS.dialogMarginPx)})`,
  maxHeight: `min(${rem(theme, METRICS.dialogMaxHeightPx)}, calc(100% - ${rem(theme, METRICS.dialogMarginPx * 2)}))`,
  margin: 0,
  borderRadius: rem(theme, METRICS.dialogRadiusPx),
  boxShadow: panelShadow(theme),
  background: theme.palette.background.paper,
  backgroundImage: 'none',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

/** The bottom sheet's paper, on a phone: full width, no grab handle. */
export const sheetPaperSx = (theme: Theme): CSSObject => ({
  width: '100%',
  maxHeight: '88%',
  borderRadius: rems(theme, METRICS.sheetRadiusPx, METRICS.sheetRadiusPx, 0, 0),
  background: theme.palette.background.paper,
  backgroundImage: 'none',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

/** `.sh` — kicker and title on the left, the close button on the right. */
export const headSx = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: rem(theme, METRICS.headGapPx),
  padding: rems(theme, 14, 16),
  borderBottom: `1px solid ${theme.palette.divider}`,
  flex: '0 0 auto',
});

export const kickerSx = (theme: Theme): CSSObject => ({
  fontSize: rem(theme, 11.5),
  color: theme.palette.text.secondary,
  lineHeight: 1.3,
});

export const titleSx = (theme: Theme): CSSObject => ({
  margin: 0,
  fontSize: rem(theme, 16),
  fontWeight: 700,
  lineHeight: 1.3,
  color: theme.palette.text.primary,
});

export const closeButtonSx = (theme: Theme): CSSObject => ({
  flex: '0 0 auto',
  width: rem(theme, METRICS.closeButtonPx),
  height: rem(theme, METRICS.closeButtonPx),
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: rem(theme, METRICS.controlRadiusPx),
  background: 'transparent',
  color: theme.palette.text.primary,
  cursor: 'pointer',
  '& svg': { width: rem(theme, 16), height: rem(theme, 16) },
  '&:hover': { background: theme.palette.action.hover },
  '&:focus-visible': { outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 1) },
});

/** `.sb` — the scrolling body: search, list, foot. */
export const bodySx = (theme: Theme): CSSObject => ({
  display: 'flex',
  flexDirection: 'column',
  gap: rem(theme, METRICS.bodyGapPx),
  padding: rem(theme, METRICS.bodyPaddingPx),
  overflow: 'auto',
  minHeight: 0,
  flex: '1 1 auto',
});

/** The search field: the library's field height, border and corner, with a leading magnifier. */
export const searchFieldSx = (theme: Theme): CSSObject => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flex: '0 0 auto',
  '& > svg': {
    position: 'absolute',
    left: rem(theme, 11),
    width: rem(theme, METRICS.searchGlyphPx),
    height: rem(theme, METRICS.searchGlyphPx),
    opacity: 0.55,
    pointerEvents: 'none',
    zIndex: 1,
  },
  '& input': {
    width: '100%',
    height: fieldHeight(theme),
    boxSizing: 'border-box',
    padding: rems(theme, 0, 12, 0, 34),
    fontSize: rem(theme, 14),
    border: fieldBorder(theme),
    borderRadius: fieldRadiusPx(theme),
    background: theme.palette.background.paper,
    color: theme.palette.text.primary,
    '&:focus': {
      outline: 'none',
      borderColor: theme.palette.primary.main,
      boxShadow: `0 0 0 ${rem(theme, 3)} ${alpha(theme.palette.primary.main, 0.15)}`,
    },
  },
});

/** The list: a column, scrolling on its own past 380px. */
export const listSx = (theme: Theme): CSSObject => ({
  display: 'flex',
  flexDirection: 'column',
  gap: rem(theme, METRICS.listGapPx),
  maxHeight: rem(theme, METRICS.listMaxHeightPx),
  overflow: 'auto',
  overscrollBehavior: 'contain',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  flex: '0 1 auto',
});

/** Left padding for a row at `depth` — the row's own 10px at depth 0, 28px per level below it. */
export const rowPaddingLeft = (theme: Theme, depth: number): string =>
  rem(theme, depth > 0 ? METRICS.rowIndentStepPx * depth : METRICS.rowPaddingPx);

/** Background of a row: selected wins over the keyboard cursor, which wins over rest. */
function rowBackground(theme: Theme, selected: boolean, active: boolean): string {
  if (selected) return alpha(theme.palette.primary.main, 0.1);
  return active ? theme.palette.action.hover : 'transparent';
}

/** `.pitem` — a row. `active` is the keyboard cursor, drawn as a ring so it reads apart from `selected`. */
export const rowSx = (theme: Theme, selected: boolean, active: boolean): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: rem(theme, 10),
  padding: rem(theme, METRICS.rowPaddingPx),
  minHeight: rem(theme, METRICS.rowMinHeightPx),
  boxSizing: 'border-box',
  borderRadius: rem(theme, METRICS.controlRadiusPx),
  textAlign: 'left',
  cursor: 'pointer',
  userSelect: 'none',
  color: theme.palette.text.primary,
  background: rowBackground(theme, selected, active),
  boxShadow: active ? `inset 0 0 0 ${rem(theme, 1)} ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
  '&:hover': { background: selected ? alpha(theme.palette.primary.main, 0.1) : theme.palette.action.hover },
});

export const rowTextSx: CSSObject = { flex: '1 1 auto', minWidth: 0 };

export const rowLabelSx = (theme: Theme): CSSObject => ({
  display: 'block',
  fontSize: rem(theme, 14),
  lineHeight: 1.35,
});

export const rowMetaSx = (theme: Theme): CSSObject => ({
  display: 'block',
  fontSize: rem(theme, 12),
  lineHeight: 1.35,
  color: theme.palette.text.secondary,
});

export const checkSx = (theme: Theme): CSSObject => ({
  flex: '0 0 auto',
  display: 'grid',
  color: theme.palette.primary.main,
  '& svg': { width: rem(theme, METRICS.checkGlyphPx), height: rem(theme, METRICS.checkGlyphPx) },
});

/** The create row's text: the accent, at 600. */
export const createLabelSx = (theme: Theme): CSSObject => ({
  ...rowLabelSx(theme),
  color: theme.palette.primary.main,
  fontWeight: 600,
});

export const emptySx = (theme: Theme): CSSObject => ({
  fontSize: rem(theme, 12),
  color: theme.palette.text.secondary,
  padding: rem(theme, 10),
});

export const footSx = (theme: Theme): CSSObject => ({
  margin: 0,
  fontSize: rem(theme, 12),
  color: theme.palette.text.secondary,
});
