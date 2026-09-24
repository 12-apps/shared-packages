import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { DEFAULT_FIELD_RADIUS } from './field-radius.core';

/**
 * THE FIELD RADIUS ON THE WEB: the theme channel, the reader, and the MUI
 * overrides that carry it into controls this package does not style itself.
 *
 * The argument for one radius is in `./field-radius.core.ts`.
 *
 * ## Why a key of our own, and not `shape.borderRadius`
 *
 * `shape.borderRadius` is MUI's GENERAL radius: `Paper`, `Card`, `Menu`,
 * `Alert`, `Chip` and every `sx={{ borderRadius: n }}` multiply it. Moving it to
 * round the fields would round every surface in the app along with them. A
 * separate key moves the fields and nothing else.
 *
 * It is a top-level theme key rather than `shape.fieldRadius` because MUI types
 * `shape` in `@mui/system`, which this package does not depend on — augmenting
 * it would fail to resolve in a host. MUI documents top-level custom variables
 * for exactly this, and `createTheme` carries unknown keys through.
 */

export { DEFAULT_FIELD_RADIUS } from './field-radius.core';

declare module '@mui/material/styles' {
  interface Theme {
    /** The radius every field is drawn with, in px. See `@12-apps/ui/tokens`' `fieldRadius`. */
    fieldRadius?: number;
  }
  interface ThemeOptions {
    /** The radius every field is drawn with, in px. Defaults to {@link DEFAULT_FIELD_RADIUS}. */
    fieldRadius?: number;
  }
}

/** The field radius the host's theme asks for, in px — the default when it asks for none. */
export function fieldRadius(theme: Theme): number {
  const radius = theme.fieldRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius >= 0 ? radius : DEFAULT_FIELD_RADIUS;
}

/**
 * {@link fieldRadius} as a `px` string, for `sx`.
 *
 * `sx` MULTIPLIES a bare number by `shape.borderRadius` — `sx={{ borderRadius: 8 }}`
 * is 32px on the default theme — so a field radius handed to `sx` must carry
 * its unit. `styled()` objects take the plain number.
 */
export function fieldRadiusPx(theme: Theme): string {
  return `${fieldRadius(theme)}px`;
}

/**
 * The field radius on a MUI `TextField`'s input root — for a composite that
 * renders MUI's own `TextField`, so it follows the theme's field radius under
 * ANY theme, not only one built with {@link fieldRadiusOverrides}. Plain CSS
 * with the unit, so it works as `styled()` styles and as an `sx` entry.
 */
export function fieldRootStyles(theme: Theme): CSSObject {
  const radius = fieldRadiusPx(theme);
  return {
    '& .MuiOutlinedInput-root': { borderRadius: radius },
    '& .MuiFilledInput-root': { borderTopLeftRadius: radius, borderTopRightRadius: radius },
  };
}

/**
 * MUI component overrides that round MUI's OWN fields to `radius`.
 *
 * This package's fields read {@link fieldRadius} themselves, so they are right
 * under any theme. These overrides are for the host's: a bare `TextField`,
 * `Select` or `Button` a host renders straight from MUI would otherwise keep
 * `shape.borderRadius` and sit in the row with a different corner. A theme builder spreads them into `components`, under the
 * host's own entries so a host override still wins.
 *
 * `FilledInput` rounds its top corners only — its bottom edge is the underline.
 */
export function fieldRadiusOverrides(radius: number = DEFAULT_FIELD_RADIUS): Components<Theme> {
  return {
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: radius } } },
    MuiFilledInput: {
      styleOverrides: { root: { borderTopLeftRadius: radius, borderTopRightRadius: radius } },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: radius } } },
    // The group squares its inner corners itself, so rounding each button
    // rounds the group's outer ones.
    MuiToggleButton: { styleOverrides: { root: { borderRadius: radius } } },
  };
}
