import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { rem, rems } from '../../../tokens/relative';

const ITEM_SIZE_STYLES: Record<string, (theme: Theme) => CSSObject> = {
  sm: (theme) => ({
      fontSize: rem(theme, 14),
      minWidth: rem(theme, 28),
      height: rem(theme, 28),
      padding: theme.spacing(0.25, 0.5) }),
  lg: (theme) => ({
      fontSize: rem(theme, 18),
      minWidth: rem(theme, 44),
      height: rem(theme, 44),
      padding: theme.spacing(1, 1.5) }) };

// One variant applies at a time, so a lookup replaces the mutually exclusive
// spreads.
const ITEM_VARIANTS: Record<string, (theme: Theme, customSize?: string) => CSSObject> = {
  default: (theme, _customSize) => ({
      borderRadius: theme.spacing(1),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        transform: `translateY(${rem(theme, -1)})`,
        boxShadow: `0 ${rems(theme, 2, 8)} ${alpha(theme.palette.primary.main, 0.15)}` },
      '&.Mui-selected': {
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        boxShadow: `0 ${rems(theme, 4, 12)} ${alpha(theme.palette.primary.main, 0.3)}`,
        '&:hover': {
          backgroundColor: theme.palette.primary.dark,
          transform: `translateY(${rem(theme, -2)})` } } }),
  rounded: (theme, customSize) => ({
      borderRadius: '50%',
      minWidth: rem(theme, customSize === 'sm' ? 28 : customSize === 'lg' ? 44 : 36),
      width: rem(theme, customSize === 'sm' ? 28 : customSize === 'lg' ? 44 : 36),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        transform: 'scale(1.1)',
        boxShadow: `0 ${rems(theme, 4, 16)} ${alpha(theme.palette.primary.main, 0.2)}` },
      '&.Mui-selected': {
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        transform: 'scale(1.05)',
        boxShadow: `0 ${rems(theme, 6, 20)} ${alpha(theme.palette.primary.main, 0.3)}`,
        '&:hover': {
          backgroundColor: theme.palette.primary.dark,
          transform: 'scale(1.15)' } } }),
  dots: (theme, customSize) => ({
      borderRadius: '50%',
      minWidth: rem(theme, customSize === 'sm' ? 8 : customSize === 'lg' ? 12 : 10),
      width: rem(theme, customSize === 'sm' ? 8 : customSize === 'lg' ? 12 : 10),
      height: rem(theme, customSize === 'sm' ? 8 : customSize === 'lg' ? 12 : 10),
      fontSize: 0,
      backgroundColor: alpha(theme.palette.text.secondary, 0.3),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.5),
        transform: 'scale(1.3)' },
      '&.Mui-selected': {
        backgroundColor: theme.palette.primary.main,
        transform: 'scale(1.2)',
        '&:hover': {
          backgroundColor: theme.palette.primary.dark,
          transform: 'scale(1.4)' } },
      '&.MuiPaginationItem-previousNext, &.MuiPaginationItem-firstLast': {
        display: 'none' } }),
  minimal: (theme, _customSize) => ({
      borderRadius: theme.spacing(0.5),
      backgroundColor: 'transparent',
      color: theme.palette.text.secondary,
      padding: theme.spacing(0.5, 1),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.04),
        color: theme.palette.primary.main },
      '&.Mui-selected': {
        backgroundColor: 'transparent',
        color: theme.palette.primary.main,
        fontWeight: 600,
        position: 'relative',
        '&::after': {
          content: '""',
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '60%',
          height: rem(theme, 2),
          backgroundColor: theme.palette.primary.main,
          borderRadius: rem(theme, 1) } } }) };

const itemSizeStyles = (theme: Theme, customSize?: string): CSSObject =>
  customSize ? (ITEM_SIZE_STYLES[customSize]?.(theme) ?? {}) : {};

const itemVariantStyles = (theme: Theme, customVariant?: string, customSize?: string): CSSObject =>
  customVariant ? (ITEM_VARIANTS[customVariant]?.(theme, customSize) ?? {}) : {};

// The pagination list's own styling, lifted out so the styled() callback is a
// single spread.
export const paginationStyles = ({
  theme,
  customVariant,
  customSize }: {
  theme: Theme;
  customVariant?: string;
  customSize?: string;
}): CSSObject => ({
  '& .MuiPagination-ul': {
    gap: customVariant === 'minimal' ? theme.spacing(0.5) : theme.spacing(1) },

  '& .MuiPaginationItem-root': {
    ...itemSizeStyles(theme, customSize),
    ...itemVariantStyles(theme, customVariant, customSize),
    transition: 'all 0.2s ease',
    fontWeight: 500,





    // Default variant (flat design)


    // Rounded variant


    // Dots variant (minimal circular dots)


    // Minimal variant (text-only)

  },

  // Hide ellipsis for dots variant
  ...(customVariant === 'dots' && {
    '& .MuiPaginationItem-ellipsis': {
      display: 'none' } }) });
