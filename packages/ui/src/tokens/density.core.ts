/**
 * THE ONE DENSITY KNOB, WITH NO RENDERER BEHIND IT.
 *
 * A host that wants a compact admin or a roomy kiosk should say so once, in
 * the theme — not hunt through every component's own numbers. Because every
 * size already goes through `rem(theme, px)` / `theme.spacing()` / `fieldHeight()`
 * (FUT-2585, `./relative.ts`), moving the type scale, the spacing unit and the
 * field height BY THE SAME FACTOR is enough to make the whole package denser
 * or roomier — no `size` step is rewritten, no component is touched (FUT-2764
 * Decision 3).
 *
 * Three named levels, or a raw factor for a repository the three names don't
 * fit (a kiosk app, say). A repository can also redefine what a named level
 * itself means (`densityFactors`). Precedence, highest first: an explicit
 * `typography.fontSize` / `spacingUnit` / `fieldHeight` option (unchanged —
 * these already win over everything) > a numeric `density` (used as the
 * factor directly, no table lookup) > `densityFactors[level]` (a repository's
 * own override for a named level) > the built-in table below. No `density` at
 * all resolves to `{ level: 'normal', factor: 1 }` — today, byte-for-byte.
 *
 * This file is the resolver alone, so the native renderer and `./theme.ts`
 * read it without importing MUI. The web reader — `useDensity()`, the MUI
 * theme channel, and the standalone `densityThemeOptions()` — is in
 * `./density.ts`.
 */

export type DensityLevel = 'compact' | 'normal' | 'comfortable';

export const DEFAULT_DENSITY: DensityLevel = 'normal';

/**
 * The built-in factor table — the LOWEST-precedence source. A repository's
 * own `densityFactors` entry for a level wins over it; a numeric `density`
 * bypasses it entirely. Confirmed against screenshots before this PR merges
 * (see the ticket's Done when) — `compact` 0.9, `normal` 1 (no-op),
 * `comfortable` 1.1.
 */
export const DENSITY_FACTOR: Record<DensityLevel, number> = {
  compact: 0.9,
  normal: 1,
  comfortable: 1.1,
};

export interface ResolvedDensity {
  /** Present only when a NAMED level was given; a raw numeric `density` has no name. */
  level?: DensityLevel;
  factor: number;
}

/**
 * Precedence (highest first): a numeric `density` IS the factor, no table lookup.
 * A named `density` resolves through `factors?.[level] ?? DENSITY_FACTOR[level]` — a
 * repository's own `densityFactors` override wins over the built-in table. No `density`
 * at all resolves to `{ level: 'normal', factor: 1 }`.
 */
export function resolveDensityFactor(
  density?: DensityLevel | number,
  factors?: Partial<Record<DensityLevel, number>>,
): ResolvedDensity {
  if (typeof density === 'number') return { factor: density };
  const level = density ?? DEFAULT_DENSITY;
  return { level, factor: factors?.[level] ?? DENSITY_FACTOR[level] };
}

const BASE_FONT_SIZE = 14; // MUI's own typography.fontSize baseline
const BASE_SPACING_UNIT = 8; // theme.ts's literal default
const BASE_FIELD_HEIGHT = 2.5; // field-height.core.ts's DEFAULT_FIELD_HEIGHT

/** MUI's own `typography.fontSize` at this factor. `htmlFontSize` is never touched. */
export function densityFontSize(factor: number): number {
  return BASE_FONT_SIZE * factor;
}

/** The theme's `spacingUnit` at this factor. */
export function densitySpacingUnit(factor: number): number {
  return BASE_SPACING_UNIT * factor;
}

/** The standard field height (multiples of the default font size) at this factor. */
export function densityFieldHeight(factor: number): number {
  return BASE_FIELD_HEIGHT * factor;
}
