/**
 * A SECTION BAND'S FILL, DERIVED FROM THE SURFACES IT SITS BETWEEN.
 *
 * Split out of `brand-palette.ts` rather than living beside it, because the two
 * answer different questions with the same arithmetic. That file corrects a
 * colour until it can be READ — text on a surface, judged at 4.5:1. This one
 * separates two large flat areas until you can see where one ends, judged at
 * 1.12:1, and the tone it returns is never text. Sharing a file made the two
 * floors look like alternatives.
 */
import {
  brandHex,
  contrastRatio,
  hslToHex,
  rgbToHsl,
  toRgb,
  LIGHTNESS_STEP,
  SURFACE_SATURATION,
} from './brand-palette';

/**
 * How far a band has to stand off a surface before the step is visible at all.
 *
 * Below roughly 1.12:1 two large flat areas stop reading as separate planes —
 * the edge disappears and the band becomes part of whatever it sits on. It is
 * far below any text floor on purpose: this is a SURFACE separation, judged by
 * whether you can see where one ends, not whether you can read on it.
 */
export const MIN_SURFACE_SEPARATION = 1.12;

/**
 * A section band's fill, DERIVED from the ground it sits on.
 *
 * {@link TINT_LIGHTNESS} states a number, and that works in light mode because
 * there is exactly one light ground. Dark mode has two by decision — the
 * platform's and a store's own — and they want opposite answers. Measured
 * across six hues, requiring the band to separate from BOTH the page and the
 * cards on it:
 *
 * | band lightness | a deep-red page at 21.8% (card 29.8%) | a navy page at 12% (card ~19%) |
 * | --- | --- | --- |
 * | 8%  | every hue clears both | all six vanish into the page |
 * | 26% | grey vanishes into the card | every hue clears both |
 *
 * 8% is the only value that works on the platform ground and the worst
 * available one on a store's. So a dark twin of `TINT_LIGHTNESS` is the
 * obvious shape and the wrong one: the band is not a lightness, it is an
 * OFFSET, and the offset has a direction.
 *
 * **The direction is away from the card.** Cards are the thing a band must not
 * be confused with, and they sit on one side of the page — raised on a dark
 * ground, usually the same white on a light one. Walking away from them
 * separates from both at once: on the red page the card is above it, so the
 * band descends; on a 12% page there is no room below, so it ascends, and the
 * card being only 7 points up still leaves it reachable.
 *
 * Returns the ground itself when no tone in either direction can separate —
 * a caller gets a band that is invisible rather than one that is wrong, and
 * `bandToneSeparates` below is how a test says so out loud.
 */
export function bandTone(
  seed: string,
  ground: string,
  card: string,
  saturation: readonly [number, number] = SURFACE_SATURATION,
  min: number = MIN_SURFACE_SEPARATION,
): string {
  const hex = brandHex(seed);
  const groundHex = brandHex(ground);
  const cardHex = brandHex(card);
  if (!hex || !groundHex || !cardHex) return seed;

  const { h, s } = rgbToHsl(toRgb(hex));
  const groundL = rgbToHsl(toRgb(groundHex)).l;
  const start = { h, s: surfaceSaturation(s, saturation), l: groundL };

  for (const direction of directionsFrom(groundL, rgbToHsl(toRgb(cardHex)).l)) {
    const found = walkToSeparation(start, direction, groundHex, cardHex, min);
    if (found) return found;
  }
  return groundHex;
}

/**
 * The seed's saturation, held inside the band's range — and a hueless seed left
 * hueless, because a tint invented for a grey is a colour the owner never
 * chose. `brandTone` makes the same argument.
 */
function surfaceSaturation(s: number, [floor, ceiling]: readonly [number, number]): number {
  return s === 0 ? 0 : Math.min(Math.max(s, floor), ceiling);
}

/**
 * Away from the card first, then past it.
 *
 * When the card IS the ground — a light page whose cards are the same white —
 * there is no side to move away from, so the band goes down, which is what
 * {@link TINT_LIGHTNESS} has always done. The second direction is for a ground
 * with no room on the first: past the cards rather than away from them, which
 * still separates from both.
 */
function directionsFrom(groundL: number, cardL: number): readonly (1 | -1)[] {
  const away: 1 | -1 = cardL > groundL ? -1 : 1;

  return [away, away === 1 ? -1 : 1];
}

/** Does this band actually read as its own plane against both surfaces? */
export function bandToneSeparates(
  band: string,
  ground: string,
  card: string,
  min: number = MIN_SURFACE_SEPARATION,
): boolean {
  return contrastRatio(band, ground) >= min && contrastRatio(band, card) >= min;
}

/**
 * Step away from `start` until the tone clears `min` against BOTH surfaces.
 *
 * Separate from `brand-palette.ts`'s own `walkToContrast` rather than
 * generalised with it: that one walks a SEED until it is legible on one surface and stops at the first
 * tone that clears, which is the minimum move from what the owner chose. This
 * one walks the GROUND until it separates from two, and the two can disagree —
 * a step that clears the page may still be inside the card. Folding them
 * together would give one of the callers the other's stopping rule.
 */
function walkToSeparation(
  hsl: { h: number; s: number; l: number },
  direction: 1 | -1,
  ground: string,
  card: string,
  min: number,
): string | null {
  const steps = Math.round(1 / LIGHTNESS_STEP);
  for (let step = 1; step <= steps; step += 1) {
    const next = hsl.l + direction * step * LIGHTNESS_STEP;
    if (next < 0 || next > 1) return null;
    const candidate = hslToHex(hsl.h, hsl.s, next);
    if (contrastRatio(candidate, ground) >= min && contrastRatio(candidate, card) >= min) {
      return candidate;
    }
  }
  return null;
}
