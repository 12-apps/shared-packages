import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { fieldEdge } from './field-edge';
import { fieldRadiusOverrides, fieldRootStyles } from './field-radius';
import {
  DEFAULT_FIELD_HEIGHT,
  FIELD_BORDER_WIDTH,
  FIELD_HEIGHT_SCALE,
  fieldHeightRem,
  resolveFieldHeight,
} from './field-height.core';

import type { SizeValue } from './vocabulary';

/**
 * THE FIELD HEIGHT AND BORDER ON THE WEB: the theme channel, the readers, and
 * the styles that put a MUI text field or select on them.
 *
 * The argument for one height is in `./field-height.core.ts`. It is a top-level
 * theme key for the reason `fieldRadius` is (`./field-radius.ts`): MUI types
 * `shape` in `@mui/system`, which this package does not depend on.
 */

export {
  DEFAULT_FIELD_HEIGHT,
  FIELD_BORDER_WIDTH,
  FIELD_HEIGHT_SCALE,
  fieldHeightPx,
  fieldHeightRem,
} from './field-height.core';

declare module '@mui/material/styles' {
  interface Theme {
    /** The standard field height, in multiples of the default font size. See `@12-apps/ui/tokens`' `fieldHeight`. */
    fieldHeight?: number;
  }
  interface ThemeOptions {
    /** The standard field height, in multiples of the default font size. Defaults to {@link DEFAULT_FIELD_HEIGHT}. */
    fieldHeight?: number;
  }
}

/** A component's own size string as a step of the field scale — `md` when it is not one. */
export function asFieldSize(size: string | undefined): SizeValue {
  return size !== undefined && size in FIELD_HEIGHT_SCALE ? (size as SizeValue) : 'md';
}

/** A field's height for a size, as CSS — `2.5rem` for the default. */
export function fieldHeight(theme: Theme, size: SizeValue = 'md'): string {
  return `${fieldHeightRem(resolveFieldHeight(theme.fieldHeight), size)}rem`;
}

/** The resting border every field draws: 1px in {@link fieldEdge}'s colour. */
export function fieldBorder(theme: Theme, surface?: string): string {
  return `${FIELD_BORDER_WIDTH}px solid ${fieldEdge(theme, surface)}`;
}

/**
 * The vertical padding that makes a one-line box `height` tall around MUI's
 * `1.4375em` line — in `em`, so it is measured against the field's own type.
 */
const verticalInset = (height: string): string => `calc((${height} - 1.4375em) / 2)`;

/**
 * A MUI `TextField` / `Select` / `Autocomplete` (outlined, one line) at the
 * field height for `size`: the root's own vertical padding goes, the input
 * takes the inset, and the resting label sits on the new centre line.
 *
 * Multiline fields are left alone — their height is their content's — and so
 * are `filled` and `standard`, whose label sits inside the box and which draw
 * their own heights as variants.
 */
export function fieldControlStyles(theme: Theme, size: SizeValue = 'md'): CSSObject {
  const inset = verticalInset(fieldHeight(theme, size));
  return {
    '& .MuiOutlinedInput-root:not(.MuiInputBase-multiline)': {
      paddingTop: 0,
      paddingBottom: 0,
      '& .MuiOutlinedInput-input, & .MuiSelect-select': { paddingTop: inset, paddingBottom: inset },
    },
    '& .MuiInputLabel-outlined:not(.MuiInputLabel-shrink)': {
      transform: `translate(14px, ${inset}) scale(1)`,
    },
  };
}

/**
 * MUI component overrides that put MUI's OWN outlined fields on the standard
 * height — for a host's bare `TextField` / `Select`, the way
 * `fieldRadiusOverrides` rounds them. Every size MUI has maps to the standard:
 * a host that wants another density asks this package's fields for a `size`.
 */
export function fieldHeightOverrides(height: number = DEFAULT_FIELD_HEIGHT): Components<Theme> {
  const inset = verticalInset(`${fieldHeightRem(height)}rem`);
  return {
    MuiOutlinedInput: {
      styleOverrides: {
        input: { '&:not(.MuiInputBase-inputMultiline)': { paddingTop: inset, paddingBottom: inset } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        outlined: { '&:not(.MuiInputLabel-shrink)': { transform: `translate(14px, ${inset}) scale(1)` } },
      },
    },
  };
}

/**
 * Both field overrides — the corner and the height — merged per component.
 * They meet on `MuiOutlinedInput` (`root` from the radius, `input` from the
 * height), so a plain spread would lose one of them.
 */
export function fieldOverrides(radius: number | undefined, height: number | undefined): Components<Theme> {
  type Entry = { styleOverrides?: Record<string, unknown> };
  const corner = fieldRadiusOverrides(radius) as Record<string, Entry>;
  const tall = fieldHeightOverrides(height) as Record<string, Entry>;
  const names = new Set([...Object.keys(corner), ...Object.keys(tall)]);
  return Object.fromEntries(
    [...names].map((name) => [
      name,
      { styleOverrides: { ...corner[name]?.styleOverrides, ...tall[name]?.styleOverrides } },
    ]),
  ) as Components<Theme>;
}

/**
 * THE field standard on a MUI `TextField` / `Select` / `Autocomplete`, for a
 * composite that renders MUI's own: the field radius, the field height for
 * `size`, and the one resting border ({@link fieldEdge}). MUI's own hover,
 * focus and error borders outrank the resting one, so they still show.
 */
export function fieldTextFieldStyles(theme: Theme, size: SizeValue = 'md'): CSSObject {
  return {
    ...fieldRootStyles(theme),
    ...fieldControlStyles(theme, size),
    '& .MuiOutlinedInput-notchedOutline': { borderColor: fieldEdge(theme) },
  };
}
