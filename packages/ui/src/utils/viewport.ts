import type { CSSObject } from '@mui/material/styles';

/**
 * Viewport helpers for full-height surfaces (dialogs, drawers, slide-overs).
 *
 * iOS Safari and iOS Chrome resolve `100vh` against the *large* viewport — the
 * height the page would have if the browser chrome were hidden — while a
 * `position: fixed` element is still clipped by the *small* viewport that the
 * URL bar and toolbar actually leave visible. A panel sized `height: 100vh`
 * therefore ends underneath the toolbar, so the last rows of its scroll area
 * (typically the submit button) are unreachable: the rubber-band overscroll
 * that reveals them snaps straight back the moment the finger lifts.
 *
 * `100dvh` tracks the *dynamic* viewport, so the panel always ends where the
 * visible area ends. `100vh` stays as the fallback for browsers without
 * dynamic viewport units.
 */

/** Height unit for browsers without dynamic viewport units. */
export const VIEWPORT_HEIGHT_FALLBACK = '100vh';

/** Height unit that tracks the visible viewport as browser chrome shows/hides. */
export const DYNAMIC_VIEWPORT_HEIGHT = '100dvh';

/** The height properties {@link dynamicViewportHeight} can pin to the viewport. */
export type ViewportHeightProperty = 'height' | 'maxHeight' | 'minHeight';

/**
 * Full-viewport-height styles for the given properties: `100vh` up front, with a
 * `@supports` block upgrading to `100dvh` where dynamic viewport units exist.
 *
 * ```ts
 * const paper = { ...dynamicViewportHeight('height', 'maxHeight') };
 * ```
 */
export function dynamicViewportHeight(
  ...properties: readonly ViewportHeightProperty[]
): CSSObject {
  const pinned: ViewportHeightProperty[] =
    properties.length > 0 ? [...properties] : ['height'];
  const fallback: CSSObject = {};
  const dynamic: CSSObject = {};
  for (const property of pinned) {
    fallback[property] = VIEWPORT_HEIGHT_FALLBACK;
    dynamic[property] = DYNAMIC_VIEWPORT_HEIGHT;
  }
  return {
    ...fallback,
    [`@supports (height: ${DYNAMIC_VIEWPORT_HEIGHT})`]: dynamic,
  };
}

/**
 * Bottom padding that clears the iOS home indicator, added on top of a base
 * padding expressed in pixels. Falls back to the base value on browsers without
 * `env()` support.
 */
export function safeAreaBottom(basePx: number): CSSObject {
  return {
    paddingBottom: `${basePx}px`,
    '@supports (padding: max(0px))': {
      paddingBottom: `max(${basePx}px, calc(${basePx}px + env(safe-area-inset-bottom)))`,
    },
  };
}
