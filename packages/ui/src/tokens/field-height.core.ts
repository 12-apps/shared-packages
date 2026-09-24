import type { SizeValue } from './vocabulary';

/**
 * THE ONE HEIGHT EVERY FIELD IS DRAWN AT, WITH NO RENDERER BEHIND IT.
 *
 * A filter row used to stand at three heights — a 40px search box, 34px filter
 * pills, 38px category and "Mais" triggers — and a form's default field was
 * 56px beside a 44px button (FUT-2555). A field's height is one decision, so it
 * is one token, the same way its corner is (`./field-radius.core.ts`).
 *
 * It is a multiple of the DEFAULT FONT SIZE — `rem` on the web, the body size on
 * native — not a pixel count, so a field grows with the type it holds: a reader
 * who raises the browser's base size gets taller fields with it instead of text
 * crammed into a fixed box.
 *
 * The web reader and the theme channel are in `./field-height.ts`.
 */

/**
 * The standard field height, in multiples of the default font size.
 *
 * 2.5 — 40px at the 16px default: what MUI's small outlined field has always
 * drawn (the filter row's search box), and the 40px touch-target floor the
 * product already holds its controls to.
 */
export const DEFAULT_FIELD_HEIGHT = 2.5;

/** The px (dp) the default font size stands for — `1rem`, the body size. */
export const FIELD_HEIGHT_FONT_PX = 16;

/**
 * How each step of the size scale relates to the standard height.
 *
 * `sm` and `md` ARE the standard: they were the two everyday densities (a 40px
 * small field, a 56px medium one, a 36px and a 44px button), and a row mixing
 * them is exactly what this token ends. `xs` is the compact step; `lg` and `xl`
 * the roomy ones. All of them stay multiples of the font size.
 */
export const FIELD_HEIGHT_SCALE: Record<SizeValue, number> = {
  xs: 0.8,
  sm: 1,
  md: 1,
  lg: 1.2,
  xl: 1.4,
};

/** A usable standard height: the given one when it is a positive number, the default otherwise. */
export function resolveFieldHeight(height: unknown): number {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : DEFAULT_FIELD_HEIGHT;
}

/** A field's height for a size, in multiples of the default font size (`rem`). */
export function fieldHeightRem(height: number, size: SizeValue = 'md'): number {
  // Rounded to 1/10000rem: `3 * 0.8` is 2.4000000000000004 in floating point,
  // and that would be the CSS every field of the step is written with.
  return Math.round(resolveFieldHeight(height) * FIELD_HEIGHT_SCALE[size] * 10_000) / 10_000;
}

/** A field's height for a size in px (dp) — what the native renderer lays out. */
export function fieldHeightPx(height: number, size: SizeValue = 'md'): number {
  return fieldHeightRem(height, size) * FIELD_HEIGHT_FONT_PX;
}

/**
 * THE ONE RESTING BORDER EVERY FIELD DRAWS: this width, in `fieldEdge`'s colour
 * (`./field-edge.core.ts`, the tone of the theme's hairline that clears the 3:1
 * non-text contrast floor). A variant that draws a different edge on purpose —
 * `glass`, `gradient`, `underline`, a coloured outline button — keeps it.
 */
export const FIELD_BORDER_WIDTH = 1;
