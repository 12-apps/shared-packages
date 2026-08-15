import { describe, expect, it } from 'vitest';

import { accessibleAccent, contrastRatio } from '../lib/report-surface';

/**
 * `visual-pass.md` §Colour: body text at 4.5:1 or better.
 *
 * The shipped accent lands at **4.47:1** on white — 0.03 short — so every
 * accent-coloured label in the reports area failed the rule by a hair,
 * including the report-list card title, which is the primary click target on
 * the landing screen.
 *
 * The fix derives the text shade from the live theme rather than hardcoding
 * one, because the accent is not fixed: the origin host layers a tenant's brand onto
 * this same token. These cases are what says that generalisation is real — a
 * literal hex would pass the first case here and fail the branded ones.
 */

const WHITE = '#ffffff';
const SHIPPED_ACCENT = '#6366F1';

describe('contrastRatio', () => {
  it('agrees with the known values this rule was measured against', () => {
    // Both anchors from the audit: the accent is 4.47:1 on white, and black on
    // white is the maximum 21:1. If this helper drifts, every case below is
    // measuring something else.
    expect(contrastRatio(SHIPPED_ACCENT, WHITE)).toBeCloseTo(4.47, 1);
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 0);
  });

  it('is symmetric, since contrast has no foreground/background order', () => {
    expect(contrastRatio(SHIPPED_ACCENT, WHITE)).toBeCloseTo(
      contrastRatio(WHITE, SHIPPED_ACCENT),
      5,
    );
  });
});

describe('accessibleAccent', () => {
  it('lifts the shipped accent over the bar it was just under', () => {
    const derived = accessibleAccent(SHIPPED_ACCENT, WHITE);

    expect(contrastRatio(SHIPPED_ACCENT, WHITE)).toBeLessThan(4.5);
    expect(contrastRatio(derived, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['a light tenant brand', '#F5A623'],
    ['a mid tenant brand', '#00A3FF'],
    ['a green tenant brand', '#2E7D32'],
  ])('clears the bar for %s too', (_name, brand) => {
    expect(contrastRatio(accessibleAccent(brand, WHITE), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('returns a brand that already passes untouched', () => {
    // Darkening a colour that is already legible would change the product's
    // accent for no reason, so the first shade checked is the brand itself.
    const alreadyDark = '#1A1A6E';
    expect(contrastRatio(alreadyDark, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(accessibleAccent(alreadyDark, WHITE)).toBe(alreadyDark);
  });

  it('accepts the rgb() form a computed style hands back', () => {
    expect(contrastRatio(accessibleAccent('rgb(99, 102, 241)', WHITE), WHITE)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('leaves an unparseable colour alone rather than guessing', () => {
    // A theme can carry `currentColor`, a gradient, or a CSS variable. Silently
    // returning black would be a worse answer than not changing it.
    expect(accessibleAccent('var(--brand)', WHITE)).toBe('var(--brand)');
  });

  it('reads SHORT hex, which is what the default theme actually hands it', () => {
    // MUI's `background.paper` is `#fff`. A six-digit-only parser made this
    // read as "no contrast", which walked the accent all the way to black on
    // every reports screen — and every case above missed it, because they all
    // pass `#ffffff`. Caught by looking at a browser; pinned here.
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);

    const derived = accessibleAccent(SHIPPED_ACCENT, '#fff');
    expect(contrastRatio(derived, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(derived).not.toBe('rgb(0, 0, 0)');
  });

  it('leaves the accent alone when the BACKGROUND is unreadable', () => {
    // Fail safe, not black: darkening against an unknown background repaints
    // the area rather than closing a 0.03 gap.
    expect(accessibleAccent(SHIPPED_ACCENT, 'var(--surface)')).toBe(SHIPPED_ACCENT);
  });
});
