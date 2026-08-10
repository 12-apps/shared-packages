import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import type { LabelProps } from './Label.types';
import { accentFor} from '../../../tokens/scales';

type Size = NonNullable<LabelProps['size']>;
type Variant = NonNullable<LabelProps['variant']>;
type Weight = NonNullable<LabelProps['weight']>;

const SIZES: Record<Size, (theme: Theme) => CSSObject> = {
  xs: (theme) => ({ fontSize: '0.75rem', lineHeight: 1.2, padding: theme.spacing(0.25, 0.5) }),
  sm: (theme) => ({ fontSize: '0.875rem', lineHeight: 1.3, padding: theme.spacing(0.5, 0.75) }),
  md: (theme) => ({ fontSize: '1rem', lineHeight: 1.5, padding: theme.spacing(0.75, 1) }),
  lg: (theme) => ({ fontSize: '1.125rem', lineHeight: 1.6, padding: theme.spacing(1, 1.25) }),
  xl: (theme) => ({ fontSize: '1.25rem', lineHeight: 1.7, padding: theme.spacing(1.25, 1.5) }),
};

export const sizeStyles = (theme: Theme, size: Size): CSSObject => (SIZES[size] ?? SIZES.md)(theme);

const WEIGHTS: Record<Weight, number> = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const fontWeight = (weight: Weight) => WEIGHTS[weight] ?? WEIGHTS.regular;

export interface LabelStyleFlags {
  variant: Variant;
  size: Size;
  color: NonNullable<LabelProps['color']>;
  weight: Weight;
  transform: NonNullable<LabelProps['transform']>;
  align: NonNullable<LabelProps['align']>;
  error: boolean;
  disabled: boolean;
  glow: boolean;
  pulse: boolean;
  ripple: boolean;
  srOnly: boolean;
  nowrap: boolean;
  truncate: boolean;
  clickable: boolean;
}

/**
 * The text colour, which error and disabled override before the palette is
 * consulted at all. Resolved once and threaded through — the variant styles
 * read it up to four times each.
 */
export const textColor = (theme: Theme, flags: LabelStyleFlags): string => {
  if (flags.error) return theme.palette.error.main;
  if (flags.disabled) return theme.palette.text.disabled;
  if (flags.color === 'neutral') return theme.palette.text.primary;
  return accentFor(theme, flags.color).main;
};

/** The ripple that expands from the centre on press, for clickable labels. */
const rippleStyles = (theme: Theme): CSSObject => ({
  overflow: 'hidden',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
    borderRadius: '50%',
    backgroundColor: alpha(theme.palette.primary.main, 0.3),
    transform: 'translate(-50%, -50%)',
    transition: 'width 0.6s, height 0.6s',
  },
  '&:active::after': { width: '300%', height: '300%' },
});

interface SurfaceInput {
  theme: Theme;
  flags: LabelStyleFlags;
  /** The resolved text colour, or the primary accent when it resolves to none. */
  accent: string;
}

/**
 * Each variant's own additions. Every arm previously re-spread the same base,
 * glow, pulse and ripple objects and re-derived the colour for each use; the
 * shared prefix is applied once by `labelStyles`.
 *
 * The hover rules are only attached when the label is clickable, which is what
 * the `onClick ? {…} : {}` in every arm was saying.
 */
const SURFACES: Record<Variant, (input: SurfaceInput) => CSSObject> = {
  filled: ({ theme, flags, accent }) => ({
    backgroundColor: alpha(accent, 0.1),
    borderRadius: theme.spacing(0.5),
    '&:hover': flags.clickable ? { backgroundColor: alpha(accent, 0.15) } : {},
  }),

  outlined: ({ theme, flags, accent }) => ({
    border: `1px solid ${alpha(accent, 0.5)}`,
    borderRadius: theme.spacing(0.5),
    '&:hover': flags.clickable
      ? { borderColor: accent, backgroundColor: alpha(accent, 0.05) }
      : {},
  }),

  glass: ({ theme, flags }) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: 'blur(10px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    borderRadius: theme.spacing(0.5),
    '&:hover': flags.clickable
      ? {
          backgroundColor: alpha(theme.palette.background.paper, 0.15),
          borderColor: alpha(theme.palette.primary.main, 0.3),
        }
      : {},
  }),

  gradient: ({ theme, flags }) => {
    // `neutral` has no accent of its own in the gradient; it borrows primary,
    // which is what this branch already did before the vocabulary was named.
    const accent = accentFor(theme, flags.color === 'neutral' ? 'primary' : flags.color);
    // The gradient paints the glyphs themselves rather than the box behind them.
    const clip = {
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    };

    return {
      background: `linear-gradient(135deg, ${accent.light}, ${accent.main})`,
      ...clip,
      '&:hover': flags.clickable
        ? {
            background: `linear-gradient(135deg, ${accent.main}, ${accent.dark})`,
            ...clip,
          }
        : {},
    };
  },

  minimal: ({ theme, flags }) => ({
    padding: 0,
    '&:hover': flags.clickable ? { color: theme.palette.primary.main } : {},
  }),

  default: () => ({}),
};

/** How the text sits: its alignment, weight, casing and overflow behaviour. */
const textLayout = (theme: Theme, flags: LabelStyleFlags): CSSObject => {
  const { srOnly, clickable, align, weight, transform, nowrap, truncate } = flags;

  return {
    display: srOnly ? 'none' : 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.standard,
    }),
    cursor: clickable ? 'pointer' : 'default',
    textAlign: align,
    fontWeight: fontWeight(weight),
    textTransform: transform,
    whiteSpace: nowrap ? 'nowrap' : 'normal',
    overflow: truncate ? 'hidden' : 'visible',
    textOverflow: truncate ? 'ellipsis' : 'clip',
    position: 'relative' as const,
  };
};

export const labelStyles = (theme: Theme, flags: LabelStyleFlags): CSSObject => {
  const { variant, size, clickable } = flags;
  const color = textColor(theme, flags);
  const accent = color || theme.palette.primary.main;

  return {
    ...textLayout(theme, flags),
    ...sizeStyles(theme, size),
    color,
    ...(flags.glow && { textShadow: `0 0 10px ${alpha(accent, 0.5)}` }),
    ...(flags.pulse && {
      animation: 'pulse 2s infinite',
      '@keyframes pulse': {
        '0%': { opacity: 1 },
        '50%': { opacity: 0.6 },
        '100%': { opacity: 1 },
      },
    }),
    ...(flags.ripple && clickable && rippleStyles(theme)),
    ...(SURFACES[variant] ?? SURFACES.default)({ theme, flags, accent }),
  };
};

/** Visually hidden but still read aloud, for the `srOnly` label. */
export const SR_ONLY_SX: CSSObject = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
