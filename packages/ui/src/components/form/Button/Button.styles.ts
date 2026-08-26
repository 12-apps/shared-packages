import { alpha, darken, keyframes, lighten } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

// Define pulse animation globally
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 15px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

interface ColorPalette {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
}

const shade = (
  palette: ColorPalette | undefined,
  key: 'dark' | 'light',
  fallback: ColorPalette,
): string => palette?.[key] || palette?.main || fallback[key];

/** `neutral` has no MUI palette entry, so its four shades come from grey. */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey?.[700] || '#616161',
  dark: theme.palette.grey?.[800] || '#424242',
  light: theme.palette.grey?.[500] || '#9e9e9e',
  contrastText: '#fff',
});

export const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
  if (color === 'neutral') return neutralPalette(theme);

  const colorMap: Record<string, ColorPalette> = {
    primary: theme.palette.primary as ColorPalette,
    secondary: theme.palette.secondary as ColorPalette,
    success: theme.palette.success as ColorPalette,
    warning: theme.palette.warning as ColorPalette,
    info: theme.palette.info as ColorPalette,
    danger: theme.palette.error as ColorPalette,
  };

  const fallback = theme.palette.primary as ColorPalette;
  const palette = colorMap[color] || fallback;

  // Ensure palette has required properties
  return {
    main: palette?.main || fallback.main,
    dark: shade(palette, 'dark', fallback),
    light: shade(palette, 'light', fallback),
    contrastText: palette?.contrastText || '#fff',
  };
};

/** What an unrecognised size falls back to, named so indexing can never be undefined. */
const DEFAULT_SIZE: CSSObject = { padding: '8px 16px', fontSize: '1rem' };

const SIZE_MAP: Record<string, CSSObject> = {
  xs: { padding: '2px 8px', fontSize: '0.75rem' },
  sm: { padding: '6px 12px', fontSize: '0.875rem' },
  md: DEFAULT_SIZE,
  lg: { padding: '10px 20px', fontSize: '1.125rem' },
  xl: { padding: '12px 24px', fontSize: '1.25rem' },
};

/**
 * A BUTTON THAT IS ONLY AN ICON IS SQUARE.
 *
 * MUI puts a 64px `min-width` on every button, which is right for a label and
 * wrong for a glyph: three dots in a 64px slab reads as a button that failed to
 * load its text, and at the end of a dense row it claims space the row needs.
 * The horizontal padding goes too — a square of padding round a square glyph —
 * and so does the gap MUI reserves beside a start/end icon, since there is
 * nothing on the other side of it.
 *
 * Derived, not declared: a button with an `icon` and no children can only be an
 * icon button, so no consumer has to opt in and none can forget to.
 */
const ICON_ONLY_PADDING: Record<string, string> = {
  xs: '2px',
  sm: '5px',
  md: '7px',
  lg: '9px',
  xl: '11px',
};

const iconOnlySize = (size: string): CSSObject => ({
  minWidth: 0,
  padding: ICON_ONLY_PADDING[size] ?? ICON_ONLY_PADDING.md,
  fontSize: SIZE_MAP[size]?.fontSize ?? DEFAULT_SIZE.fontSize,
  '& .MuiButton-startIcon, & .MuiButton-endIcon': { margin: 0 },
});

/** The size styles for a button, square when it carries nothing but an icon. */
export const buttonSize = (size: string, iconOnly: boolean): CSSObject =>
  iconOnly ? iconOnlySize(size) : (SIZE_MAP[size] ?? DEFAULT_SIZE);

/**
 * MUI centres icons with a negative margin that fights our own padding, so the
 * flex alignment is restated here rather than fought with `!important`.
 */
export const iconAlignmentStyles = (theme: Theme): CSSObject => ({
  '& .MuiButton-startIcon, & .MuiButton-endIcon': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 0,
    verticalAlign: 'middle',
    '& > *': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 0,
    },
  },
  '& .MuiButton-startIcon': {
    marginRight: theme.spacing(0.5),
  },
  '& .MuiButton-endIcon': {
    marginLeft: theme.spacing(0.5),
  },
});

// Gradients run between two related hues; the named colours pick a specific pair,
// anything else runs from its own main to its own dark.
const GRADIENT_PAIRS: Record<string, (theme: Theme) => [string, string]> = {
  primary: (theme) => [theme.palette.primary.main, theme.palette.secondary.main],
  secondary: (theme) => [theme.palette.secondary.main, theme.palette.primary.main],
  success: (theme) => [theme.palette.success.light, theme.palette.success.dark],
  warning: (theme) => [theme.palette.warning.light, theme.palette.warning.dark],
  danger: (theme) => [theme.palette.error.light, theme.palette.error.dark],
};

