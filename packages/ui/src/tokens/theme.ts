import { darken, getContrastRatio, lighten } from './color';
import { cssLengthToPx, cssTrackingToEm } from './css-units';
import { HEADING_SCALE, type HeadingLevel } from './heading-scale';

import type { SizeValue } from './vocabulary';

/**
 * THE THEME BOTH RENDERERS READ.
 *
 * On the web every component styles itself from MUI's `Theme`, which is built
 * by the host (`@12-apps/app-shell`'s `createAppTheme` in the origin apps) and
 * reaches a component through emotion's context. React Native has no emotion,
 * no CSS and no MUI, so a native `Button` needs the same decisions — the
 * palette, the spacing unit, the radius, the type scale — from somewhere that
 * does not import a renderer.
 *
 * This is that somewhere. `UiTheme` is a plain object of numbers and colour
 * strings. `createUiTheme` derives it the way MUI's `createPalette` derives its
 * own: a `light` shade is `lighten(main, 0.2)`, a `dark` shade `darken(main,
 * 0.3)`, `contrastText` flips at a 3:1 ratio against `rgba(0, 0, 0, 0.87)`.
 * Same seeds in, same shades out, on both sides — that is the whole basis for
 * a native button being the web button's colour and not a near miss.
 *
 * Numbers are in px on the web and dp on native; both are the CSS-pixel unit
 * a design is drawn in, so a `fontSize: 16` here IS `1rem` in a web style
 * and `16` in a `StyleSheet`. The web components keep their `rem` strings and
 * derive them from these numbers where the two meet (see `px()` below and the
 * `*.metrics.ts` file beside each ported component).
 *
 * `danger` and `neutral` are this package's names (see `./scales`); `danger`
 * is MUI's `error` and `neutral` is drawn from the grey ramp the way
 * `Button.styles.ts` has always drawn it.
 */

export type UiThemeMode = 'light' | 'dark';

export interface UiPaletteColor {
  main: string;
  light: string;
  dark: string;
  contrastText: string;
}

export type UiGreyStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface UiPalette {
  mode: UiThemeMode;
  primary: UiPaletteColor;
  secondary: UiPaletteColor;
  success: UiPaletteColor;
  warning: UiPaletteColor;
  info: UiPaletteColor;
  danger: UiPaletteColor;
  neutral: UiPaletteColor;
  text: { primary: string; secondary: string; disabled: string };
  background: { default: string; paper: string };
  divider: string;
  action: {
    active: string;
    hover: string;
    selected: string;
    disabled: string;
    disabledBackground: string;
    focus: string;
  };
  grey: Record<UiGreyStep, string>;
}

/** One step of the body scale: `fontSize` in px, `lineHeight` as a ratio. */
export interface UiTypeStep {
  fontSize: number;
  lineHeight: number;
}

export type UiFontWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';

export interface UiHeadingStep extends UiTypeStep {
  /** In em, so it scales with the step. `undefined` is "normal". */
  letterSpacing?: number;
  normalWeight: number;
}

export interface UiTypography {
  /**
   * Native has no fallback stacks: a font is either installed and named, or
   * `undefined` and the platform's own. The web default is MUI's Roboto stack.
   */
  fontFamily: string | undefined;
  monospaceFontFamily: string | undefined;
  sizes: Record<SizeValue, UiTypeStep>;
  weights: Record<UiFontWeight, number>;
  heading: Record<HeadingLevel, UiHeadingStep>;
}

export interface UiTheme {
  mode: UiThemeMode;
  palette: UiPalette;
  /** MUI's `theme.spacing(n)`: `n` units of {@link UiTheme.spacingUnit}, in px. */
  spacing: (units: number) => number;
  spacingUnit: number;
  /** `md` is MUI's `shape.borderRadius`; the others are its halves and doubles. */
  radius: { sm: number; md: number; lg: number; xl: number; full: number };
  typography: UiTypography;
  zIndex: { appBar: number; drawer: number; modal: number; snackbar: number; tooltip: number };
}

/** A seed for one palette slot: a hex `main`, or any subset of the four shades. */
export type UiPaletteSeed = string | Partial<UiPaletteColor>;

export interface UiThemeOptions {
  mode?: UiThemeMode;
  palette?: Partial<{
    primary: UiPaletteSeed;
    secondary: UiPaletteSeed;
    success: UiPaletteSeed;
    warning: UiPaletteSeed;
    info: UiPaletteSeed;
    danger: UiPaletteSeed;
    background: Partial<UiPalette['background']>;
  }>;
  typography?: Partial<Pick<UiTypography, 'fontFamily' | 'monospaceFontFamily'>>;
  spacingUnit?: number;
}

