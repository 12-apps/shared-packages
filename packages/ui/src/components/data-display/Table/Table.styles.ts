import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { TableDensity, TableStripeColor } from './Table.types';
import { rem, rems } from '../../../tokens/relative';

const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 10)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

// Density configurations. The row height stays design px (`…Px`) and goes
// through `rem` where the cell is drawn.
const getDensityConfig = (theme: Theme, density: TableDensity = 'normal') => {
  const configs = {
    compact: {
      rowHeightPx: 36,
      cellPadding: rems(theme, 6, 12),
      fontSize: rem(theme, 13),
      headerPadding: rems(theme, 8, 12) },
    normal: {
      rowHeightPx: 52,
      cellPadding: rems(theme, 12, 16),
      fontSize: rem(theme, 14),
      headerPadding: rems(theme, 16, 16) },
    comfortable: {
      rowHeightPx: 68,
      cellPadding: rems(theme, 18, 24),
      fontSize: rem(theme, 14),
      headerPadding: rems(theme, 20, 24) } };
  return configs[density];
};

const getStripeColorFromTheme = (theme: { palette: { primary: { main: string }; secondary: { main: string }; info: { main: string }; success: { main: string }; warning: { main: string }; error: { main: string }; action: { hover: string } } }, stripeColor: TableStripeColor = 'neutral') => {
  const colorMap: Record<TableStripeColor, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    info: theme.palette.info.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    danger: theme.palette.error.main,
    neutral: theme.palette.action.hover };
  return colorMap[stripeColor];
};

/**
 * The zebra stripe for one body row.
 *
 * `neutral` — the default — resolves to `palette.action.hover`, which ALREADY
 * carries its subtlety in its own alpha (`rgba(0,0,0,0.04)` in the light
 * theme). MUI's `alpha()` REPLACES that channel rather than multiplying it, so
 * re-alpha-ing it at 0.5 amplified the tint 12.5× into `rgba(0,0,0,0.5)` —
 * solid #808080 on a white card, which reads as a selected or errored row
 * rather than as a stripe (FUT-755). It is used as-is instead.
 *
 * The named colours are opaque `*.main` values with no alpha of their own, so
 * they still need one.
 */
const stripeRowColor = (
  theme: Parameters<typeof getStripeColorFromTheme>[0],
  stripeColor: TableStripeColor = 'neutral',
): string => {
  const color = getStripeColorFromTheme(theme, stripeColor);
  return stripeColor === 'neutral' ? color : alpha(color, 0.15);
};

