import type { AlertVariant } from './Alert.base';
import { alpha, darken, lighten } from '../../../tokens/color';
import { contrastText, type UiGreyStep, type UiTheme } from '../../../tokens/theme';

/**
 * THE NUMBERS BOTH `Alert` RENDERERS DRAW WITH.
 *
 * `Alert.styles.tsx` / `Alert.tsx` (MUI) and `Alert.native.tsx` (React
 * Native) read this one table. Spacing is in SPACING UNITS where the web
 * writes `theme.spacing(n)`; durations are ms (the web turns them into `s`
 * through {@link seconds} so its emitted CSS is byte-for-byte what it was);
 * everything else is px, a ratio or an alpha. The hover, active and focus
 * numbers are here too although only the DOM can honour them — a number the
 * web draws with belongs in the table whether or not native can reach it.
 */

/** The root: 12px corners, 14px 16px of padding, one 300ms curve for everything. */
export const ALERT_RADIUS_UNITS = 1.5;
export const ALERT_PADDING_UNITS = { vertical: 1.75, horizontal: 2 } as const;
export const ALERT_TRANSITION_MS = 300;
export const ALERT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Mount: the web's `fadeInScale` keyframes and the icon's `iconRotate`. */
export const FADE_IN = { ms: 300, scale: 0.95, lift: 10 } as const;
export const ICON_SPIN = { ms: 600, from: 0.8, mid: 1.1 } as const;
/** Dismiss: MUI `Collapse` runs 300ms; `onClose` fires 200ms in. */
export const COLLAPSE_MS = 300;
export const CLOSE_DELAY_MS = 200;

/** The message column: 8px between title, description and children; 0.95rem body on 1.5. */
export const MESSAGE_GAP_UNITS = 1;
export const MESSAGE_FONT_SIZE = 15.2;
export const MESSAGE_LINE_HEIGHT = 1.5;
/** A control inside the message gets an edge: 4px above, a hairline at 0.45 of the hue. */
export const MESSAGE_BUTTON = { marginTopUnits: 0.5, borderAlpha: 0.45 } as const;

/** The title: 1.05rem at 600; MUI's `AlertTitle` lifts it 2px; 4px below it when a description follows. */
export const TITLE = { fontSize: 16.8, fontWeight: 600, marginTop: -2, marginBottomUnits: 0.5 } as const;
/** The description: 0.925rem, slightly faded. */
export const DESCRIPTION = { fontSize: 14.8, opacity: 0.9 } as const;

/** The icon slot: MUI's 22px glyph at 0.9, 14px from the words, 2px down (MUI's 7px stays below). */
export const ICON_SLOT = { size: 22, opacity: 0.9, marginRightUnits: 1.75, paddingTopUnits: 0.25, paddingBottom: 7 } as const;
/** The action slot: MUI's `4px 0 0 16px` with the 16px ours, pushed right, 8px into the padding. */
export const ACTION_SLOT = { paddingLeftUnits: 2, paddingTop: 4, marginRight: -8 } as const;
/** The close button: MUI's small `IconButton` (5px padding, 18px glyph) at 0.7. */
export const CLOSE_BUTTON = { padding: 5, iconSize: 18, opacity: 0.7, washAlpha: 0.1 } as const;

/**
 * A semantic Alert's surface and ink: an OPAQUE tint of the hue with a dark
 * ink of the same hue — MUI's own `standard` recipe, at its ratios. See
 * `semanticSurface` in `Alert.styles.tsx` for why not `alpha(main, 0.1)`.
 */
export const SEMANTIC_SURFACE = { tint: { light: 0.9, dark: 0.8 }, ink: 0.6, borderAlpha: 0.35 } as const;
/** `glass`: 85% paper under a 20px blur, a 0.4 divider hairline. */
export const GLASS = { backgroundAlpha: 0.85, borderAlpha: 0.4, blur: 20, saturatePercent: 180 } as const;
/** `gradient`: light→dark at 0.9 along 135°, a 0.2 white shimmer sweeping 1000px every 3s. */
export const GRADIENT = {
  angleDeg: 135,
  stopAlpha: 0.9,
  shimmerAlpha: 0.2,
  shimmerMs: 3000,
  shimmerTravel: 1000,
  hoverBrightness: 1.04,
} as const;

/** Emphasis: the glow's shadow and brightness, the pulse's wash. */
export const GLOW = { blur: 20, spread: 5, alpha: 0.3, brightness: 1.05 } as const;
export const PULSE = { alpha: 0.2, ms: 2000, spread: 10 } as const;

