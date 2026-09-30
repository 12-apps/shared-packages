import type { Theme } from '@mui/material/styles/index.js';

import { blend } from './color';

/**
 * THE SURFACE AND SOFT-SIGNAL ROLES (FUT-3098, under FUT-2585).
 *
 * Three colours a component or a host needs and the palette has no role for,
 * so until now each caller computed its own:
 *
 * - a ground BELOW the page, for a board that holds cards (a floor plan, a
 *   kanban), so a card on it reads as nearer;
 * - the border a card draws on that ground — `divider` is often the very tone
 *   the sunken ground wants, and a border in the ground's own colour vanishes;
 * - a soft background per signal. Components tint `palette.<signal>.main` by
 *   hand at whatever opacity each author chose (0.05, 0.08, 0.1…), so no two
 *   of them agree by design.
 *
 * Each role reads the theme with a host override layered on top, in the shape
 * `uiInk` uses (`./ink.ts`): `theme.uiSurfaces` and `theme.uiSoftSignal`. A
 * host builds one theme per mode, so it states each mode's values on that
 * mode's theme; with nothing stated, every role falls back to a formula over
 * the mode's own palette, and dark mode therefore resolves its own values.
 *
 * **Every default leaves a host that sets nothing unchanged.** `raised` is the
 * card MUI already paints (`background.paper`), `sunken` is the page itself
 * (`background.default` — no step; a host opts in to a darker ground by
 * stating one), and `borderOnSunken` is `divider`.
 */

/** A signal with a soft background: the four MUI semantic colours. */
export type SoftSignal = 'success' | 'warning' | 'error' | 'info';

/** Every signal {@link softSignal} answers for, in a stable order. */
export const SOFT_SIGNALS: readonly SoftSignal[] = ['success', 'warning', 'error', 'info'];

/**
 * How much of a signal's `main` its soft background carries by default, over
 * `background.paper` — the value the most careful of the hand tints already
 * used (`PasswordStrength`'s success wash).
 */
export const SOFT_SIGNAL_OPACITY = 0.08;

/**
 * The three surface roles.
 *
 * **Not `neutralTones(theme).raised`.** That one is a fixed step on the grey
 * ramp (800) — a dark panel on a light UI, whatever the mode. `raised` here is
 * the mode's own card surface, the one that sits nearer than `sunken`.
 */
export interface UiSurfaces {
  /** The ground below the page: a board, a floor, a lane that holds cards. */
  sunken: string;
  /** A card or panel lifted above the ground. */
  raised: string;
  /** The border of a `raised` card sitting on the `sunken` ground. */
  borderOnSunken: string;
}

declare module '@mui/material/styles' {
  interface Theme {
    /** Surface roles the host states. See `@12-apps/ui/tokens`' `surfaces`. */
    uiSurfaces?: Partial<UiSurfaces>;
    /** Soft signal backgrounds the host states. See `@12-apps/ui/tokens`' `softSignal`. */
    uiSoftSignal?: Partial<Record<SoftSignal, string>>;
  }
  interface ThemeOptions {
    /**
     * Replace any of the surface roles, per key; a key left out keeps its
     * default. One theme is one mode, so a host states each mode's values on
     * that mode's theme.
     */
    uiSurfaces?: Partial<UiSurfaces>;
    /**
     * Replace the soft background of any signal, per key. Each value must be
     * OPAQUE: a translucent wash takes on whatever sits under it (FUT-854).
     */
    uiSoftSignal?: Partial<Record<SoftSignal, string>>;
  }
}

/** The surface roles, with the host's `theme.uiSurfaces` layered over the defaults. */
export function surfaces(theme: Theme): UiSurfaces {
  const { background, divider } = theme.palette;
  const stated = theme.uiSurfaces;
  // `??` per key rather than a spread, so a key a host passes as `undefined`
  // (a conditional in its theme file) keeps the default instead of erasing it.
  return {
    sunken: stated?.sunken ?? background.default,
    raised: stated?.raised ?? background.paper,
    borderOnSunken: stated?.borderOnSunken ?? divider,
  };
}

/**
 * The soft background for a signal: the host's `theme.uiSoftSignal[signal]`
 * when stated, otherwise the signal's `main` at {@link SOFT_SIGNAL_OPACITY}
 * composited over `background.paper` into one OPAQUE colour.
 *
 * Opaque on purpose. A translucent `alpha(main, 0.08)` is a different colour
 * on every surface it lands on, and its contrast with the signal's own text
 * cannot be known in advance; a composited value is the same colour anywhere.
 *
 * A palette MUI accepts but cannot decompose — a named colour (`white`), a
 * `var(--…)`, a `color(display-p3 …)` — gets the same mix from the browser,
 * as a CSS `color-mix()`, rather than throwing at render.
 */
export function softSignal(theme: Theme, signal: SoftSignal): string {
  const stated = theme.uiSoftSignal?.[signal];
  if (stated !== undefined && stated !== '') return stated;
  const paper = theme.palette.background.paper;
  const main = theme.palette[signal].main;
  try {
    return blend(paper, main, SOFT_SIGNAL_OPACITY);
  } catch {
    return `color-mix(in srgb, ${main} ${SOFT_SIGNAL_OPACITY * 100}%, ${paper})`;
  }
}
