import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { augmentColor, contrastText, createUiTheme, DEFAULT_BRAND, px, type UiThemeMode } from '../theme';

/**
 * The theme's whole purpose is to hand the native renderer the palette MUI
 * hands the web, so it is asserted against MUI's `createTheme` and not against
 * a table of hex values this file would then be the only owner of.
 */
const MODES: UiThemeMode[] = ['light', 'dark'];

describe('createUiTheme derives the palette MUI derives', () => {
  describe.each(MODES)('%s mode', (mode) => {
    const ui = createUiTheme({ mode });
    const mui = createTheme({
      palette: {
        mode,
        primary: { main: DEFAULT_BRAND[mode].primary },
        secondary: { main: DEFAULT_BRAND[mode].secondary },
      },
    }).palette;

    it('brand slots, with MUI shades derived from the seed', () => {
      expect(ui.palette.primary).toEqual({
        main: mui.primary.main,
        light: mui.primary.light,
        dark: mui.primary.dark,
        contrastText: mui.primary.contrastText,
      });
      expect(ui.palette.secondary).toEqual({
        main: mui.secondary.main,
        light: mui.secondary.light,
        dark: mui.secondary.dark,
        contrastText: mui.secondary.contrastText,
      });
    });

    it('semantic slots, including danger as MUI error', () => {
      const pick = (slot: { main: string; light: string; dark: string; contrastText: string }) => ({
        main: slot.main,
        light: slot.light,
        dark: slot.dark,
        contrastText: slot.contrastText,
      });
      expect(ui.palette.success).toEqual(pick(mui.success));
      expect(ui.palette.warning).toEqual(pick(mui.warning));
      expect(ui.palette.info).toEqual(pick(mui.info));
      expect(ui.palette.danger).toEqual(pick(mui.error));
    });

    it('text, surfaces, divider and action tints', () => {
      expect(ui.palette.text).toEqual({
        primary: mui.text.primary,
        secondary: mui.text.secondary,
        disabled: mui.text.disabled,
      });
      expect(ui.palette.background).toEqual({
        default: mui.background.default,
        paper: mui.background.paper,
      });
      expect(ui.palette.divider).toBe(mui.divider);
      expect(ui.palette.action).toEqual({
        active: mui.action.active,
        hover: mui.action.hover,
        selected: mui.action.selected,
        disabled: mui.action.disabled,
        disabledBackground: mui.action.disabledBackground,
        focus: mui.action.focus,
      });
    });

    it('the grey ramp', () => {
      for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
        expect(ui.palette.grey[step]).toBe(mui.grey[step]);
      }
    });
  });

  it.each(['#6366F1', '#00897b', '#ffeb3b', '#1a1a1a', 'rgb(10, 120, 200)'])(
    'augmentColor(%s) is MUI augmentColor',
    (main) => {
      const expected = createTheme().palette.augmentColor({ color: { main } });
      expect(augmentColor(main)).toEqual({
        main: expected.main,
        light: expected.light,
        dark: expected.dark,
        contrastText: expected.contrastText,
      });
    },
  );

  it('keeps the shades a seed spells out', () => {
    expect(augmentColor({ main: '#111111', light: '#222222', dark: '#000000', contrastText: '#fff' })).toEqual({
      main: '#111111',
      light: '#222222',
      dark: '#000000',
      contrastText: '#fff',
    });
  });

  it('flips contrast text at MUI threshold', () => {
    expect(contrastText('#fff')).toBe('rgba(0, 0, 0, 0.87)');
    expect(contrastText('#000')).toBe('#fff');
    expect(contrastText('#6366F1')).toBe(createTheme().palette.getContrastText('#6366F1'));
  });

  it('spacing and radius are MUI defaults', () => {
    const built = createUiTheme();
    expect(built.spacing(1)).toBe(8);
    expect(built.spacing(2.5)).toBe(20);
    expect(built.radius.md).toBe(createTheme().shape.borderRadius);
    expect(built.radius.lg).toBe(8);
  });

  it('px() writes the rem string the web components write', () => {
    expect(px(16)).toBe('1rem');
    expect(px(12)).toBe('0.75rem');
    expect(px(18)).toBe('1.125rem');
  });

  it('honours a host seed and an overridden surface', () => {
    const ui = createUiTheme({
      mode: 'dark',
      palette: { primary: '#00897b', background: { default: '#0b0b0b' } },
    });
    expect(ui.palette.primary.main).toBe('#00897b');
    expect(ui.palette.background.default).toBe('#0b0b0b');
    expect(ui.palette.background.paper).toBe('#121212');
  });
});
