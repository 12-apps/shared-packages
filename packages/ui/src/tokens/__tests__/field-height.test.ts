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