const gradientFor = (theme: Theme, color: string, palette: ColorPalette): string => {
  const [from, to] = GRADIENT_PAIRS[color]?.(theme) ?? [palette.main, palette.dark];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
};

/**
 * The label colour for the two variants that paint no background of their own.
 *
 * `ghost` and `text` used `palette.main` directly, which is the same mistake
 * the Alert made with its body text: a palette's `main` is chosen to sit UNDER
 * white — it is the fill of a solid button — and it is not chosen to be read AS
 * text. `#6366F1`, the default primary, is 3.6:1 on white and worse on any
 * tinted surface, so a "Cancelar" or an "Agora não" placed on a coloured panel
 * turned into a smudge. That is precisely where these two variants belong: they
 * exist to be the quiet option NEXT to a solid one, so they are the buttons
 * most likely to be sitting on something other than plain paper.
 *
 * One step darker (lighter, on a dark theme) keeps the hue the caller asked for
 * and buys the contrast back. `main` still drives the hover wash and every
 * bordered variant, so nothing that was already legible moves.
 */
const quietInk = (theme: Theme, palette: ColorPalette): string =>
  theme.palette.mode === 'dark' ? lighten(palette.main, 0.35) : darken(palette.main, 0.3);

const VARIANT_STYLES: Record<
  string,
  (theme: Theme, palette: ColorPalette, color: string) => CSSObject
> = {
  solid: (theme, palette) => ({
    backgroundColor: palette.main,
    color: palette.contrastText || '#fff',
    '&:hover': {
      backgroundColor: palette.dark,
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows[8],
    },
  }),
  outline: (_theme, palette) => ({
    backgroundColor: 'transparent',
    color: palette.main,
    border: `1px solid ${palette.main}`,
    '&:hover': {
      backgroundColor: alpha(palette.main, 0.1),
      borderColor: palette.dark,
    },
  }),
  ghost: (theme, palette) => ({
    backgroundColor: 'transparent',
    color: quietInk(theme, palette),
    '&:hover': {
      backgroundColor: alpha(palette.main, 0.1),
    },
  }),
  text: (theme, palette) => ({
    backgroundColor: 'transparent',
    color: quietInk(theme, palette),
    border: `none`,
    '&:hover': {
      backgroundColor: alpha(palette.main, 0.1),
    },
    '&.active': {
      backgroundColor: alpha(palette.main, 0.1),
      color: quietInk(theme, palette),
    },
  }),
  glass: (theme, palette) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    color: palette.main,
    '&:hover': {
      backgroundColor: alpha(theme.palette.background.paper, 0.2),
      transform: 'translateY(-2px)',
    },
  }),
  gradient: (theme, palette, color) => ({
    background: gradientFor(theme, color, palette),
    color: '#fff',
    '&:hover': {
      filter: 'brightness(1.1)',
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows[12],
    },
  }),
};

export const buttonVariantStyles = (
  theme: Theme,
  variant: string | undefined,
  palette: ColorPalette,
  color: string,
): CSSObject => VARIANT_STYLES[variant ?? '']?.(theme, palette, color) ?? {};

// Glow effect - applied with !important to override variant shadows
const glowStyles = (palette: ColorPalette): CSSObject => ({
  boxShadow: `0 0 20px 5px ${alpha(palette.main, 0.6)}, 0 0 40px 10px ${alpha(palette.main, 0.3)} !important`,
  filter: 'brightness(1.05)',
  '&:hover': {
    boxShadow: `0 0 25px 8px ${alpha(palette.main, 0.7)}, 0 0 50px 15px ${alpha(palette.main, 0.4)} !important`,
    filter: 'brightness(1.1)',
    transform: 'translateY(-2px) scale(1.02)',
  },
});

// Pulse animation using pseudo-element
const pulseStyles = (palette: ColorPalette): CSSObject => ({
  position: 'relative',
  overflow: 'visible',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '100%',
    height: '100%',
    borderRadius: 'inherit',
    transform: 'translate(-50%, -50%)',
    backgroundColor: palette.main,
    opacity: 0.3,
    animation: `${pulseAnimation} 2s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

/**
 * glow and pulse are independent flags. The three combinations used to be spelled
 * out one by one, but each is just the union of whichever flags are set.
 */
export const buttonEmphasisStyles = (
  palette: ColorPalette,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow ? glowStyles(palette) : {}),
  ...(pulse ? pulseStyles(palette) : {}),
});