const ROOT_FONT_PX = 16;

/** The px value as the rem string the web components write. */
export const px = (value: number): string => `${value / ROOT_FONT_PX}rem`;

/** MUI's `createPalette` defaults, exactly. */
const TONAL_OFFSET = 0.2;
const CONTRAST_THRESHOLD = 3;
const DARK_TEXT_PRIMARY = 'rgba(0, 0, 0, 0.87)';
const LIGHT_TEXT_PRIMARY = '#fff';

export const GREY: Record<UiGreyStep, string> = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#eeeeee',
  300: '#e0e0e0',
  400: '#bdbdbd',
  500: '#9e9e9e',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
};

/**
 * The platform's own seeds. The pair `@12-apps/ui`'s Storybook preview and
 * `@12-apps/app-shell`'s `DEFAULT_THEME_TOKENS` both carry — keep the three in
 * step if the design tokens change.
 */
export const DEFAULT_BRAND: Record<UiThemeMode, { primary: string; secondary: string }> = {
  light: { primary: '#6366F1', secondary: '#8B5CF6' },
  dark: { primary: '#818CF8', secondary: '#A78BFA' },
};

/** MUI's semantic defaults per mode. These are declared shades, not derived. */
const SEMANTIC_DEFAULTS: Record<
  UiThemeMode,
  Record<'success' | 'warning' | 'info' | 'danger', UiPaletteColor>
> = {
  light: {
    success: { main: '#2e7d32', light: '#4caf50', dark: '#1b5e20', contrastText: '#fff' },
    warning: { main: '#ed6c02', light: '#ff9800', dark: '#e65100', contrastText: '#fff' },
    info: { main: '#0288d1', light: '#03a9f4', dark: '#01579b', contrastText: '#fff' },
    danger: { main: '#d32f2f', light: '#ef5350', dark: '#c62828', contrastText: '#fff' },
  },
  dark: {
    success: { main: '#66bb6a', light: '#81c784', dark: '#388e3c', contrastText: DARK_TEXT_PRIMARY },
    warning: { main: '#ffa726', light: '#ffb74d', dark: '#f57c00', contrastText: DARK_TEXT_PRIMARY },
    info: { main: '#29b6f6', light: '#4fc3f7', dark: '#0288d1', contrastText: DARK_TEXT_PRIMARY },
    danger: { main: '#f44336', light: '#e57373', dark: '#d32f2f', contrastText: '#fff' },
  },
};

const MODE_DEFAULTS: Record<
  UiThemeMode,
  Pick<UiPalette, 'text' | 'background' | 'divider' | 'action'>
> = {
  light: {
    text: { primary: DARK_TEXT_PRIMARY, secondary: 'rgba(0, 0, 0, 0.6)', disabled: 'rgba(0, 0, 0, 0.38)' },
    background: { default: '#fff', paper: '#fff' },
    divider: 'rgba(0, 0, 0, 0.12)',
    action: {
      active: 'rgba(0, 0, 0, 0.54)',
      hover: 'rgba(0, 0, 0, 0.04)',
      selected: 'rgba(0, 0, 0, 0.08)',
      disabled: 'rgba(0, 0, 0, 0.26)',
      disabledBackground: 'rgba(0, 0, 0, 0.12)',
      focus: 'rgba(0, 0, 0, 0.12)',
    },
  },
  dark: {
    text: { primary: '#fff', secondary: 'rgba(255, 255, 255, 0.7)', disabled: 'rgba(255, 255, 255, 0.5)' },
    background: { default: '#121212', paper: '#121212' },
    divider: 'rgba(255, 255, 255, 0.12)',
    action: {
      active: '#fff',
      hover: 'rgba(255, 255, 255, 0.08)',
      selected: 'rgba(255, 255, 255, 0.16)',
      disabled: 'rgba(255, 255, 255, 0.3)',
      disabledBackground: 'rgba(255, 255, 255, 0.12)',
      focus: 'rgba(255, 255, 255, 0.12)',
    },
  },
};

/**
 * MUI's `getContrastText`: white where white reads at 3:1 on the colour, the
 * light mode's dark ink otherwise. (MUI's source spells the white as the DARK
 * palette's `text.primary`, which is what made it easy to read backwards.)
 */
export function contrastText(background: string): string {
  return getContrastRatio(background, LIGHT_TEXT_PRIMARY) >= CONTRAST_THRESHOLD
    ? LIGHT_TEXT_PRIMARY
    : DARK_TEXT_PRIMARY;
}

