import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import type { BadgePalette, BadgeSizeStyles } from './Badge.styles';

const BADGE_VARIANTS: Record<
  string,
  (theme: Theme, colorPalette: BadgePalette, sizeStyles: BadgeSizeStyles) => CSSObject
> = {
  default: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        color:
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }),
  dot: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        width: sizeStyles.dotSize,
        height: sizeStyles.dotSize,
        minWidth: sizeStyles.dotSize,
        borderRadius: '50%',
        padding: 0 }),
  count: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        color:
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: '50%' }),
  gradient: (theme, colorPalette, sizeStyles) => ({
        background: `linear-gradient(135deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`,
        color: '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }),
  glass: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, 0.1),
        backdropFilter: 'blur(10px) saturate(200%)',
        WebkitBackdropFilter: 'blur(10px) saturate(200%)',
        border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
        boxShadow: `inset 0 1px 1px ${alpha(theme.palette.common.white, 0.1)}` }),
  outline: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: 'transparent',
        border: `2px solid ${colorPalette.main}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }),
  secondary: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, 0.15),
        color: colorPalette.main,
        border: `1px solid ${alpha(colorPalette.main, 0.3)}`,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }),
  destructive: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.error.main,
        color: theme.palette.error.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
        fontWeight: 700 }),
  success: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.success.main,
        color: theme.palette.success.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }),
  warning: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2 }) };

export const badgeVariantStyles = (
  theme: Theme,
  colorPalette: BadgePalette,
  sizeStyles: BadgeSizeStyles,
  customVariant?: string,
): CSSObject =>
  customVariant ? (BADGE_VARIANTS[customVariant]?.(theme, colorPalette, sizeStyles) ?? {}) : {};