/**
 * Pointer states — DOM only, kept so the web derives them.
 *
 * HOVER and ACTIVE carry NO geometry, and that is the point rather than an
 * omission. They used to lift the card 3px, scale it 1.01, grow a 20px shadow
 * and spin the icon 10deg at 1.15 — four things moving at once on a surface
 * that is not a control, which made a page of alerts twitch under the pointer
 * and reflowed nothing but read as though it had.
 *
 * A hover on a non-interactive surface only has to say "the pointer is here",
 * so one brightness step says it. Brightness rather than a background override
 * because every variant paints its own surface — standard a tint, `glass` a
 * blur, `gradient` a linear-gradient — and a colour written here would erase
 * whichever one is underneath.
 */
export const HOVER = { brightness: 0.98 } as const;
export const ACTIVE = { brightness: 0.96, ms: 100 } as const;
export const FOCUS = { ringWidth: 3, ringAlpha: 0.5, offset: 3, haloSpread: 6, haloAlpha: 0.1, ms: 200 } as const;

/** `neutral` has no palette slot; the web has always drawn it from three greys. */
export const NEUTRAL_GREY: Record<'main' | 'light' | 'dark', UiGreyStep> = { main: 500, light: 300, dark: 700 };

/** A duration as the CSS the web has always emitted: `2000` → `2s`, `300` → `0.3s`. */
export const seconds = (ms: number): string => `${ms / 1000}s`;

/** The palette shape the web's `getColorFromTheme` returns — a main plus optional shades. */
export interface AlertPalette {
  main: string;
  light?: string;
  dark?: string;
}

/**
 * The renderer-free twin of the web's `getColorFromTheme`: a variant or
 * colour name to its palette, `neutral` from the greys, anything unknown
 * (`glass`, `gradient`) to `info`.
 */
export function alertPalette(theme: UiTheme, key: string | undefined): AlertPalette {
  switch (key) {
    case 'info':
    case 'success':
    case 'warning':
    case 'danger':
    case 'primary':
    case 'secondary':
      return theme.palette[key];
    case 'neutral':
      return {
        main: theme.palette.grey[NEUTRAL_GREY.main],
        light: theme.palette.grey[NEUTRAL_GREY.light],
        dark: theme.palette.grey[NEUTRAL_GREY.dark],
      };
    default:
      return theme.palette.info;
  }
}

/** What a variant paints: its fill, its ink, its hairline if any, and the colour of its glyph. */
export interface AlertSurface {
  backgroundColor: string;
  color: string;
  borderColor?: string;
  iconColor: string;
}

export const SEMANTIC_VARIANTS: ReadonlySet<AlertVariant> = new Set(['info', 'success', 'warning', 'danger']);

/** The opaque tint and same-hue ink, inverted for dark mode; the hairline keeps its alpha. */
export function semanticSurface(theme: UiTheme, palette: AlertPalette): AlertSurface {
  const dark = theme.mode === 'dark';
  return {
    backgroundColor: dark
      ? darken(palette.main, SEMANTIC_SURFACE.tint.dark)
      : lighten(palette.main, SEMANTIC_SURFACE.tint.light),
    color: dark ? lighten(palette.main, SEMANTIC_SURFACE.ink) : darken(palette.main, SEMANTIC_SURFACE.ink),
    borderColor: alpha(palette.main, SEMANTIC_SURFACE.borderAlpha),
    iconColor: palette.main,
  };
}

export function glassSurface(theme: UiTheme): AlertSurface {
  return {
    backgroundColor: alpha(theme.palette.background.paper, GLASS.backgroundAlpha),
    color: theme.palette.text.primary,
    borderColor: alpha(theme.palette.divider, GLASS.borderAlpha),
    iconColor: theme.palette.primary.main,
  };
}

/** The gradient's two stops; a renderer with no gradient fill paints `from`. */
export function gradientStops(palette: AlertPalette): { from: string; to: string } {
  return {
    from: alpha(palette.light || palette.main, GRADIENT.stopAlpha),
    to: alpha(palette.dark || palette.main, GRADIENT.stopAlpha),
  };
}

export function gradientSurface(palette: AlertPalette): AlertSurface {
  const ink = contrastText(palette.main);
  return { backgroundColor: gradientStops(palette).from, color: ink, iconColor: ink };
}

/** The surface for a variant, `glass` and `gradient` included. */
export function alertSurface(theme: UiTheme, variant: AlertVariant, palette: AlertPalette): AlertSurface {
  if (variant === 'glass') return glassSurface(theme);
  if (variant === 'gradient') return gradientSurface(palette);
  return semanticSurface(theme, palette);
}
