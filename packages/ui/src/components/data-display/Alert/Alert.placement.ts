import type { Theme } from '@mui/material/styles/index.js';

/**
 * WHERE THE ICON SITS — a choice the HOST makes once, in its theme.
 *
 * - `'gutter'` (the default, and what every alert did before this existed):
 *   the icon has a column of its own, and the title and the description both
 *   start to its right. A two-line description wraps inside that narrower
 *   column and leaves an empty strip under the icon.
 * - `'title'`: the icon sits on the TITLE's line, and the description below
 *   starts at the alert's own edge and uses the whole line.
 *
 * It is a theme value, like `uiSurfaces`, because it is a house style rather
 * than a per-call decision: a host that wants it wants it on every alert, and a
 * per-call prop would have to be spelled at each of them. The `iconPlacement`
 * prop still exists for the one call site that must differ, and wins.
 *
 * An alert with no title, or no icon, has no title line to put the icon on;
 * `'title'` then renders exactly as `'gutter'` does.
 */
export type AlertIconPlacement = 'gutter' | 'title';

/** What a host may state about alerts, on its theme. */
export interface UiAlertTheme {
  iconPlacement?: AlertIconPlacement;
}

declare module '@mui/material/styles' {
  interface Theme {
    /** Alert layout the host states. See `Alert.placement.ts`. */
    uiAlert?: UiAlertTheme;
  }
  interface ThemeOptions {
    /** Alert layout, for every alert under this theme. See `Alert.placement.ts`. */
    uiAlert?: UiAlertTheme;
  }
}

/** The placement in force: the call site's, else the theme's, else `'gutter'`. */
export function resolveIconPlacement(
  theme: Theme,
  stated: AlertIconPlacement | undefined,
): AlertIconPlacement {
  return stated ?? theme.uiAlert?.iconPlacement ?? 'gutter';
}