// One variant applies at a time, so a lookup replaces the mutually exclusive
// spreads.
const TABLE_VARIANTS: Record<string, (args: VariantArgs) => CSSObject> = {
  default: ({ theme }) => ({
      backgroundColor: theme.palette.background.paper,
      '& .MuiTableHead-root': {
        backgroundColor: alpha(theme.palette.primary.main, 0.1) } }),
  striped: ({ theme, stripeColor }) => ({
      backgroundColor: theme.palette.background.paper,
      '& .MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
        backgroundColor: stripeRowColor(theme, stripeColor) } }),
  glass: ({ theme }) => ({
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: `blur(${rem(theme, 20)})`,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}` }),
  minimal: ({ theme }) => ({
      backgroundColor: 'transparent',
      '& .MuiTableCell-root': {
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` } }),
  gradient: ({ theme }) => ({
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.secondary.main, 0.05)})`,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      '& .MuiTableHead-root': {
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.15)})` },
      '& .MuiTableCell-root': {
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` } }) };

type VariantArgs = {
  theme: Theme;
  densityConfig: ReturnType<typeof getDensityConfig>;
  stripeColor?: TableStripeColor;
};

const tableVariantStyles = (args: VariantArgs, customVariant?: string): CSSObject =>
  customVariant ? (TABLE_VARIANTS[customVariant]?.(args) ?? {}) : {};

/**
 * A virtualised table (FUT-2668). Fixed layout takes the column widths from the
 * header — a column's declared `width`, the rest sharing what is left — so they
 * hold still while different rows mount (it ignores a column's `minWidth`). A
 * body cell drops its vertical padding and the density's height: the pitch is
 * `rowHeight`, and the cell's content wrapper is exactly that tall.
 *
 * The checkbox column is MUI's 48 wide, and fixed layout holds it there. The
 * density's side padding would leave its checkbox 16 of that and clip it in the
 * body, so it keeps MUI's own checkbox padding (4 on the left, none on the
 * right), in the header and the body alike. After the sticky header's rule,
 * which it would otherwise lose to.
 */
const virtualisedStyles = (theme: Theme): CSSObject => ({
  tableLayout: 'fixed',
  '& .MuiTableBody-root .MuiTableCell-root': {
    paddingTop: 0,
    paddingBottom: 0,
    height: 'auto' },
  '& .MuiTableHead-root .MuiTableCell-paddingCheckbox, & .MuiTableBody-root .MuiTableCell-paddingCheckbox': {
    paddingLeft: rem(theme, 4),
    paddingRight: 0 } });

// Sticky headers and row hover are independent of the variant.
const stickyHeaderStyles = (
  theme: Theme,
  densityConfig: ReturnType<typeof getDensityConfig>,
): CSSObject => ({
      '& .MuiTableHead-root': {
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: theme.palette.background.paper,
        '& .MuiTableCell-root': {
          borderBottom: `${rem(theme, 2)} solid ${theme.palette.divider}`,
          fontWeight: 600,
          padding: densityConfig.headerPadding } } });

const hoverableRowStyles = (theme: Theme): CSSObject => ({
      '& .MuiTableBody-root .MuiTableRow-root:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        cursor: 'pointer',
        transition: 'background-color 0.15s ease-in-out' } });

// glow and pulse combine into three distinct looks, spelled out rather than
// layered — the glow-only shadow differs from the one used when both are on.
const emphasisStyles = (theme: Theme, glow?: boolean, pulse?: boolean): CSSObject => {
  if (glow && pulse) return ({
      position: 'relative',
      boxShadow: `${rems(theme, 0, 0, 20, 5)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation(theme)} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1 } });
  if (glow) return ({
      boxShadow: `${rems(theme, 0, 0, 20, 5)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)' });
  if (pulse) return ({
      position: 'relative',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation(theme)} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1 } });

  return {};
};

// The table's own styling, lifted out so the styled() callback just forwards
// its props.
export const tableStyles = ({
  theme,
  customVariant,
  glow,
  pulse,
  hoverable,
  density,
  stickyHeader,
  stripeColor = 'neutral',
  virtualised }: {
  theme: Theme;
  customVariant?: string;
  glow?: boolean;
  pulse?: boolean;
  hoverable?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  stripeColor?: TableStripeColor;
  /** The body is a virtual window, drawn at `rowHeight`. */
  virtualised?: boolean;
}): CSSObject => {
  const densityConfig = getDensityConfig(theme, density);
  
  return {
    borderRadius: theme.spacing(1),
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    position: 'relative',

    // Density styles
    '& .MuiTableCell-root': {
      padding: densityConfig.cellPadding,
      fontSize: densityConfig.fontSize,
      height: rem(theme, densityConfig.rowHeightPx) },

    // Sticky header
    ...tableVariantStyles({ theme, densityConfig, stripeColor }, customVariant),
    ...(stickyHeader ? stickyHeaderStyles(theme, densityConfig) : {}),
    ...(hoverable ? hoverableRowStyles(theme) : {}),
    ...emphasisStyles(theme, glow, pulse),
    ...(virtualised ? virtualisedStyles(theme) : {}),


    // Variant styles










    // Hoverable rows


    // Selection styles
    '& .MuiTableRow-root.selected': {
      backgroundColor: alpha(theme.palette.primary.main, 0.12),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.16) } },

    // Glow effect


    // Pulse animation


    // Both glow and pulse

  };
}
