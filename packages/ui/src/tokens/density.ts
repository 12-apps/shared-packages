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
 * their own layout off.
 *
 * `components` is the matching MUI-native override (`fieldOverrides`) for a
 * HOST's own bare `TextField`/`Select`, mirroring `muiThemeOptionsFrom`'s own
 * `components: mergeMuiComponents(fieldOverrides(...))`. It carries ONLY the
 * field overrides this function knows about (`MuiOutlinedInput`'s `root`,
 * `input` and `notchedOutline`; `MuiInputLabel`'s `outlined`) — a host with
 * ITS OWN overrides for OTHER components merges them in with
 * `mergeMuiComponents(densityThemeOptions(density).components, hostOverrides)`,
 * which keeps a component only ONE side touches untouched. For a component
 * BOTH sides style, the merge is by INNER key (`root`/`input`/…): a key only
 * one side sets survives from that side, but a key BOTH set is replaced
 * WHOLESALE by whichever source is passed LAST — not deep-merged — so a host
 * wanting to ADD to, say, `MuiOutlinedInput`'s `root` alongside the radius
 * override needs to write that one key's object out in full itself.
 *
 * `fieldRadius` (3rd argument, optional) exists because density does NOT touch
 * the field's CORNER — this is only for a host that already draws its OWN,
 * non-default radius and wants `components` to match it instead of clashing;
 * it defaults
 * to the same {@link DEFAULT_FIELD_RADIUS} `createUiTheme` itself falls back
 * to when a host names no `fieldRadius`, so the two paths still agree with no
 * argument passed at all — the existing 2-argument call keeps working
 * unchanged.
 *
 * **Where to spread it — the first `createTheme()` call, not a later layering
 * one.** `createTheme(options, ...args)` (`createThemeNoVars.js`) only runs
 * `createSpacing`/`createTypography` on `options`, the FIRST argument; every
 * later argument is deep-merged onto the theme those two already built, with
 * no such reprocessing. So a host with a base theme and a SECOND, layering
 * `createTheme()` call on top of it — exactly the shape a two-theme host uses,
 * `createTheme(outer, { palette: { ... } })` — must apply density at the
 * FIRST call (where the base itself is built), never spread onto `outer` in
 * the second one:
 *
 * ```ts
 * // RIGHT — density goes into the base's OWN construction. The second,
 * // layering call is unaffected: it never restates spacing/typography/
 * // fieldHeight/components itself, so `theme.spacing`/`pxToRem`/`fieldHeight`
 * // carry over from `base` UNCHANGED, already correctly scaled.
 * const base = createTheme({ palette: { primary: { main }, ... }, ...densityThemeOptions('compact') });
 * const themed = createTheme(base, { palette: { primary: { main: brand } } });
 *
 * // WRONG — a second, layering argument onto an ALREADY-BUILT theme is
 * // deepmerged with no reprocessing: `spacing`/`typography.fontSize` would
 * // overwrite the already-resolved `theme.spacing` function/`pxToRem` ratio
 * // instead of rescaling them.
 * createTheme(outer, { ...densityThemeOptions('compact') });
 * ```
 */
export function densityThemeOptions(
  density: DensityLevel | number,
  factors?: Partial<Record<DensityLevel, number>>,
  fieldRadius: number = DEFAULT_FIELD_RADIUS,
): Pick<ThemeOptions, 'typography' | 'spacing' | 'fieldHeight' | 'components'> {
  const { factor } = resolveDensityFactor(density, factors);
  const fieldHeight = densityFieldHeight(factor);
  return {
    typography: { fontSize: densityFontSize(factor) },
    spacing: densitySpacingUnit(factor),
    fieldHeight,
    components: mergeMuiComponents(fieldOverrides(fieldRadius, fieldHeight)),
  };
}
