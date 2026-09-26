import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { muiThemeOptionsFrom, uiThemeFromMui } from '../mui-bridge';
import { createUiTheme } from '../../tokens/theme';

/** Functions cannot be compared; the palette and the numbers can. */
const comparable = (theme: ReturnType<typeof createUiTheme>) => ({
  mode: theme.mode,
  palette: theme.palette,
  spacingUnit: theme.spacingUnit,
  radius: theme.radius,
  fieldHeight: theme.fieldHeight,
  density: theme.density,
  heading: theme.typography.heading,
  zIndex: theme.zIndex,
});

describe('the MUI bridge', () => {
  it.each(['light', 'dark'] as const)('round-trips a %s UiTheme through createTheme', (mode) => {
    const ui = createUiTheme({ mode, palette: { primary: '#00897b' } });
    const back = uiThemeFromMui(createTheme(muiThemeOptionsFrom(ui)));
    expect(comparable(back)).toEqual(comparable(ui));
    expect(back.spacing(3)).toBe(ui.spacing(3));
  });

  it('reads a host theme with its own spacing and radius', () => {
    const host = createTheme({ spacing: 4, shape: { borderRadius: 12 } });
    const read = uiThemeFromMui(host);
    expect(read.spacingUnit).toBe(4);
    expect(read.spacing(2)).toBe(8);
    // The field radius is NOT on the general scale: a rounder `shape` leaves it be.
    expect(read.radius).toEqual({ sm: 6, md: 12, lg: 24, xl: 48, full: 9999, field: 8 });
  });

  it('reads the field height a host sets, and writes it back with the MUI overrides', () => {
    expect(uiThemeFromMui(createTheme()).fieldHeight).toBe(2.5);
    expect(uiThemeFromMui(createTheme({ fieldHeight: 3 })).fieldHeight).toBe(3);

    const options = muiThemeOptionsFrom(createUiTheme({ fieldHeight: 3, fieldRadius: 6 }));
    expect(options.fieldHeight).toBe(3);
    // Both overrides land on MuiOutlinedInput without one erasing the other.
    expect(options.components?.MuiOutlinedInput?.styleOverrides).toMatchObject({
      root: { borderRadius: 6 },
      input: { '&:not(.MuiInputBase-inputMultiline)': { paddingTop: 'calc((3rem - 1.4375em) / 2)' } },
    });
  });

  it('reads the field radius a host sets, and writes it back with the MUI overrides', () => {
    expect(uiThemeFromMui(createTheme({ fieldRadius: 12 })).radius.field).toBe(12);

    const options = muiThemeOptionsFrom(createUiTheme({ fieldRadius: 6 }));
    expect(options.fieldRadius).toBe(6);
    expect(options.components?.MuiOutlinedInput?.styleOverrides?.root).toEqual({ borderRadius: 6 });
    expect(options.components?.MuiButton?.styleOverrides?.root).toEqual({ borderRadius: 6 });
  });

  it('reads the heading scale a host overrides', () => {
    const host = createTheme({
      typography: { headingScale: { h1: { fontSize: '3rem', normalWeight: 900 } } },
    });
    const ui = uiThemeFromMui(host);
    expect(ui.typography.heading.h1.fontSize).toBe(48);
    expect(ui.typography.heading.h1.normalWeight).toBe(900);
    expect(ui.typography.heading.h2.fontSize).toBe(28);
  });

  it('defaults the web font stack when the UiTheme names none', () => {
    const options = muiThemeOptionsFrom(createUiTheme());
    expect(options.typography).toEqual({
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      fontSize: 14,
    });
  });

  it(
    'FUT-2765: normal/unset is a true no-op end to end, not just at the resolver — ' +
      "today has no `fontSize` key at all; MUI's own default is 14, so omitting the key " +
      'and setting it to 14 render identically',
    () => {
      const options = muiThemeOptionsFrom(createUiTheme());
      expect(options.spacing).toBe(8);

      const built = createTheme(options);
      const bare = createTheme(); // MUI's own bare defaults, no `fontSize` option at all
      expect(built.typography.fontSize).toBe(bare.typography.fontSize);
      expect(built.typography.pxToRem(14)).toBe(bare.typography.pxToRem(14));
      expect(built.spacing(3)).toBe(bare.spacing(3));
    },
  );

  it('reads back a normal/unset density as { level: "normal", factor: 1 } from a bare MUI theme', () => {
    expect(uiThemeFromMui(createTheme()).density).toEqual({ level: 'normal', factor: 1 });
  });
});
