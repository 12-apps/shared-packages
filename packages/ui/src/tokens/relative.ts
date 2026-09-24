import type { Theme } from '@mui/material/styles/index.js';

/**
 * THE ONE WAY A COMPONENT WRITES A SIZE (FUT-2585).
 *
 * A density mode — a compact admin, a roomy kiosk — is one decision taken in
 * the theme, and it only works if every size a component draws is RELATIVE to
 * something the theme owns. Before this file the package said the same number
 * four ways: `'14px'`, `'0.875rem'`, `fontSize: 14` and `px(14)` from a
 * `*.metrics.ts` table, and none of the four moved with the theme. The audit
 * that opened FUT-2585 counted 1,269 `NNpx` literals, 246 hand-typed `rem`
 * literals and 24 reads of `theme.typography`.
 *
 * So there is one vocabulary: the px a design was drawn at, handed to the
 * theme's own type scale. `rem(theme, 14)` is `theme.typography.pxToRem(14)` —
 * `0.875rem` at MUI's defaults, which is what future-pay's `createAppTheme`
 * runs on, so converting a literal changes nothing on screen. A host that sets
 * `typography.fontSize` scales every size written through it (MUI multiplies
 * by `fontSize / 14`), and so does a reader who raises the browser's base font
 * — the rule the field height already follows (`./field-height.core.ts`).
 * `htmlFontSize` is not a knob: it DECLARES what the root already is. Values
 * that are relative another way stay so — `sx` spacing units and
 * `theme.spacing()` follow the spacing unit — so a density mode sets the type
 * scale, the spacing unit and `fieldHeight` together.
 *
 * Everything goes through it — font sizes, heights, widths, padding, offsets,
 * radii, shadow offsets, blurs and keyframe distances — because a density mode
 * that shrinks the box but not its shadow, or the text but not the gap beside
 * it, is visibly half-applied. The one literal left is the 1px hairline
 * border, which must stay one device pixel (`FIELD_BORDER_WIDTH`).
 *
 * `scripts/ui-tokens-gate.mjs` refuses a raw size or colour in a component, so
 * this is enforced rather than hoped for.
 */

/** A size drawn at `px` in the design, as rem through the theme's type scale. */
export function rem(theme: Theme, px: number): string {
  return theme.typography.pxToRem(px);
}

/**
 * {@link rem} as an `sx` value: `sx={{ width: sxRem(40) }}`.
 *
 * `sx` reads a NUMBER on `width` as pixels and on `padding` as spacing units,
 * so a bare number there is never density-safe; a theme callback is.
 */
export function sxRem(px: number): (theme: Theme) => string {
  return (theme) => rem(theme, px);
}

/** A length list (`'0 8px 32px'`-shaped) with every entry through {@link rem}. */
export function rems(theme: Theme, ...px: number[]): string {
  return px.map((value) => (value === 0 ? '0' : rem(theme, value))).join(' ');
}

const FALLBACK_ROOT_PX = 16;
let rootPxCache: number | null = null;
let watchingRoot = false;

/** Forget the measured root font size — for a test, or a host that changes it at runtime. */
export function resetRootFontCache(): void {
  rootPxCache = null;
}

/**
 * Drop the cache whenever the root's own style or class changes (a host
 * toggling `html { font-size }` for a density) or the window resizes (a
 * viewport-relative root). A browser-setting change is not observable from the
 * page; it takes a reload, as it does for everything else measured in px.
 */
function watchRoot(): void {
  if (watchingRoot || typeof MutationObserver === 'undefined') return;
  watchingRoot = true;
  new MutationObserver(resetRootFontCache).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  if (typeof window !== 'undefined') window.addEventListener('resize', resetRootFontCache);
}

/**
 * The document's root font size in px — what `1rem` actually renders at.
 * Without a document (server render) it is the theme's declared
 * `htmlFontSize`; a failed measurement is not cached, so a later call can
 * still measure.
 */
function rootFontPx(theme: Theme): number {
  if (rootPxCache !== null) return rootPxCache;
  const fallback = theme.typography.htmlFontSize ?? FALLBACK_ROOT_PX;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const measured = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (!(Number.isFinite(measured) && measured > 0)) return fallback;
  rootPxCache = measured;
  watchRoot();
  return measured;
}

/**
 * The pixels `rem(theme, px)` renders at, for layout that is computed in
 * JavaScript — a virtualiser's row height, an overflow cost table, a cell size.
 *
 * CSS and JS have to agree: a virtualiser that still assumes 52px rows while
 * the rows it positions have shrunk to 45 leaves a gap under every one of them.
 */
export function remPx(theme: Theme, px: number): number {
  return Number.parseFloat(rem(theme, px)) * rootFontPx(theme);
}
