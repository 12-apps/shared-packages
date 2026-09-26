import { useTheme } from '@mui/material/styles/index.js';
import type { ThemeOptions } from '@mui/material/styles/index.js';

import {
  densityFieldHeight,
  densityFontSize,
  densitySpacingUnit,
  resolveDensityFactor,
  type DensityLevel,
  type ResolvedDensity,
} from './density.core';
import { fieldOverrides, mergeMuiComponents } from './field-height';
import { DEFAULT_FIELD_RADIUS } from './field-radius.core';

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
 * consumption paths agree on `typography`/`spacing`/`fieldHeight`/`components`
 * (FUT-2764's Design section), not just the first two. `fieldHeight` matters
 * on its own: `Input`/`Select`/`Button` each read `theme.fieldHeight` directly
 * (`Input.tsx`, `Select.tsx`, `Button.styles.ts`'s `buttonSize`), so a fragment
 * that carried only `typography`/`spacing` left every field standing at the
 * DEFAULT height (2.5) at every density on this path — the two paths would
 * agree on the type scale and disagree on the one number three components key
 * their own layout off. `components` is the matching MUI-native override
 * (`fieldOverrides`) for a HOST's own bare `TextField`/`Select`, mirroring
 * `muiThemeOptionsFrom`'s own `components: mergeMuiComponents(fieldOverrides(...))`
 * — density does not touch the field's CORNER, so the radius half of that
 * override is the same {@link DEFAULT_FIELD_RADIUS} `createUiTheme` itself
 * falls back to when a host names no `fieldRadius`.
 *
 * Spread it into a `createTheme(built, { ... })` call — but as the FIRST
 * (options) argument if `built` is itself a plain options object; a SECOND,
 * layering argument onto an ALREADY-BUILT `Theme` (`createTheme(outer, {
 * ...densityThemeOptions('compact') })`, the shape a host layering a second
 * theme on top of a first already uses) is deepmerged with no reprocessing, so
 * `spacing`/`typography.fontSize` would overwrite the already-resolved
 * `theme.spacing`/`pxToRem` instead of rescaling them — that host's own
 * adoption needs the fragment merged into its FIRST `createTheme()` call in
 * the chain, not spread onto an already-built one.
 *
 * ```ts
 * createTheme({ ...built, ...densityThemeOptions('compact') })
 * ```
 */
export function densityThemeOptions(
  density: DensityLevel | number,
  factors?: Partial<Record<DensityLevel, number>>,
): Pick<ThemeOptions, 'typography' | 'spacing' | 'fieldHeight' | 'components'> {
  const { factor } = resolveDensityFactor(density, factors);
  const fieldHeight = densityFieldHeight(factor);
  return {
    typography: { fontSize: densityFontSize(factor) },
    spacing: densitySpacingUnit(factor),
    fieldHeight,
    components: mergeMuiComponents(fieldOverrides(DEFAULT_FIELD_RADIUS, fieldHeight)),
  };
}
