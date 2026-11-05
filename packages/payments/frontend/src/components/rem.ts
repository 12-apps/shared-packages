import type { Theme } from '@mui/material/styles';

/**
 * A size drawn at `px` in the design, written through the theme's type scale
 * (FUT-4432; the owner, 2026-11-05: "tem que ser rem — se não for rem quebra a
 * densidade").
 *
 * `theme.typography.pxToRem(px)` is `0.875rem` for 14 at MUI's defaults, so a
 * converted literal changes nothing on screen, and a host density mode that
 * sets `typography.fontSize` scales it with everything else. It is the same
 * rule as `@12-apps/ui/tokens`' `rem`/`sxRem` (FUT-2585), spelled here because
 * this package may not import `@12-apps/ui` (payments portability).
 *
 * New code in this package writes sizes through these; the 1px hairline is the
 * one literal left.
 */
export function rem(theme: Theme, px: number): string {
  return theme.typography.pxToRem(px);
}

/** {@link rem} as an `sx` value: `sx={{ minHeight: sxRem(44) }}`. */
export function sxRem(px: number): (theme: Theme) => string {
  return (theme) => rem(theme, px);
}

/** A length list (`'18px 22px 20px'`-shaped) with every entry through {@link rem}. */
export function rems(theme: Theme, ...px: number[]): string {
  return px.map((value) => (value === 0 ? '0' : rem(theme, value))).join(' ');
}
