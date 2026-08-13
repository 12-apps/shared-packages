/**
 * The contrast floor a tenant owner cannot fall through.
 *
 * Every assertion here is about the RATIO, never about a specific hex. A test
 * that pinned `#3d851e` would pass just as happily on a colour nobody can read,
 * and would break the day the walk gets a finer step — the guarantee is
 * 'legible', not 'this exact tone'.
 */
import { describe, expect, it } from 'vitest';

import {
  brandHex,
  brandTone,
  contrastRatio,
  EDGE_LIGHTNESS,
  hueOfHex,
  MIN_TEXT_CONTRAST,
  readableInk,
  SEMANTIC_HUE_GUARD,
  separateFromBrand,
  DEFAULT_SURFACE,
  SURFACE_SATURATION,
  TINT_LIGHTNESS,
} from '../brand-palette';

/** The hue of a colour, so 'same colour, darker' can be asserted as such. */
function channels(hex: string): [number, number, number] {
  const at = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
  return [at(1), at(3), at(5)];
}

function hueOf(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (60 * h + 360) % 360;
}

/** Degrees between two hues the short way round the wheel. */
function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

describe('contrastRatio', () => {
  it('agrees with the WCAG reference points', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it("is symmetric — neither colour is 'the background'", () => {
    expect(contrastRatio('#7ED957', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#7ED957'),
      10,
    );
  });

  it('measures the real-world failure this module exists for', () => {
    // A live tenant's primary. As price text on a white card it is 1.76:1 — the
    // number that made this necessary, kept here so the regression has a name.
    expect(contrastRatio('#7ED957', DEFAULT_SURFACE)).toBeLessThan(2);
  });
});

describe('readableInk', () => {
  it('leaves a colour that is already legible completely alone', () => {
    // A near-black navy clears 17:1. Touching it would move a brand for nothing.
    expect(readableInk('#071A2C')).toBe('#071A2C');
  });

  it('darkens a too-light colour until it clears the floor', () => {
    const ink = readableInk('#7ED957');
    expect(ink).not.toBe('#7ED957');
    expect(contrastRatio(ink, DEFAULT_SURFACE)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('keeps the hue — the tenant stays the colour it chose', () => {
    // The whole promise: a darker GREEN, never a different colour.
    expect(hueOf(readableInk('#7ED957'))).toBeCloseTo(hueOf('#7ED957'), 0);
    expect(hueOf(readableInk('#FFD400'))).toBeCloseTo(hueOf('#FFD400'), 0);
  });

  it('moves the colour as little as it can', () => {
    // 'First tone that clears' — so one step lighter must still FAIL. Without
    // this the test would pass on an implementation that always returned black,
    // which is legible and useless.
    const ink = readableInk('#7ED957');
    expect(contrastRatio(ink, DEFAULT_SURFACE)).toBeLessThan(MIN_TEXT_CONTRAST + 1);
  });

  it('clears the floor for colours across the wheel, including the hard ones', () => {
    // Yellow and cyan are the traps: they are perceptually bright at full
    // saturation, so they fail on white by a wide margin.
    for (const seed of ['#FFFF00', '#00FFFF', '#FF00FF', '#7ED957', '#FFFFFF', '#FF8800']) {
      expect(contrastRatio(readableInk(seed), DEFAULT_SURFACE)).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
    }
  });

  it('lightens instead of darkening when the surface is dark', () => {
    // Not speculative: the same rule has to hold the day the app gets a
    // dark mode, and a walk hard-coded to darken would silently invert there.
    const ink = readableInk('#1A1A2E', '#000000');
    expect(contrastRatio(ink, '#000000')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('hands back a garbage seed untouched rather than inventing a colour', () => {
    expect(readableInk('not-a-colour')).toBe('not-a-colour');
  });
});

describe('brandTone', () => {
  const BAND = [TINT_LIGHTNESS, SURFACE_SATURATION] as const;

  it('gives every seed the same visual weight — the thing alpha could not', () => {
    // The bug: `alpha(seed, 0.06)` carries the seed's own lightness through, so
    // a pale lime and a deep navy produce tints of completely different
    // presence. Pinning both against white shows the tones now land together.
    const lime = contrastRatio(brandTone('#7ED957', ...BAND), '#FFFFFF');
    const navy = contrastRatio(brandTone('#071A2C', ...BAND), '#FFFFFF');
    expect(Math.abs(lime - navy)).toBeLessThan(0.15);
  });

  it("keeps each seed's own hue", () => {
    // Within a couple of degrees, not exactly: at 95% lightness every channel
    // is near 255, so rounding to 8 bits moves the COMPUTED hue by a degree or
    // so. That is quantisation, not a hue change — the just-noticeable
    // difference for a hue this pale is far wider.
    for (const seed of ['#7ED957', '#071A2C', '#FF0000']) {
      expect(hueGap(hueOf(brandTone(seed, ...BAND)), hueOf(seed))).toBeLessThan(3);
    }
  });

  it('stays light enough for cards to sit on top of it', () => {
    for (const seed of ['#7ED957', '#071A2C', '#FF0000', '#FFFF00']) {
      // Barely any separation from the page — a band, not a block of colour.
      expect(contrastRatio(brandTone(seed, ...BAND), '#FFFFFF')).toBeLessThan(1.35);
    }
  });

  it('leaves a hueless seed grey rather than inventing a colour', () => {
    // A tenant that picked black or grey did not pick a hue; fabricating one
    // would paint their app a colour they never chose.
    const [r, g, b] = channels(brandTone('#333333', ...BAND));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('pulls a neon seed off the ceiling but leaves a muted one muted', () => {
    // Saturation is clamped, not set: both ends of the band are respected.
    const neon = brandTone('#00FF00', ...BAND);
    const muted = brandTone('#6B8E6B', ...BAND);
    expect(neon).not.toBe(muted);
    expect(contrastRatio(neon, '#FFFFFF')).toBeLessThan(1.35);
  });

  it('makes the edge darker than the fill it borders', () => {
    const fill = brandTone('#7ED957', TINT_LIGHTNESS, SURFACE_SATURATION);
    const edge = brandTone('#7ED957', EDGE_LIGHTNESS, SURFACE_SATURATION);
    expect(contrastRatio(edge, '#FFFFFF')).toBeGreaterThan(contrastRatio(fill, '#FFFFFF'));
  });
});

describe('brandHex', () => {
  it('accepts #RRGGBB and nothing else', () => {
    expect(brandHex('#7ED957')).toBe('#7ED957');
    expect(brandHex('#7ed957')).toBe('#7ed957');
    expect(brandHex('#7ED')).toBeNull();
    expect(brandHex('red')).toBeNull();
    expect(brandHex(null)).toBeNull();
    expect(brandHex(undefined)).toBeNull();
  });
});

describe('separateFromBrand (FUT-810 rule 10)', () => {
  // A red-branded tenant is the whole reason this exists, and it is exactly the
  // tenant nobody has locally: with the danger red sitting on the brand's hue,
  // 'Remover' and 'Adicionar' become the same colour, and the one distinction
  // on the screen that must never be missed is the one that disappears.
  it('moves the danger red off a red brand', () => {
    const moved = separateFromBrand('#d32f2f', '#D92D20');
    expect(moved).not.toBe('#d32f2f');
    const brandHue = hueOfHex('#D92D20');
    expect(brandHue).not.toBeNull();
    expect(hueGap(hueOfHex(moved) ?? 0, brandHue ?? 0)).toBeGreaterThanOrEqual(
      SEMANTIC_HUE_GUARD,
    );
  });

  it('leaves every semantic alone for a brand that collides with none', () => {
    for (const hex of ['#2e7d32', '#ed6c02', '#d32f2f', '#0288d1']) {
      expect(separateFromBrand(hex, '#6366F1')).toBe(hex);
    }
  });

  // `#7ED957` is one real seeded tenant — 102°, twenty-one degrees off the
  // success green. A teal-green brand like `#0E9F6E` sits 37° away and is
  // deliberately NOT moved: the guard is about confusion, not about proximity.
  it('moves the success green off a green brand and keeps it green', () => {
    expect(separateFromBrand('#2e7d32', '#0E9F6E')).toBe('#2e7d32');
    const moved = separateFromBrand('#2e7d32', '#7ED957');
    expect(moved).not.toBe('#2e7d32');
    // Still in the green family — a rotated green is a yellow-green or a teal,
    // never a red. 34° cannot cross into the warm half of the wheel from 122°.
    const hue = hueOfHex(moved) ?? 0;
    expect(hue).toBeGreaterThan(60);
    expect(hue).toBeLessThan(200);
  });

  it('keeps the rotated colour as readable as the one it replaces', () => {
    const before = contrastRatio('#d32f2f', DEFAULT_SURFACE);
    const after = contrastRatio(separateFromBrand('#d32f2f', '#D92D20'), DEFAULT_SURFACE);
    // Lightness and saturation are carried through, so the ratio moves only by
    // what the hue itself contributes to luminance.
    expect(Math.abs(after - before)).toBeLessThan(1.2);
  });

  it('returns the semantic untouched when the tenant has no brand colour', () => {
    expect(separateFromBrand('#d32f2f', null)).toBe('#d32f2f');
    expect(separateFromBrand('#d32f2f', undefined)).toBe('#d32f2f');
  });

  it('treats a greyscale brand as colliding with nothing', () => {
    expect(separateFromBrand('#d32f2f', '#8E8E93')).toBe('#d32f2f');
  });
});
