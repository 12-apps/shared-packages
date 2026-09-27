import { createTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { densityFontSize } from '../density.core';
import { chipDensityOverrides, iconButtonDensityOverrides } from '../density-overrides';

/**
 * FUT-2766 — `IconButton`/`Chip` geometry through the theme's density knob.
 *
 * Every assertion here is at the STYLE-OBJECT level (a style-override callback
 * invoked with a real `{ theme }`), proving the numbers `rem(theme, px)`
 * produces; the computed-PIXEL, real-browser proof (jsdom does not fully
 * resolve `rem` the way a browser does) is
 * `density-overrides.test.stories.tsx`.
 */

interface ChipOwnerStateArg {
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

type StyleFn = (props: { theme: Theme; ownerState?: ChipOwnerStateArg }) => Record<string, unknown>;

function slot(
  overrides: ReturnType<typeof iconButtonDensityOverrides> | ReturnType<typeof chipDensityOverrides>,
  component: 'MuiIconButton' | 'MuiChip',
  key: string,
  theme: Theme,
  ownerState?: ChipOwnerStateArg,
): Record<string, unknown> {
  const fn = (overrides[component]?.styleOverrides as Record<string, StyleFn> | undefined)?.[key];
  if (typeof fn !== 'function') throw new Error(`${component}.${key} is not a style-override function`);
  return fn({ theme, ownerState });
}

describe('iconButtonDensityOverrides', () => {
  it('writes root/sizeSmall/sizeLarge padding as rem(theme, px) — the literals IconButton.js hard-codes', () => {
    const theme = createTheme();
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: theme.typography.pxToRem(8) });
    expect(slot(overrides, 'MuiIconButton', 'sizeSmall', theme)).toEqual({ padding: theme.typography.pxToRem(5) });
    expect(slot(overrides, 'MuiIconButton', 'sizeLarge', theme)).toEqual({ padding: theme.typography.pxToRem(12) });
  });

  it('is a true no-op at the default theme: fontSize is 14, so padding is 0.5rem — 8px at the 16px root', () => {
    const theme = createTheme();
    expect(theme.typography.fontSize).toBe(14);
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: '0.5rem' });
    expect(slot(overrides, 'MuiIconButton', 'sizeSmall', theme)).toEqual({ padding: '0.3125rem' });
    expect(slot(overrides, 'MuiIconButton', 'sizeLarge', theme)).toEqual({ padding: '0.75rem' });
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: '0.45rem' }); // 8 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references — required for the two paths to compare equal', () => {
    const a = iconButtonDensityOverrides();
    const b = iconButtonDensityOverrides();
    expect(a.MuiIconButton?.styleOverrides?.root).toBe(b.MuiIconButton?.styleOverrides?.root);
    expect(a).toEqual(b);
  });
});

describe('chipDensityOverrides', () => {
  it('writes root/sizeSmall height and label/labelSmall padding as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: theme.typography.pxToRem(32) });
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: theme.typography.pxToRem(24) });
    expect(slot(overrides, 'MuiChip', 'label', theme)).toEqual({
      paddingLeft: theme.typography.pxToRem(12),
      paddingRight: theme.typography.pxToRem(12),
    });
    expect(slot(overrides, 'MuiChip', 'labelSmall', theme)).toEqual({
      paddingLeft: theme.typography.pxToRem(8),
      paddingRight: theme.typography.pxToRem(8),
    });
  });

  it('is a true no-op at the default theme: fontSize is 14, so height/padding compute to the literals they replace', () => {
    const theme = createTheme();
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: '2rem' }); // 32px / 16
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: '1.5rem' }); // 24px / 16
    expect(slot(overrides, 'MuiChip', 'label', theme)).toEqual({ paddingLeft: '0.75rem', paddingRight: '0.75rem' }); // 12px / 16
    expect(slot(overrides, 'MuiChip', 'labelSmall', theme)).toEqual({ paddingLeft: '0.5rem', paddingRight: '0.5rem' }); // 8px / 16
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: '1.8rem' }); // 32 * 0.9 / 16
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: '1.35rem' }); // 24 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references — required for the two paths to compare equal', () => {
    const a = chipDensityOverrides();
    const b = chipDensityOverrides();
    expect(a.MuiChip?.styleOverrides?.label).toBe(b.MuiChip?.styleOverrides?.label);
    expect(a).toEqual(b);
  });

  /**
   * FUT-2766 follow-up (adversarial review) — the OUTLINED variant's own
   * label padding (`11`/`7`, ChipLabel's baked-in `variants`, `Chip.js`) is a
   * DIFFERENT number from filled's `12`/`8` and must not be clobbered by the
   * `label`/`labelSmall` overrides above, which apply unconditionally. The
   * fix lives on the ROOT slot (see the module doc comment for why a
   * `components.MuiChip.variants` entry cannot reach the label slot at all).
   */
  describe('the outlined variant keeps its OWN label padding (11/7), not filled its 12/8', () => {
    it('root carries a nested .MuiChip-label rule for outlined, at both sizes, as rem(theme, px)', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })).toEqual({
        height: theme.typography.pxToRem(32),
        '& .MuiChip-label': {
          paddingLeft: theme.typography.pxToRem(11),
          paddingRight: theme.typography.pxToRem(11),
        },
      });
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined', size: 'small' })).toEqual({
        height: theme.typography.pxToRem(32),
        '& .MuiChip-label': {
          paddingLeft: theme.typography.pxToRem(7),
          paddingRight: theme.typography.pxToRem(7),
        },
      });
    });

    it('is a true no-op at the default theme: 11px/7px, the exact literals ChipLabel bakes in for outlined', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })['& .MuiChip-label']).toEqual({
        paddingLeft: '0.6875rem', // 11px / 16
        paddingRight: '0.6875rem',
      });
      expect(
        slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined', size: 'small' })['& .MuiChip-label'],
      ).toEqual({
        paddingLeft: '0.4375rem', // 7px / 16
        paddingRight: '0.4375rem',
      });
    });

    it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
      const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })['& .MuiChip-label']).toEqual({
        paddingLeft: '0.61875rem', // 11 * 0.9 / 16
        paddingRight: '0.61875rem',
      });
    });

    it('a FILLED chip (no variant, or variant: "filled") gets no nested label rule at all — root is just the height', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: theme.typography.pxToRem(32) });
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'filled' })).toEqual({
        height: theme.typography.pxToRem(32),
      });
    });
  });
});
