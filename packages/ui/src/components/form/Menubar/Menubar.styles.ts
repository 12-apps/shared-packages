import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { MenubarProps } from './Menubar.types';
import { accentFor} from '../../../tokens/scales';

type Size = NonNullable<MenubarProps['size']>;
type Variant = NonNullable<MenubarProps['variant']>;
type Color = NonNullable<MenubarProps['color']>;

const SIZES: Record<Size, (theme: Theme) => CSSObject> = {
  xs: (theme) => ({ minHeight: 40, fontSize: '0.75rem', padding: theme.spacing(0.5, 1) }),
  sm: (theme) => ({ minHeight: 48, fontSize: '0.875rem', padding: theme.spacing(0.75, 1.5) }),
  md: (theme) => ({ minHeight: 56, fontSize: '1rem', padding: theme.spacing(1, 2) }),
  lg: (theme) => ({ minHeight: 64, fontSize: '1.125rem', padding: theme.spacing(1.25, 2.5) }),
  xl: (theme) => ({ minHeight: 72, fontSize: '1.25rem', padding: theme.spacing(1.5, 3) }),
};

export const sizeStyles = (theme: Theme, size: Size): CSSObject =>
  (SIZES[size] ?? SIZES.md)(theme);

/** `default` is not a palette entry — it means the paper surface and its text. */
const accentOf = (theme: Theme, color: Color) =>
  color === 'neutral' ? theme.palette.primary.main : accentFor(theme, color).main;

const colorStyles = (theme: Theme, color: Color, transparent: boolean): CSSObject => {
  const surface =
    color === 'neutral'
      ? { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary }
      : { backgroundColor: accentFor(theme, color).main, color: accentFor(theme, color).contrastText };

  return transparent ? { ...surface, backgroundColor: 'transparent' } : surface;
};

interface MenubarStyleFlags {
  variant: Variant;
  size: Size;
  color: Color;
  glow: boolean;
  pulse: boolean;
  glass: boolean;
  gradient: boolean;
  blur: boolean;
  transparent: boolean;
  elevation: number;
}

/**
 * Each variant's own additions to the shared bar. The `glass` and `gradient`
 * arms deliberately do not take the blur spread: glass sets its own
 * backdropFilter, and a blurred gradient loses the gradient.
 */
const SURFACES: Record<Variant, (theme: Theme, flags: MenubarStyleFlags) => CSSObject> = {
  glass: (theme, { glass }) => ({
    backgroundColor: alpha(theme.palette.background.paper, glass ? 0.1 : 0.8),
    backdropFilter: 'blur(20px)',
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  }),

  gradient: (theme, { color, gradient }) => {
    // `neutral` borrows primary for the gradient, as this branch always did.
    const accent = accentFor(theme, color === 'neutral' ? 'primary' : color);
    return {
      background: gradient
        ? `linear-gradient(135deg, ${accent.light}, ${accent.dark})`
        : accent.main,
      color: accent.contrastText,
    };
  },

  elevated: (theme, { blur, elevation }) => ({
    ...(blur && { backdropFilter: 'blur(10px)' }),
    boxShadow: theme.shadows[elevation],
  }),

  minimal: (_theme, { blur }) => ({
    ...(blur && { backdropFilter: 'blur(10px)' }),
    boxShadow: 'none',
    borderBottom: 'none',
  }),

  bordered: (theme, { blur, color }) => ({
    ...(blur && { backdropFilter: 'blur(10px)' }),
    borderBottom: `2px solid ${
      color === 'neutral' ? theme.palette.divider : accentFor(theme, color).main
    }`,
  }),

  default: (_theme, { blur }) => ({ ...(blur && { backdropFilter: 'blur(10px)' }) }),
};

export const barStyles = (theme: Theme, flags: MenubarStyleFlags): CSSObject => {
  const { variant, size, color, glow, pulse, transparent } = flags;

  return {
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.standard,
    }),
    ...sizeStyles(theme, size),
    ...colorStyles(theme, color, transparent),
    ...(glow && { boxShadow: `0 0 20px ${alpha(accentOf(theme, color), 0.4)}` }),
    ...(pulse && {
      animation: 'pulse 2s infinite',
      '@keyframes pulse': {
        '0%': { opacity: 1 },
        '50%': { opacity: 0.8 },
        '100%': { opacity: 1 },
      },
    }),
    ...(SURFACES[variant] ?? SURFACES.default)(theme, flags),
  };
};
