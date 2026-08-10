import { alpha, keyframes } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

export const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(99, 102, 241, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
  }
`;

const BAR_VARIANTS: Record<string, (theme: Theme, elevation: number) => CSSObject> = {
  glass: (theme, elevation) => ({
      background:
        theme.palette.mode === 'dark' ? 'rgba(17, 24, 39, 0.7)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: `1px solid ${
        theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
      }`,
      boxShadow:
        theme.palette.mode === 'dark'
          ? `0 ${elevation * 4}px ${elevation * 8}px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)`
          : `0 ${elevation * 4}px ${elevation * 8}px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8)` }),
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
    animation: `${slideIn} 0.3s ease-out`,
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
          theme.palette.mode === 'dark' ? 'rgba(17, 24, 39, 0.85)' : 'rgba(255, 255, 255, 0.85)',
        boxShadow:
          theme.palette.mode === 'dark'
            ? `0 ${elevation * 6}px ${elevation * 12}px rgba(0, 0, 0, 0.4)`
            : `0 ${elevation * 6}px ${elevation * 12}px rgba(0, 0, 0, 0.12)` }) } });

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
        animation: `${pulse} 2s infinite` }) });

// Hover treatment. The tint is a touch stronger on the glass variant so it still
// reads against the translucent bar.
const linkHoverStyles = (theme: Theme, visualStyle?: string): CSSObject => ({
  '&:hover, &[data-hover="true"]': {
      color: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, visualStyle === 'glass' ? 0.1 : 0.08),
      transform: 'translateY(-1px)',

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
    fontSize: size === 'sm' ? '0.875rem' : size === 'lg' ? '1.125rem' : '1rem',
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
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
      backgroundColor: alpha(theme.palette.primary.main, 0.04) },



    '& .breadcrumb-icon': {
      transition: 'transform 0.2s ease' },

    // Mobile responsiveness
    [theme.breakpoints.down('sm')]: {
      fontSize: size === 'lg' ? '1rem' : size === 'sm' ? '0.75rem' : '0.875rem',
      padding: theme.spacing(0.375, 0.5) } });

export const sizeIconMap = {
  xs: 'small',
  sm: 'small',
  md: 'small',
  lg: 'medium',
  xl: 'medium',
} as const;
