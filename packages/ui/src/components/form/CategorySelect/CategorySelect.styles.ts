import { alpha, type CSSObject, type Theme } from '@mui/material/styles/index.js';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadiusPx } from '../../../tokens/field-radius';
import { fieldHeight } from '../../../tokens/field-height';
import { absoluteInk, uiInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

/**
 * The prototype's METRICS, verbatim, in the design's px.
 *
 * Every number here is lifted from the approved design and is intentionally
 * not derived from `theme.spacing`: the design is specified on a half-pixel
 * type scale (13.5px rows, 1.5px checkbox borders) that an 8px spacing grid
 * cannot express without rounding the look away. Each is drawn through
 * `rem()` (the theme's type scale) where it is read, so it follows a density
 * mode exactly — `sheetBreakpoint` excepted, which is a media-query width.
 *
 * The trigger's CORNER and HEIGHT are the other exception: it is a field, so it
 * takes the theme's field radius and field height (`tokens/field-radius`,
 * `tokens/field-height`) and lines up with the inputs and filter pills beside it.
 *
 * COLOURS are the deliberate exception — they come from the theme, because a
 * tenant can white-label the palette (a hard-coded indigo would survive the
 * rebrand and the rest of the screen would not) and because the library ships a
 * dark mode. On the default light indigo theme the tokens below resolve to the
 * prototype's own values.
 */
export const METRICS = {
  panelWidthPx: 340,
  panelRadiusPx: 14,
  listMaxHeightPx: 290,
  sheetListMaxHeightPx: 340,
  rowHeightPx: 36,
  sheetRowHeightPx: 42,
  rowRadiusPx: 8,
  boxSizePx: 18,
  chevronButtonPx: 22,
  /** Extra left padding per level of nesting. */
  rowIndentStepPx: 14,
  footerButtonPx: 32,
  sheetFooterButtonPx: 38,
  /** Below this width the panel becomes a bottom sheet. */
  sheetBreakpoint: 480,
} as const;

/** Accent family, derived so a white-labelled palette carries through. */
const accent = (theme: Theme) => ({
  main: theme.palette.primary.main,
  ink: theme.palette.primary.dark,
  soft: alpha(theme.palette.primary.main, 0.08),
  edge: alpha(theme.palette.primary.main, 0.28),
  ring: alpha(theme.palette.primary.main, 0.15),
});

/** The closed control. `selected` swaps it to the accent-tinted "has filter" skin. */
export const triggerSx = (theme: Theme, selected: boolean, open: boolean): CSSObject => {
  const brand = accent(theme);
  return {
    display: 'flex',
    alignItems: 'center',
    gap: rem(theme, 8),
    height: fieldHeight(theme),
    padding: rems(theme, 0, 10, 0, 12),
    borderRadius: fieldRadiusPx(theme),
    border: `1px solid ${open || selected ? brand.edge : fieldEdge(theme)}`,
    background: selected ? brand.soft : theme.palette.background.paper,
    color: selected ? brand.ink : theme.palette.text.primary,
    font: 'inherit',
    fontSize: rem(theme, 13),
    cursor: 'pointer',
    maxWidth: '100%',
    transition: 'border-color .12s, box-shadow .12s',
    boxShadow: open ? `0 0 0 ${rem(theme, 3)} ${brand.ring}` : 'none',
    '&:hover': { borderColor: open || selected ? brand.edge : theme.palette.text.disabled },
    '&:focus-visible': {
      outline: 'none',
      borderColor: brand.main,
      boxShadow: `0 0 0 ${rem(theme, 3)} ${alpha(brand.main, 0.18)}`,
    },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  };
};

/** The count pill inside the trigger. */
export const triggerCountSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: rem(theme, 11),
  lineHeight: 1,
  background: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  borderRadius: rem(theme, 999),
  padding: rems(theme, 3, 6),
  minWidth: rem(theme, 18),
  textAlign: 'center',
});

/** The trigger's inline clear (×) and the chevron. */
export const triggerClearSx = (theme: Theme): CSSObject => ({
  width: rem(theme, 20),
  height: rem(theme, 20),
  flex: '0 0 auto',
  border: 0,
  background: 'transparent',
  borderRadius: rem(theme, 5),
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.6,
  padding: 0,
  '&:hover': { background: alpha(absoluteInk(theme).black, 0.08), opacity: 1 },
});

export const triggerChevronSx = (theme: Theme, open: boolean): CSSObject => ({
  width: rem(theme, 14),
  height: rem(theme, 14),
  flex: '0 0 auto',
  opacity: 0.55,
  transition: 'transform .15s',
  transform: open ? 'rotate(180deg)' : 'none',
});

