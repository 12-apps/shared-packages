import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { modeInk, shadowInk, sheen, uiInk } from '../../../tokens/ink';
import { EFFECT_GLOW } from '../../../tokens/ink.core';
import { rem } from '../../../tokens/relative';

export const slideIn = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateX(${rem(theme, -10)});
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const pulse = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 ${alpha(EFFECT_GLOW.brandIndigo, 0.4)};
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 10)} ${alpha(EFFECT_GLOW.brandIndigo, 0)};
  }
  100% {
    box-shadow: 0 0 0 0 ${alpha(EFFECT_GLOW.brandIndigo, 0)};
  }
`;

const BAR_VARIANTS: Record<string, (theme: Theme, elevation: number) => CSSObject> = {
  glass: (theme, elevation) => ({
      background:
        theme.palette.mode === 'dark' ? alpha(uiInk(theme).glassSlate, 0.7) : sheen(theme, 0.7),
      backdropFilter: `blur(${rem(theme, 10)})`,
      WebkitBackdropFilter: `blur(${rem(theme, 10)})`,
      border: `1px solid ${alpha(modeInk(theme), 0.1)}`,
      boxShadow:
        theme.palette.mode === 'dark'
          ? `0 ${rem(theme, elevation * 4)} ${rem(theme, elevation * 8)} ${shadowInk(theme, 0.3)}, inset 0 ${rem(theme, 1)} 0 ${sheen(theme, 0.1)}`
          : `0 ${rem(theme, elevation * 4)} ${rem(theme, elevation * 8)} ${shadowInk(theme, 0.08)}, inset 0 ${rem(theme, 1)} 0 ${sheen(theme, 0.8)}` }),
  elevated: (theme, elevation) => ({
      background: theme.palette.background.paper,
      boxShadow: theme.shadows[elevation] || theme.shadows[1],
      borderRadius: theme.spacing(1.5) }),
  outlined: (theme, _elevation) => ({
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.spacing(1) }) };

// Spacing and colour for the separator glyphs between crumbs.
const separatorStyles = (
  theme: Theme,
  size: string | undefined,
  color: string | undefined,
  _visualStyle: string | undefined,
): CSSObject => ({
  '& .MuiBreadcrumbs-separator': {
      marginLeft: theme.spacing(size === 'sm' ? 0.5 : size === 'lg' ? 1.5 : 1),
      marginRight: theme.spacing(size === 'sm' ? 0.5 : size === 'lg' ? 1.5 : 1),
      opacity: 0.6,
      transition: 'all 0.2s ease',
      ...(color === 'primary' && {
        color: theme.palette.primary.main }),
      ...(color === 'secondary' && {
        color: theme.palette.secondary.main }) } });

// Only one visual style applies at a time, so a lookup replaces three mutually
// exclusive spreads.
const barVariantStyles = (theme: Theme, visualStyle: string | undefined, elevation: number): CSSObject =>
  visualStyle ? (BAR_VARIANTS[visualStyle]?.(theme, elevation) ?? {}) : {};

// The bar's own styling, lifted out so the styled() callback is a single spread
// rather than seventy lines of conditionals.
export const breadcrumbsBarStyles = ({
  theme,
  size,
  color,
  visualStyle,
  elevation = 0 }: {
  theme: Theme;
  size?: string;
  color?: string;
  visualStyle?: string;
  elevation?: number;
}): CSSObject => ({
    padding: theme.spacing(size === 'sm' ? 0.75 : size === 'lg' ? 1.5 : 1, 2),
    borderRadius: theme.spacing(visualStyle === 'glass' ? 2 : 1),
  ...barVariantStyles(theme, visualStyle, elevation),
    animation: `${slideIn(theme)} 0.3s ease-out`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',

    // Glass morphism effect


    // Elevated variant


    // Outlined variant


    '& .MuiBreadcrumbs-ol': {
      alignItems: 'center',
      flexWrap: 'nowrap',
      [theme.breakpoints.down('sm')]: {
        flexWrap: 'wrap',
        gap: theme.spacing(0.5) } },

    ...separatorStyles(theme, size, color, visualStyle),


    '&:hover': {
      ...(visualStyle === 'glass' && {
        background:
          theme.palette.mode === 'dark' ? alpha(uiInk(theme).glassSlate, 0.85) : sheen(theme, 0.85),
        boxShadow:
          theme.palette.mode === 'dark'
            ? `0 ${rem(theme, elevation * 6)} ${rem(theme, elevation * 12)} ${shadowInk(theme, 0.4)}`
            : `0 ${rem(theme, elevation * 6)} ${rem(theme, elevation * 12)} ${shadowInk(theme, 0.12)}` }) } });

// The idle glass treatment and the active-crumb treatment are mutually
// exclusive; keeping them as named pieces takes both branches out of the main
// style function.
const linkGlassIdleStyles = (theme: Theme): CSSObject => ({
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
          opacity: 0,
          transition: 'opacity 0.3s ease',
          borderRadius: 'inherit' } });

const linkActiveStyles = (theme: Theme, visualStyle?: string): CSSObject => ({
      pointerEvents: 'none',
      cursor: 'default',
      color: theme.palette.primary.main,
      fontWeight: 600,

      ...(visualStyle === 'glass' && {
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
        animation: `${pulse(theme)} 2s infinite` }) });

// Hover treatment. The tint is a touch stronger on the glass variant so it still
// reads against the translucent bar.
const linkHoverStyles = (theme: Theme, visualStyle?: string): CSSObject => ({
  '&:hover, &[data-hover="true"]': {
      color: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, visualStyle === 'glass' ? 0.1 : 0.08),
      transform: `translateY(${rem(theme, -1)})`,

      '&::before': {
        opacity: 1 },

      '& .breadcrumb-icon': {
        transform: 'scale(1.1)' } } });

export const breadcrumbLinkStyles = ({
  theme,
  size,
  active,
  visualStyle }: {
  theme: Theme;
  size?: string;
  active?: boolean;
  visualStyle?: string;
}): CSSObject => ({
  ...(visualStyle === 'glass' && !active ? linkGlassIdleStyles(theme) : {}),
  ...(active ? linkActiveStyles(theme, visualStyle) : {}),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    textDecoration: 'none',
    fontSize: rem(theme, size === 'sm' ? 14 : size === 'lg' ? 18 : 16),
    fontWeight: active ? 600 : 400,
    color: active ? theme.palette.text.primary : theme.palette.text.secondary,
    padding: theme.spacing(0.5, 0.75),
    borderRadius: theme.spacing(0.75),
    position: 'relative',
    overflow: 'hidden',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

    // Add subtle background for glass variant


  ...linkHoverStyles(theme, visualStyle),


    '&:active': {
      transform: 'translateY(0)',
      backgroundColor: alpha(theme.palette.primary.main, 0.12) },

    '&:focus-visible': {
      outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`,
      outlineOffset: rem(theme, 2),
      backgroundColor: alpha(theme.palette.primary.main, 0.04) },



    '& .breadcrumb-icon': {
      transition: 'transform 0.2s ease' },

    // Mobile responsiveness
    [theme.breakpoints.down('sm')]: {
      fontSize: rem(theme, size === 'lg' ? 16 : size === 'sm' ? 12 : 14),
      padding: theme.spacing(0.375, 0.5) } });

export const sizeIconMap = {
  xs: 'small',
  sm: 'small',
  md: 'small',
  lg: 'medium',
  xl: 'medium',
} as const;