/**
 * MUI's `augmentColor` for a custom colour: derive whatever shade the seed
 * left out. `light` is one tonal offset up, `dark` one and a half down.
 */
export function augmentColor(seed: UiPaletteSeed): UiPaletteColor {
  const partial = typeof seed === 'string' ? { main: seed } : seed;
  const main = partial.main ?? partial.light ?? partial.dark;
  if (!main) {
    throw new Error('@12-apps/ui: a palette seed needs at least a `main` colour.');
  }
  return {
    main,
    light: partial.light ?? lighten(main, TONAL_OFFSET),
    dark: partial.dark ?? darken(main, TONAL_OFFSET * 1.5),
    contrastText: partial.contrastText ?? contrastText(main),
  };
}

const semantic = (
  mode: UiThemeMode,
  key: 'success' | 'warning' | 'info' | 'danger',
  seed: UiPaletteSeed | undefined,
): UiPaletteColor => (seed === undefined ? SEMANTIC_DEFAULTS[mode][key] : augmentColor(seed));

/** `neutral` as `accentFor` in `./scales` has always drawn it: three greys and white. */
export const NEUTRAL: UiPaletteColor = {
  main: GREY[600],
  light: GREY[400],
  dark: GREY[800],
  contrastText: '#fff',
};

/** The body scale `Text` renders, in px. `Text.tsx`'s rem map is this, divided by 16. */
export const TYPE_SIZES: Record<SizeValue, UiTypeStep> = {
  xs: { fontSize: 12, lineHeight: 1.2 },
  sm: { fontSize: 14, lineHeight: 1.3 },
  md: { fontSize: 16, lineHeight: 1.5 },
  lg: { fontSize: 18, lineHeight: 1.4 },
  xl: { fontSize: 20, lineHeight: 1.3 },
};

export const FONT_WEIGHTS: Record<UiFontWeight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// `HEADING_SCALE` speaks CSS, this theme speaks numbers; `./css-units` is the
// one place that conversion is written.
const HEADING_STEPS = Object.fromEntries(
  Object.entries(HEADING_SCALE).map(([level, metrics]) => [
    level,
    {
      fontSize: cssLengthToPx(metrics.fontSize, ROOT_FONT_PX),
      lineHeight: metrics.lineHeight,
      letterSpacing: cssTrackingToEm(metrics.letterSpacing),
      normalWeight: metrics.normalWeight,
    },
  ]),
) as Record<HeadingLevel, UiHeadingStep>;

export const WEB_FONT_FAMILY = '"Roboto", "Helvetica", "Arial", sans-serif';
export const WEB_MONOSPACE_FONT_FAMILY = 'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace';

/**
 * Build the theme. Every field is derived here so a host that changes one
 * seed gets every dependent shade recomputed, on both renderers, identically.
 */
export function createUiTheme(options: UiThemeOptions = {}): UiTheme {
  const mode = options.mode ?? 'light';
  const seeds = options.palette ?? {};
  const brand = DEFAULT_BRAND[mode];
  const defaults = MODE_DEFAULTS[mode];
  const spacingUnit = options.spacingUnit ?? 8;

  const palette: UiPalette = {
    mode,
    primary: augmentColor(seeds.primary ?? brand.primary),
    secondary: augmentColor(seeds.secondary ?? brand.secondary),
    success: semantic(mode, 'success', seeds.success),
    warning: semantic(mode, 'warning', seeds.warning),
    info: semantic(mode, 'info', seeds.info),
    danger: semantic(mode, 'danger', seeds.danger),
    neutral: NEUTRAL,
    text: defaults.text,
    background: { ...defaults.background, ...seeds.background },
    divider: defaults.divider,
    action: defaults.action,
    grey: GREY,
  };

  return {
    mode,
    palette,
    spacing: (units: number) => units * spacingUnit,
    spacingUnit,
    radius: { sm: 2, md: 4, lg: 8, xl: 16, full: 9999 },
    typography: {
      fontFamily: options.typography?.fontFamily,
      monospaceFontFamily: options.typography?.monospaceFontFamily,
      sizes: TYPE_SIZES,
      weights: FONT_WEIGHTS,
      heading: HEADING_STEPS,
    },
    zIndex: { appBar: 1100, drawer: 1200, modal: 1300, snackbar: 1400, tooltip: 1500 },
  };
}

/** The palette slot a house colour name resolves to. */
export type UiPaletteKey = 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'danger' | 'neutral';

export const DEFAULT_UI_THEME: UiTheme = createUiTheme();
