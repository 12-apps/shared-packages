/**
 * ONE SHADOW, IN THE SHAPE BOTH RENDERERS READ.
 *
 * A drop shadow is one of the few decorations the two sides express in the same
 * numbers and different syntax: CSS wants `0 8px 32px rgba(…)`, React Native
 * wants `{ offsetX, offsetY, blurRadius, spreadDistance, color }` (its
 * `BoxShadowValue`, which `boxShadow` takes an array of). So the numbers live in
 * a component's `*.metrics.ts` as this object, native passes it straight
 * through, and the web renders it with {@link shadowCss}.
 *
 * {@link shadowCss} reproduces the text the web components already wrote by
 * hand: a bare `0` for a zero length, and no spread at all when the spread is
 * zero. That is what makes moving a shadow into a metrics table a refactor
 * rather than a restyle.
 */
export interface UiShadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadDistance: number;
  color: string;
}

/** A length the way the web writes it: a bare `0`, otherwise px. */
const len = (value: number): string => (value === 0 ? '0' : `${value}px`);

/** One shadow as CSS. A zero spread is omitted, as the web has always written it. */
export const shadowCss = (shadow: UiShadow): string =>
  [
    len(shadow.offsetX),
    len(shadow.offsetY),
    len(shadow.blurRadius),
    ...(shadow.spreadDistance === 0 ? [] : [len(shadow.spreadDistance)]),
    shadow.color,
  ].join(' ');

/** Several shadows as one CSS declaration. */
export const shadowListCss = (shadows: readonly UiShadow[]): string =>
  shadows.map(shadowCss).join(', ');
