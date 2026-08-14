import { alpha, type CSSObject, type Theme } from '@mui/material';

/**
 * The prototype's METRICS, verbatim.
 *
 * Every number here is lifted from the approved design and is intentionally
 * absolute rather than derived from `theme.spacing`: the design is specified on
 * a half-pixel type scale (13.5px rows, 1.5px checkbox borders) that an 8px
 * spacing grid cannot express without rounding the look away.
 *
 * COLOURS are the deliberate exception — they come from the theme, because a
 * tenant can white-label the palette (a hard-coded indigo would survive the
 * rebrand and the rest of the screen would not) and because the library ships a
 * dark mode. On the default light indigo theme the tokens below resolve to the
 * prototype's own values.
 */
export const METRICS = {
  triggerHeight: 38,
  triggerRadius: 10,
  panelWidth: 340,
  panelRadius: 14,
  listMaxHeight: 290,
  sheetListMaxHeight: 340,
  rowHeight: 36,
  sheetRowHeight: 42,
  rowRadius: 8,
  boxSize: 18,
  chevronButton: 22,
  footerButton: 32,
  sheetFooterButton: 38,
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
    gap: '8px',
    height: METRICS.triggerHeight,
    padding: '0 10px 0 12px',
    borderRadius: `${METRICS.triggerRadius}px`,
    border: `1px solid ${open || selected ? brand.edge : theme.palette.divider}`,
    background: selected ? brand.soft : theme.palette.background.paper,
    color: selected ? brand.ink : theme.palette.text.primary,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
    maxWidth: '100%',
    transition: 'border-color .12s, box-shadow .12s',
    boxShadow: open ? `0 0 0 3px ${brand.ring}` : 'none',
    '&:hover': { borderColor: open || selected ? brand.edge : theme.palette.text.disabled },
    '&:focus-visible': {
      outline: 'none',
      borderColor: brand.main,
      boxShadow: `0 0 0 3px ${alpha(brand.main, 0.18)}`,
    },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  };
};

/** The count pill inside the trigger. */
export const triggerCountSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: 11,
  lineHeight: 1,
  background: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  borderRadius: '999px',
  padding: '3px 6px',
  minWidth: 18,
  textAlign: 'center',
});

/** The trigger's inline clear (×) and the chevron. */
export const triggerClearSx: CSSObject = {
  width: 20,
  height: 20,
  flex: '0 0 auto',
  border: 0,
  background: 'transparent',
  borderRadius: '5px',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.6,
  padding: 0,
  '&:hover': { background: alpha('#000', 0.08), opacity: 1 },
};

export const triggerChevronSx = (open: boolean): CSSObject => ({
  width: 14,
  height: 14,
  flex: '0 0 auto',
  opacity: 0.55,
  transition: 'transform .15s',
  transform: open ? 'rotate(180deg)' : 'none',
});

/** The floating panel. */
export const panelSx = (theme: Theme): CSSObject => ({
  width: METRICS.panelWidth,
  maxWidth: '100%',
  background: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: `${METRICS.panelRadius}px`,
  boxShadow: '0 1px 2px rgba(16,20,35,.05), 0 18px 40px -12px rgba(16,20,35,.28)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

/** Bottom-sheet skin, applied under {@link METRICS.sheetBreakpoint}. */
export const sheetSx = (theme: Theme): CSSObject => ({
  width: '100%',
  maxWidth: 'none',
  borderRadius: '18px 18px 0 0',
  borderBottom: 0,
  position: 'relative',
  paddingTop: '4px',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 7,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 36,
    height: 4,
    borderRadius: '2px',
    background: theme.palette.divider,
  },
});

export const panelHeadSx = (theme: Theme, sheet: boolean): CSSObject => ({
  padding: sheet ? '18px 10px 8px' : '10px 10px 8px',
  borderBottom: `1px solid ${theme.palette.divider}`,
});

export const pinnedSx = (theme: Theme): CSSObject => ({
  padding: '9px 10px',
  borderBottom: `1px solid ${theme.palette.divider}`,
  background: alpha(theme.palette.primary.main, 0.03),
});

export const pinnedLabelSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: 10,
  lineHeight: 1,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.palette.text.secondary,
  marginBottom: '7px',
});

export const chipWrapSx: CSSObject = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '5px',
  maxHeight: 74,
  overflow: 'auto',
};

/** A selected-category chip, in the pinned tray and the applied bar alike. */
export const chipSx = (theme: Theme): CSSObject => {
  const brand = accent(theme);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: 12,
    background: brand.soft,
    color: brand.ink,
    border: `1px solid ${brand.edge}`,
    borderRadius: '7px',
    padding: '3px 4px 3px 8px',
    '& button': {
      border: 0,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      padding: 0,
      width: 16,
      height: 16,
      borderRadius: '4px',
      display: 'grid',
      placeItems: 'center',
      opacity: 0.65,
      fontSize: 13,
      lineHeight: 1,
      '&:hover': { background: alpha(theme.palette.primary.main, 0.16), opacity: 1 },
    },
  };
};