/** The floating panel. */
export const panelSx = (theme: Theme): CSSObject => ({
  width: rem(theme, METRICS.panelWidthPx),
  maxWidth: '100%',
  background: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: rem(theme, METRICS.panelRadiusPx),
  boxShadow: `${rems(theme, 0, 1, 2)} ${alpha(uiInk(theme).panelShadowInk, 0.05)}, ${rems(theme, 0, 18, 40, -12)} ${alpha(uiInk(theme).panelShadowInk, 0.28)}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

/** Bottom-sheet skin, applied under {@link METRICS.sheetBreakpoint}. */
export const sheetSx = (theme: Theme): CSSObject => ({
  width: '100%',
  maxWidth: 'none',
  borderRadius: rems(theme, 18, 18, 0, 0),
  borderBottom: 0,
  position: 'relative',
  paddingTop: rem(theme, 4),
  '&::before': {
    content: '""',
    position: 'absolute',
    top: rem(theme, 7),
    left: '50%',
    transform: 'translateX(-50%)',
    width: rem(theme, 36),
    height: rem(theme, 4),
    borderRadius: rem(theme, 2),
    background: theme.palette.divider,
  },
});

export const panelHeadSx = (theme: Theme, sheet: boolean): CSSObject => ({
  padding: sheet ? rems(theme, 18, 10, 8) : rems(theme, 10, 10, 8),
  borderBottom: `1px solid ${theme.palette.divider}`,
});

export const pinnedSx = (theme: Theme): CSSObject => ({
  padding: rems(theme, 9, 10),
  borderBottom: `1px solid ${theme.palette.divider}`,
  background: alpha(theme.palette.primary.main, 0.03),
});

export const pinnedLabelSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: rem(theme, 10),
  lineHeight: 1,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.palette.text.secondary,
  marginBottom: rem(theme, 7),
});

export const chipWrapSx = (theme: Theme): CSSObject => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: rem(theme, 5),
  maxHeight: rem(theme, 74),
  overflow: 'auto',
});

/** A selected-category chip, in the pinned tray and the applied bar alike. */
export const chipSx = (theme: Theme): CSSObject => {
  const brand = accent(theme);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: rem(theme, 5),
    fontSize: rem(theme, 12),
    background: brand.soft,
    color: brand.ink,
    border: `1px solid ${brand.edge}`,
    borderRadius: rem(theme, 7),
    padding: rems(theme, 3, 4, 3, 8),
    '& button': {
      border: 0,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      padding: 0,
      width: rem(theme, 16),
      height: rem(theme, 16),
      borderRadius: rem(theme, 4),
      display: 'grid',
      placeItems: 'center',
      opacity: 0.65,
      fontSize: rem(theme, 13),
      lineHeight: 1,
      '&:hover': { background: alpha(theme.palette.primary.main, 0.16), opacity: 1 },
    },
  };
};

export const listSx = (theme: Theme, sheet: boolean): CSSObject => ({
  overflow: 'auto',
  maxHeight: rem(theme, sheet ? METRICS.sheetListMaxHeightPx : METRICS.listMaxHeightPx),
  padding: rems(theme, 6, 6, 8),
  scrollPadding: rems(theme, 8, 0),
  overscrollBehavior: 'contain',
});

/** A row. `active` is the KEYBOARD cursor — deliberately distinct from hover. */
export const rowSx = (theme: Theme, active: boolean, sheet: boolean): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: rem(theme, 8),
  padding: rems(theme, 0, 8),
  height: rem(theme, sheet ? METRICS.sheetRowHeightPx : METRICS.rowHeightPx),
  borderRadius: rem(theme, METRICS.rowRadiusPx),
  cursor: 'pointer',
  userSelect: 'none',
  position: 'relative',
  width: '100%',
  border: 0,
  textAlign: 'left',
  font: 'inherit',
  background: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
  boxShadow: active ? `inset 0 0 0 ${rem(theme, 1)} ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
  '&:hover': {
    background: active
      ? alpha(theme.palette.primary.main, 0.08)
      : theme.palette.action.hover,
  },
  '&:focus-visible': { outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 1) },
});

/**
 * How far a row sits in from the panel edge, by depth.
 *
 * One step per level, on top of {@link rowSx}'s own 8px gutter — depth 0 keeps
 * that gutter, and every level below it adds `METRICS.rowIndentStepPx`. Read
 * through the type scale like the rest of this file: the step is the design's
 * own 14px, not a spacing multiple that would round it.
 */
