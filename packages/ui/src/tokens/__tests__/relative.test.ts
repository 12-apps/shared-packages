import { createTheme } from '@mui/material/styles/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/**
 * The root font is read through `getComputedStyle(<html>)`. The tests answer
 * that read instead of restyling the real `<html>`, which every other test in
 * the run shares.
 */
const realComputedStyle = globalThis.getComputedStyle.bind(globalThis);
function rootAt(px: number): void {
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) =>
    element === document.documentElement
      ? ({ fontSize: `${px}px` } as CSSStyleDeclaration)
      : realComputedStyle(element, pseudo),
  );
}

describe('remPx', () => {
  const theme = createTheme();

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetRootFontCache();
  });

  it('is the px rem() renders at under the default 16px root', () => {
    rootAt(16);
    expect(remPx(theme, 52)).toBe(52);
  });

  it('follows a reader who raised the browser root font', () => {
    rootAt(20);
    expect(remPx(theme, 52)).toBe(65);
  });

  it('re-measures after the window resizes (a viewport-relative root)', async () => {
    rootAt(16);
    expect(remPx(theme, 10)).toBe(10);
    rootAt(20);
    expect(remPx(theme, 10)).toBe(10);
    globalThis.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(remPx(theme, 10)).toBe(12.5));
  });

  it("re-measures when <html>'s style or class changes (a host's density toggle)", async () => {
    const onRootChange: MutationCallback[] = [];
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          onRootChange.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
      },
    );
    // A fresh module, so the watcher is installed through the stub above
    // rather than by whichever test measured first.
    vi.resetModules();
    const fresh = await import('../relative');
    rootAt(16);
    expect(fresh.remPx(theme, 10)).toBe(10);
    rootAt(20);
    expect(fresh.remPx(theme, 10)).toBe(10);
    expect(onRootChange).toHaveLength(1);
    onRootChange[0]?.([], {} as MutationObserver);
    expect(fresh.remPx(theme, 10)).toBe(12.5);
  });

  it('follows a theme with a smaller type base', () => {
    rootAt(16);
    const compact = createTheme({ typography: { fontSize: 12 } });
    expect(remPx(compact, 14)).toBeCloseTo(12, 10);
  });
});