export const listSx = (sheet: boolean): CSSObject => ({
  overflow: 'auto',
  maxHeight: sheet ? METRICS.sheetListMaxHeight : METRICS.listMaxHeight,
  padding: '6px 6px 8px',
  scrollPadding: '8px 0',
  overscrollBehavior: 'contain',
});

/** A row. `active` is the KEYBOARD cursor — deliberately distinct from hover. */
export const rowSx = (theme: Theme, active: boolean, sheet: boolean): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 8px',
  height: sheet ? METRICS.sheetRowHeight : METRICS.rowHeight,
  borderRadius: `${METRICS.rowRadius}px`,
  cursor: 'pointer',
  userSelect: 'none',
  position: 'relative',
  width: '100%',
  border: 0,
  textAlign: 'left',
  font: 'inherit',
  background: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
  boxShadow: active ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
  '&:hover': {
    background: active
      ? alpha(theme.palette.primary.main, 0.08)
      : theme.palette.action.hover,
  },
  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
});

export const rowNameSx = (theme: Theme, isCategory: boolean): CSSObject => ({
  flex: 1,
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 13.5,
  fontWeight: isCategory ? 600 : 450,
  color: isCategory ? theme.palette.text.primary : theme.palette.text.secondary,
});

export const rowMetaSx = (theme: Theme, selected: boolean): CSSObject => ({
  font: '500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: selected ? theme.palette.primary.main : theme.palette.text.secondary,
  fontWeight: selected ? 600 : 500,
  flex: '0 0 auto',
});

/** The query hit inside a row label. */
export const markSx: CSSObject = {
  background: '#fff2a8',
  color: 'inherit',
  borderRadius: '2px',
  padding: '0 1px',
};

export const chevronButtonSx = (theme: Theme, open: boolean): CSSObject => ({
  width: METRICS.chevronButton,
  height: METRICS.chevronButton,
  flex: '0 0 auto',
  border: 0,
  background: 'transparent',
  borderRadius: '6px',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  color: theme.palette.text.secondary,
  padding: 0,
  '&:hover': { background: theme.palette.action.hover, color: theme.palette.text.primary },
  '& svg': { width: 12, height: 12, transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' },
});

/** The tri-state checkbox: unchecked, checked, or the partial bar. */
export const checkboxSx = (theme: Theme, state: 'off' | 'partial' | 'on'): CSSObject => ({
  width: METRICS.boxSize,
  height: METRICS.boxSize,
  flex: '0 0 auto',
  border: `1.5px solid ${state === 'off' ? theme.palette.divider : theme.palette.primary.main}`,
  borderRadius: '5px',
  background: state === 'off' ? theme.palette.background.paper : theme.palette.primary.main,
  display: 'grid',
  placeItems: 'center',
  transition: 'background .1s, border-color .1s',
  '& svg': { width: 12, height: 12, color: theme.palette.primary.contrastText },
});

/** The partial bar drawn inside a half-selected checkbox. */
export const checkboxBarSx = (theme: Theme): CSSObject => ({
  width: 9,
  height: 2,
  background: theme.palette.primary.contrastText,
  borderRadius: '1px',
});

export const radioSx = (theme: Theme, on: boolean): CSSObject => ({
  width: METRICS.boxSize,
  height: METRICS.boxSize,
  flex: '0 0 auto',
  borderRadius: '50%',
  background: theme.palette.background.paper,
  border: on
    ? `5.5px solid ${theme.palette.primary.main}`
    : `1.5px solid ${theme.palette.divider}`,
  boxSizing: 'border-box',
});

export const sectionHeadSx = (theme: Theme): CSSObject => ({
  fontWeight: 600,
  fontSize: 10,
  lineHeight: 1,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.palette.text.secondary,
  padding: '9px 8px 6px',
});

export const footerSx = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '9px 10px',
  borderTop: `1px solid ${theme.palette.divider}`,
  background: theme.palette.action.hover,
});

export const emptySx = (theme: Theme): CSSObject => ({
  padding: '26px 18px',
  textAlign: 'center',
  color: theme.palette.text.secondary,
  '& strong': {
    display: 'block',
    color: theme.palette.text.primary,
    fontSize: 13.5,
    marginBottom: '4px',
  },
  '& p': { margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.5 },
});

/** Skeleton row used while the catalogue loads. */
export const skeletonSx: CSSObject = {
  height: METRICS.rowHeight,
  margin: '4px 6px',
  borderRadius: `${METRICS.rowRadius}px`,
};