export const rowIndent = (theme: Theme, depth: number): CSSObject =>
  depth === 0 ? {} : { paddingLeft: rem(theme, depth * METRICS.rowIndentStepPx) };

export const rowNameSx = (theme: Theme, isCategory: boolean): CSSObject => ({
  flex: 1,
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: rem(theme, 13.5),
  fontWeight: isCategory ? 600 : 450,
  color: isCategory ? theme.palette.text.primary : theme.palette.text.secondary,
});

export const rowMetaSx = (theme: Theme, selected: boolean): CSSObject => ({
  font: `500 ${rem(theme, 11)}/1 ui-monospace, SFMono-Regular, Menlo, monospace`,
  color: selected ? theme.palette.primary.main : theme.palette.text.secondary,
  fontWeight: selected ? 600 : 500,
  flex: '0 0 auto',
});

/** The query hit inside a row label. */
export const markSx = (theme: Theme): CSSObject => ({
  background: uiInk(theme).highlightMark,
  color: 'inherit',
  borderRadius: rem(theme, 2),
  padding: rems(theme, 0, 1),
});

export const chevronButtonSx = (theme: Theme, open: boolean): CSSObject => ({
  width: rem(theme, METRICS.chevronButtonPx),
  height: rem(theme, METRICS.chevronButtonPx),
  flex: '0 0 auto',
  border: 0,
  background: 'transparent',
  borderRadius: rem(theme, 6),
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  color: theme.palette.text.secondary,
  padding: 0,
  '&:hover': { background: theme.palette.action.hover, color: theme.palette.text.primary },
  '& svg': { width: rem(theme, 12), height: rem(theme, 12), transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' },
});

/** The tri-state checkbox: unchecked, checked, or the partial bar. */
export const checkboxSx = (theme: Theme, state: 'off' | 'partial' | 'on'): CSSObject => ({
  width: rem(theme, METRICS.boxSizePx),
  height: rem(theme, METRICS.boxSizePx),
  flex: '0 0 auto',
  border: `${rem(theme, 1.5)} solid ${state === 'off' ? theme.palette.divider : theme.palette.primary.main}`,
  borderRadius: rem(theme, 5),
  background: state === 'off' ? theme.palette.background.paper : theme.palette.primary.main,
  display: 'grid',
  placeItems: 'center',
  transition: 'background .1s, border-color .1s',
  '& svg': { width: rem(theme, 12), height: rem(theme, 12), color: theme.palette.primary.contrastText },
});

/** The partial bar drawn inside a half-selected checkbox. */
export const checkboxBarSx = (theme: Theme): CSSObject => ({
  width: rem(theme, 9),
  height: rem(theme, 2),
  background: theme.palette.primary.contrastText,
  borderRadius: rem(theme, 1),
});

export const radioSx = (theme: Theme, on: boolean): CSSObject => ({
  width: rem(theme, METRICS.boxSizePx),
  height: rem(theme, METRICS.boxSizePx),
  flex: '0 0 auto',
  borderRadius: '50%',
  background: theme.palette.background.paper,
  border: on
    ? `${rem(theme, 5.5)} solid ${theme.palette.primary.main}`
    : `${rem(theme, 1.5)} solid ${theme.palette.divider}`,
  boxSizing: 'border-box',
});

export const sectionHeadSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: rem(theme, 10),
  lineHeight: 1,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.palette.text.secondary,
  padding: rems(theme, 9, 8, 6),
});

export const footerSx = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: rem(theme, 8),
  padding: rems(theme, 9, 10),
  borderTop: `1px solid ${theme.palette.divider}`,
  background: theme.palette.action.hover,
});

export const emptySx = (theme: Theme): CSSObject => ({
  padding: rems(theme, 26, 18),
  textAlign: 'center',
  color: theme.palette.text.secondary,
  '& strong': {
    display: 'block',
    color: theme.palette.text.primary,
    fontSize: rem(theme, 13.5),
    marginBottom: rem(theme, 4),
  },
  '& p': { margin: rems(theme, 0, 0, 12), fontSize: rem(theme, 12.5), lineHeight: 1.5 },
});

/** Skeleton row used while the catalogue loads. */
export const skeletonSx = (theme: Theme): CSSObject => ({
  height: rem(theme, METRICS.rowHeightPx),
  margin: rems(theme, 4, 6),
  borderRadius: rem(theme, METRICS.rowRadiusPx),
});
