import type { Theme } from '@mui/material/styles/index.js';

import { alpha } from './color';
import {
  ATTENTION_INK,
  CELEBRATION_GRADIENTS,
  CODE_EDITOR_CHROME,
  DATA_VIZ_NEON,
  EFFECT_GLOW,
  GLASS_SLATE,
  HIGHLIGHT_MARK,
  MAP_SURFACE,
  NEUTRAL_RAMP,
  PANEL_SHADOW_INK,
  SOCIAL_BRAND,
  TIMING_PHASES,
} from './ink.core';

/**
 * EVERY COLOUR A COMPONENT DRAWS, BY ROLE (FUT-2593, under FUT-2585).
 *
 * A component never writes a hex, an `rgba()`, a named colour or a step on the
 * grey ramp; it asks for a ROLE, and the role reads the theme:
 *
 * - the palette's own roles, straight — `text.secondary`, `divider`,
 *   `action.hover`, a semantic `main` and its `contrastText`;
 * - the INK roles below, over the palette's two absolutes — a scrim behind a
 *   modal, a shadow's ink, a glass sheen, the ink on a photo;
 * - the NEUTRAL tones, over the grey ramp, named by what they do rather than by
 *   their step, so a host that re-greys the ramp re-greys every one;
 * - `uiInk(theme)`, the colours with no palette role at all (`./ink.core.ts`),
 *   which a host can replace through `theme.uiInk`.
 *
 * Every default is the value the component drew before, so moving a component
 * onto these changed nothing on screen. `scripts/ui-tokens-gate.mjs` refuses a
 * raw colour or a ramp step in a component from here on.
 */

export interface UiInk {
  dataVizNeon: { series: readonly string[]; ground: string; accent: string };
  timingPhases: Record<keyof typeof TIMING_PHASES, string>;
  mapSurface: Record<keyof typeof MAP_SURFACE, string>;
  codeEditor: { light: Record<keyof typeof CODE_EDITOR_CHROME.light, string>; dark: Record<keyof typeof CODE_EDITOR_CHROME.dark, string> };
  socialBrand: typeof SOCIAL_BRAND;
  celebration: { mint: readonly [string, string]; violet: readonly [string, string] };
  attention: { from: string; to: string; glow: string };
  highlightMark: string;
  glassSlate: string;
  panelShadowInk: string;
  effectGlow: { muiBlue: string; brandIndigo: string };
}

export const DEFAULT_UI_INK: UiInk = {
  dataVizNeon: DATA_VIZ_NEON,
  timingPhases: TIMING_PHASES,
  mapSurface: MAP_SURFACE,
  codeEditor: CODE_EDITOR_CHROME,
  socialBrand: SOCIAL_BRAND,
  celebration: CELEBRATION_GRADIENTS,
  attention: ATTENTION_INK,
  highlightMark: HIGHLIGHT_MARK,
  glassSlate: GLASS_SLATE,
  panelShadowInk: PANEL_SHADOW_INK,
  effectGlow: EFFECT_GLOW,
};

declare module '@mui/material/styles' {
  interface Theme {
    /** Colours with no palette role, by name. See `@12-apps/ui/tokens`' `uiInk`. */
    uiInk?: Partial<UiInk>;
  }
  interface ThemeOptions {
    /** Replace any of the named colour sets `@12-apps/ui` draws with. */
    uiInk?: Partial<UiInk>;
  }
}

/** The named colour sets, with the host's `theme.uiInk` layered over the defaults. */
export function uiInk(theme: Theme): UiInk {
  return { ...DEFAULT_UI_INK, ...theme.uiInk };
}

/* ── Ink roles over the palette's two absolutes ───────────────────────────── */

/** The dim laid behind a modal, a lightbox, a spotlight. */
export const scrim = (theme: Theme, opacity: number): string => alpha(theme.palette.common.black, opacity);

/** The colour of a drop shadow or a glow's dark half. */
export const shadowInk = (theme: Theme, opacity = 1): string => alpha(theme.palette.common.black, opacity);

/** A highlight: a glass edge, a shimmer, a pressed-in light. */
export const sheen = (theme: Theme, opacity = 1): string => alpha(theme.palette.common.white, opacity);

/** Ink that sits ON a photo, a gradient or a scrim — never on the page. */
export const onMedia = (theme: Theme): string => theme.palette.common.white;

/**
 * The palette's two absolutes, for the places the hue must be exactly black or
 * white: a CSS mask's opaque stop, the black `dark` tooltip.
 */
export const absoluteInk = (theme: Theme): { black: string; white: string } => ({
  black: theme.palette.common.black,
  white: theme.palette.common.white,
});

/** The absolute that CONTRASTS with the mode's page: black in light mode, white in dark. */
export const modeInk = (theme: Theme): string =>
  theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.common.black;

/* ── Neutral tones over the grey ramp ─────────────────────────────────────── */

const step = (theme: Theme, n: keyof typeof NEUTRAL_RAMP): string => theme.palette.grey[n] ?? NEUTRAL_RAMP[n];

/**
 * The neutral scale by ROLE. The names say what a tone is for, so a component
 * reads `neutralTones(theme).track` rather than "grey 300", and a host that
 * re-greys the ramp moves every one of them together.
 */
export function neutralTones(theme: Theme) {
  return {
    /** A dark chip on a light UI: a tooltip, a context menu, a code block's dark ground. */
    inverseSurface: step(theme, 900),
    /** A raised dark panel. */
    raised: step(theme, 800),
    /** A neutral control's fill. */
    strong: step(theme, 700),
    /** A neutral accent: a badge, a strong scrollbar thumb. */
    emphasis: step(theme, 600),
    /** A quiet mark: an offline dot, a secondary icon. */
    muted: step(theme, 500),
    /** An idle connector, a light scrollbar thumb. */
    subtle: step(theme, 400),
    /** An idle track, a placeholder fill. */
    track: step(theme, 300),
    /** A faint track, a light scrollbar channel. */
    faint: step(theme, 200),
    /** A light code block, a light card. */
    surface: step(theme, 100),
    /** The lightest ground. */
    canvas: step(theme, 50),
  };
}

/** The four-stop accent a component's `neutral` colour resolves to. */
export interface NeutralAccent {
  main: string;
  light: string;
  dark: string;
  contrastText: string;
}

/**
 * The neutral the CONTROLS draw with — grey 700, pressed 800, soft 500, white
 * ink — for `Button`, `Toggle`, `RadioGroup`, `Switch`, `Slider`, `Textarea`,
 * `InputOTP`. Not `accentFor(theme, 'neutral')` (600/400/800, a badge's): the
 * controls have always been one step darker.
 */
export function controlNeutral(theme: Theme): NeutralAccent {
  return { main: step(theme, 700), dark: step(theme, 800), light: step(theme, 500), contrastText: theme.palette.common.white };
}

/** The softer neutral a notice or a progress track draws with — 500 on a 300 ground, 700 pressed. */
export function softNeutral(theme: Theme): NeutralAccent {
  const main = step(theme, 500);
  return { main, light: step(theme, 300), dark: step(theme, 700), contrastText: theme.palette.getContrastText(main) };
}
