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
    expect(read.radius).toEqual({ sm: 6, md: 12, lg: 24, xl: 48, full: 9999 });
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
    expect(options.typography).toEqual({ fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif' });
  });
});
