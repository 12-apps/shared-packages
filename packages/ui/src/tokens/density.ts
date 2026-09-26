import { useTheme } from '@mui/material/styles/index.js';
import type { ThemeOptions } from '@mui/material/styles/index.js';

import {
  densityFontSize,
  densitySpacingUnit,
  resolveDensityFactor,
  type DensityLevel,
  type ResolvedDensity,
} from './density.core';

/**
 * DENSITY ON THE WEB: the MUI theme channel, the reader, and the standalone
 * entry point for a host that never calls `createUiTheme`/`UiProvider`.
 *
 * The argument for one density knob, the factor table and its precedence are
 * in `./density.core.ts`.
 */

export {
  DEFAULT_DENSITY,
  DENSITY_FACTOR,
  densityFieldHeight,
  densityFontSize,
  densitySpacingUnit,
  resolveDensityFactor,
  type DensityLevel,
  type ResolvedDensity,
} from './density.core';

declare module '@mui/material/styles' {
  interface Theme {
    /** The density this theme renders at. See `@12-apps/ui/tokens`' `useDensity`. */
    density?: ResolvedDensity;
  }
  interface ThemeOptions {
    /** The density this theme renders at. See `@12-apps/ui/tokens`' `useDensity`. */
    density?: ResolvedDensity;
  }
}

/**
 * The theme's resolved density — a plain theme read, not a step-shifting
 * resolver (`size` stays hierarchy; see `./density.core.ts`). A `styleOverrides`
 * callback already gets `{ theme }` and can read `theme.density` directly;
 * this is for a component that needs the level in its own render logic
 * (`Table`/`DataGrid`/`DataViews` each read it once to source their own
 * `density` prop's default).
 *
 * Falls back to `resolveDensityFactor()` (`'normal'`, factor `1`) for a bare
 * MUI theme built without `createUiTheme`/`muiThemeOptionsFrom`.
 */
export function useDensity(): ResolvedDensity {
  return useTheme().density ?? resolveDensityFactor();
}

/**
 * The density factor as a MUI `ThemeOptions` fragment, for a host that builds
 * `createTheme()` directly and never calls `createUiTheme`/`UiProvider` — the
 * same precedence `resolveDensityFactor` gives `createUiTheme`, so the two
 * consumption paths agree. Spread it into a `createTheme(built, { ... })` call:
 *
 * ```ts
 * createTheme(built, { ...densityThemeOptions('compact') })
 * ```
 */
export function densityThemeOptions(
  density: DensityLevel | number,
  factors?: Partial<Record<DensityLevel, number>>,
): Pick<ThemeOptions, 'typography' | 'spacing'> {
  const { factor } = resolveDensityFactor(density, factors);
  return {
    typography: { fontSize: densityFontSize(factor) },
    spacing: densitySpacingUnit(factor),
  };
}
