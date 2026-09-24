import { createTheme } from '@mui/material/styles/index.js';
import { afterEach, describe, expect, it } from 'vitest';

import { rem, remPx, rems, resetRootFontCache, sxRem } from '../relative';

/**
 * The whole promise of `rem()` is two sentences, so the tests are those two:
 * at MUI's defaults it writes exactly the rem a hand-typed literal would (so
 * converting one changes nothing on screen), and a theme that moves its type
 * scale moves every size written through it (so a density mode has one knob).
 */
describe('rem', () => {
  const theme = createTheme();

  it('equals px/16 rem at MUI defaults — the literal it replaces', () => {
    expect(rem(theme, 16)).toBe('1rem');
    expect(rem(theme, 14)).toBe('0.875rem');
    expect(rem(theme, 40)).toBe('2.5rem');
    expect(rem(theme, 13.5)).toBe('0.84375rem');
  });

  it('keeps a negative offset negative', () => {
    expect(rem(theme, -8)).toBe('-0.5rem');
  });

  it('scales with typography.fontSize — the density knob', () => {
    const compact = createTheme({ typography: { fontSize: 12 } });
    // MUI's pxToRem multiplies by fontSize / 14.
    expect(Number.parseFloat(rem(compact, 14))).toBeCloseTo(0.75, 10);
  });

  it('reads htmlFontSize as a DECLARATION of the root, not a scale', () => {
    // A host whose root is 10px says so with htmlFontSize: 10, and 20px of
    // design is then 2rem — the same 20 rendered pixels.
    const tenPxRoot = createTheme({ typography: { htmlFontSize: 10 } });
    expect(rem(tenPxRoot, 20)).toBe('2rem');
  });

  it('sxRem hands sx a theme callback with the same value', () => {
    expect(sxRem(24)(theme)).toBe(rem(theme, 24));
  });

  it('rems writes a length list, keeping 0 unitless', () => {
    expect(rems(theme, 0, 8, 32)).toBe('0 0.5rem 2rem');
  });
});

describe('remPx', () => {
  const theme = createTheme();

  afterEach(() => {
    document.documentElement.style.fontSize = '';
    resetRootFontCache();
  });

  it('is the px rem() renders at under the default 16px root', () => {
    document.documentElement.style.fontSize = '16px';
    resetRootFontCache();
    expect(remPx(theme, 52)).toBe(52);
  });

  it('follows a reader who raised the browser root font', () => {
    document.documentElement.style.fontSize = '20px';
    resetRootFontCache();
    expect(remPx(theme, 52)).toBe(65);
  });

  it('re-measures when the root font changes at runtime', async () => {
    document.documentElement.style.fontSize = '16px';
    resetRootFontCache();
    expect(remPx(theme, 10)).toBe(10);
    document.documentElement.style.fontSize = '20px';
    // The MutationObserver on <html style> drops the cache asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remPx(theme, 10)).toBe(12.5);
  });

  it('follows a theme with a smaller type base', () => {
    document.documentElement.style.fontSize = '16px';
    resetRootFontCache();
    const compact = createTheme({ typography: { fontSize: 12 } });
    expect(remPx(compact, 14)).toBeCloseTo(12, 10);
  });
});
