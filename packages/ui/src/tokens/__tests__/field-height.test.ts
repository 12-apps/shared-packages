import type { Components, Theme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { mergeMuiComponents } from '../field-height';

/**
 * `mergeMuiComponents` generalises the by-component-name merge `fieldOverrides`
 * already did for exactly two sources (FUT-2765) — density's own geometry
 * overrides (FUT-2766–2768) add a third, fourth, ... source without touching
 * this function again.
 */
describe('mergeMuiComponents', () => {
  it('merges styleOverrides for a component two sources both style, neither erasing the other', () => {
    const a = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const b = { MuiChip: { styleOverrides: { label: { paddingLeft: 12 } } } };
    expect(mergeMuiComponents(a, b)).toEqual({
      MuiChip: { styleOverrides: { root: { height: 32 }, label: { paddingLeft: 12 } } },
    });
  });

  it('keeps a component only ONE source styles', () => {
    const a = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const b = { MuiIconButton: { styleOverrides: { root: { padding: 8 } } } };
    expect(mergeMuiComponents(a, b)).toEqual({
      MuiChip: { styleOverrides: { root: { height: 32 } } },
      MuiIconButton: { styleOverrides: { root: { padding: 8 } } },
    });
  });

  it('a later source wins over an earlier one for the SAME inner key', () => {
    const a = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const b = { MuiChip: { styleOverrides: { root: { height: 24 } } } };
    expect(mergeMuiComponents(a, b)).toEqual({ MuiChip: { styleOverrides: { root: { height: 24 } } } });
  });

  it('generalises past two sources', () => {
    const a = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const b = { MuiChip: { styleOverrides: { label: { paddingLeft: 12 } } } };
    const c = { MuiChip: { styleOverrides: { avatar: { marginLeft: 4 } } } };
    expect(mergeMuiComponents(a, b, c)).toEqual({
      MuiChip: {
        styleOverrides: { root: { height: 32 }, label: { paddingLeft: 12 }, avatar: { marginLeft: 4 } },
      },
    });
  });

  it('no sources at all is the empty override set', () => {
    expect(mergeMuiComponents()).toEqual({});
  });
});

/**
 * FUT-2967 — the merge used to drop `defaultProps` and `variants` entirely: a
 * plain `Object.assign` over `styleOverrides` alone left a host's own
 * `MuiButton.defaultProps`/`variants` on the floor the moment a density (or
 * any other) source also touched `MuiButton`. These pin the three keys the
 * merge must carry, side by side with the wholesale `styleOverrides` rule
 * above, which is unchanged.
 */
describe('mergeMuiComponents — defaultProps, variants and other keys (FUT-2967)', () => {
  it('shallow-merges defaultProps, the later source winning per key', () => {
    const a: Components<Theme> = { MuiButton: { defaultProps: { disableRipple: true, size: 'small' } } };
    const b: Components<Theme> = { MuiButton: { defaultProps: { size: 'large' } } };
    const merged = mergeMuiComponents(a, b);
    expect(merged.MuiButton?.defaultProps).toEqual({ disableRipple: true, size: 'large' });
  });

  it('concatenates variants, earlier source first', () => {
    const soft = { props: { variant: 'text' as const }, style: { opacity: 0.9 } };
    const ghost = { props: { variant: 'outlined' as const }, style: { opacity: 0.5 } };
    const a: Components<Theme> = { MuiButton: { variants: [soft] } };
    const b: Components<Theme> = { MuiButton: { variants: [ghost] } };
    expect(mergeMuiComponents(a, b).MuiButton?.variants).toEqual([soft, ghost]);
  });

  it('a component styled by only one source keeps its defaultProps/variants untouched', () => {
    const soft = { props: { variant: 'text' as const }, style: { opacity: 0.9 } };
    const a: Components<Theme> = { MuiButton: { defaultProps: { disableRipple: true }, variants: [soft] } };
    const b: Components<Theme> = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const merged = mergeMuiComponents(a, b);
    expect(merged.MuiButton?.defaultProps).toEqual({ disableRipple: true });
    expect(merged.MuiButton?.variants).toEqual([soft]);
  });

  it('still replaces a shared styleOverrides slot wholesale alongside a merged defaultProps', () => {
    const a: Components<Theme> = {
      MuiButton: { defaultProps: { disableRipple: true }, styleOverrides: { root: { borderRadius: 8 } } },
    };
    const b: Components<Theme> = {
      MuiButton: { defaultProps: { size: 'large' }, styleOverrides: { root: { borderRadius: 4 } } },
    };
    const merged = mergeMuiComponents(a, b);
    // defaultProps: shallow-merged, later wins per key.
    expect(merged.MuiButton?.defaultProps).toEqual({ disableRipple: true, size: 'large' });
    // styleOverrides: the shared `root` key is REPLACED wholesale by the later source.
    expect(merged.MuiButton?.styleOverrides?.root).toEqual({ borderRadius: 4 });
  });
});
