import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import {
  BADGE_DESTRUCTIVE_FONT_WEIGHT,
  GLASS_BACKGROUND_ALPHA,
  GLASS_BLUR_PX,
  GLASS_BORDER_ALPHA,
  GLASS_INSET_HIGHLIGHT_ALPHA,
  GLASS_SATURATE,
  OUTLINE_BORDER_WIDTH,
  SECONDARY_BACKGROUND_ALPHA,
  SECONDARY_BORDER_ALPHA,
} from './Badge.metrics';
import type { BadgePalette, BadgeSizeStyles } from './Badge.styles';
import { absoluteInk, onMedia, sheen } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

const BADGE_VARIANTS: Record<
  string,
  (theme: Theme, colorPalette: BadgePalette, sizeStyles: BadgeSizeStyles) => CSSObject
> = {
  default: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        color:
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || absoluteInk(theme).white,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }),
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
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || absoluteInk(theme).white,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: '50%' }),
  gradient: (theme, colorPalette, sizeStyles) => ({
        background: `linear-gradient(135deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`,
        color: onMedia(theme),
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }),
  glass: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, GLASS_BACKGROUND_ALPHA),
        backdropFilter: `blur(${rem(theme, GLASS_BLUR_PX)}) saturate(${GLASS_SATURATE * 100}%)`,
        WebkitBackdropFilter: `blur(${rem(theme, GLASS_BLUR_PX)}) saturate(${GLASS_SATURATE * 100}%)`,
        border: `1px solid ${alpha(colorPalette.main, GLASS_BORDER_ALPHA)}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius,
        boxShadow: `inset 0 ${rems(theme, 1, 1)} ${sheen(theme, GLASS_INSET_HIGHLIGHT_ALPHA)}` }),
  outline: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: 'transparent',
        border: `${rem(theme, OUTLINE_BORDER_WIDTH)} solid ${colorPalette.main}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }),
  secondary: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, SECONDARY_BACKGROUND_ALPHA),
        color: colorPalette.main,
        border: `1px solid ${alpha(colorPalette.main, SECONDARY_BORDER_ALPHA)}`,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }),
  destructive: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.error.main,
        color: theme.palette.error.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius,
        fontWeight: BADGE_DESTRUCTIVE_FONT_WEIGHT }),
  success: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.success.main,
        color: theme.palette.success.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }),
  warning: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: rem(theme, sizeStyles.step.fontSize),
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.pillRadius }) };

export const badgeVariantStyles = (
  theme: Theme,
  colorPalette: BadgePalette,
  sizeStyles: BadgeSizeStyles,
  customVariant?: string,
): CSSObject =>
  customVariant ? (BADGE_VARIANTS[customVariant]?.(theme, colorPalette, sizeStyles) ?? {}) : {};

