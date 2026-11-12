/**
 * THE GRADIENT ALERT HOLDS 4.5:1 ACROSS THE WHOLE SWEEP (FUT-4516, option B).
 *
 * Measured in the prototype by composited WCAG luminance: the variant's title
 * and description failed AA at rest in both modes (white on the light info end
 * 2.41:1; dark ink on dark mode's dark end 4.26:1), the 0.2 white shimmer took
 * both lower, and the pointer layer closed the gap further.
 *
 * jsdom resolves neither `:hover` nor `color-mix()`, so this holds the claim as
 * ARITHMETIC over what the sheet emits: the two stops and the ink are read from
 * `alertVariantStyles`, the surface is composited the way the browser paints it
 * (stop at its alpha over the paper, then the pointer tint, then the shimmer on
 * top, which sits above the inset layer), and the ink is stepped the way
 * `pointerInkStyles` steps it. The title is at opacity 1 and the description at
 * its 0.9, at both endpoints, with and without the shimmer, at rest, hover and
 * press.
 */
import { describe, expect, it } from 'vitest';

import { createTheme } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { blend, decomposeColor, getContrastRatio } from '../../../../tokens/color';
import { createUiTheme } from '../../../../tokens/theme';
import { inkAbsolute, pointerInkStyles } from '../Alert.ink';
import { ACTIVE, DESCRIPTION, GRADIENT, HOVER, POINTER_INK_STEP } from '../Alert.metrics';
import { alertVariantStyles, getColorFromTheme } from '../Alert.styles';

const MIN_CONTRAST = 4.5;
const SEVERITIES = ['info', 'success', 'warning', 'danger', 'primary', 'secondary'] as const;
const MODES = ['light', 'dark'] as const;
const STATES = ['rest', 'hover', 'press'] as const;
type Mode = (typeof MODES)[number];
type State = (typeof STATES)[number];
const TINT: Record<State, number> = { rest: 0, hover: HOVER.tintAlpha, press: ACTIVE.tintAlpha };

const themeOf = (mode: Mode, palette?: Record<string, unknown>) =>
  createTheme({ ...muiThemeOptionsFrom(createUiTheme({ mode })), ...(palette ? { palette: { mode, ...palette } } : {}) });

/** What the sheet emits for a gradient: the two stops (rgb, as painted at `stopAlpha`) and the ink. */
function emitted(theme: ReturnType<typeof themeOf>, severity: string) {
  const styles = alertVariantStyles(theme, 'gradient', getColorFromTheme(theme, severity)) as Record<string, unknown>;
  const stops = String(styles.background).match(/rgba\([^)]*\)/gu) ?? [];
  return {
    stops: stops.map((s) => `rgb(${decomposeColor(s).values.slice(0, 3).join(', ')})`),
    stopAlpha: stops.map((s) => decomposeColor(s).values[3]),
    ink: String(styles.color),
    icon: String((styles['.MuiAlert-icon'] as { color: string }).color),
  };
}

/** The worst title / description contrast over one stop, in one state, with or without the shimmer. */
function worstAt(theme: ReturnType<typeof themeOf>, stop: string, ink: string, state: State, shimmer: boolean): number {
  // The mode's side, which is what `inkAbsolute` answers: measured here whatever it answers, so a
  // gradient that does not step fails on CONTRAST and not on a throw.
  const side = theme.palette.mode === 'dark' ? 'white' : 'black';
  const absolute = side === 'black' ? '#000000' : '#ffffff';
  const base = blend(theme.palette.background.paper, stop, GRADIENT.stopAlpha);
  const tinted = blend(base, absolute, TINT[state]);
  const surface = shimmer ? blend(tinted, '#ffffff', GRADIENT.shimmerAlpha) : tinted;
  const step = state === 'rest' ? 0 : POINTER_INK_STEP[state][side];
  const rgb = decomposeColor(ink).values.slice(0, 3).join(', ');
  const alpha0 = decomposeColor(ink).values[3] ?? 1;
  // color-mix() in srgb interpolates the alpha too: toward an opaque absolute.
  const inkRgb = step === 0 ? `rgb(${rgb})` : blend(`rgb(${rgb})`, absolute, step);
  const inkAlpha = alpha0 * (1 - step) + step;
  return Math.min(
    ...[1, DESCRIPTION.opacity].map((opacity) => getContrastRatio(blend(surface, inkRgb, inkAlpha * opacity), surface)),
  );
}

describe.each(MODES)('Given a %s-mode gradient Alert on the default palette', (mode) => {
  const theme = themeOf(mode);

  describe.each(SEVERITIES)('and the %s hue', (severity) => {
    const { stops, ink } = emitted(theme, severity);

    it.each(STATES)('holds the title and the description at 4.5:1 at %s, at both ends, with and without the shimmer', (state) => {
      const rows = stops.flatMap((stop) =>
        [false, true].map((shimmer) => ({ stop, shimmer, ratio: worstAt(theme, stop, ink, state, shimmer) })),
      );
      expect(rows.filter((row) => row.ratio < MIN_CONTRAST)).toEqual([]);
    });
  });

  it('takes the ink side from the mode: dark text in light mode, white in dark', () => {
    const { ink, icon } = emitted(theme, 'info');
    expect(decomposeColor(ink).values.slice(0, 3)).toEqual(mode === 'light' ? [0, 0, 0] : [255, 255, 255]);
    // The icon follows the ink.
    expect(icon).toBe(ink);
  });

  it('steps its ink toward the side it is on, like every other variant', () => {
    expect(inkAbsolute(theme, 'gradient')).toBe(mode === 'light' ? 'black' : 'white');
    expect(Object.keys(pointerInkStyles(theme, 'gradient').hover)).not.toEqual([]);
  });

  it('keeps the angle and the stop alpha', () => {
    const styles = alertVariantStyles(theme, 'gradient', getColorFromTheme(theme, 'info')) as Record<string, string>;
    expect(styles.background).toContain(`linear-gradient(${GRADIENT.angleDeg}deg`);
    expect(emitted(theme, 'info').stopAlpha).toEqual([GRADIENT.stopAlpha, GRADIENT.stopAlpha]);
  });
});

describe.each(MODES)('Given a %s-mode theme with a host hue that is not MUI\'s', (mode) => {
  // A teal and a pale yellow: nothing like the defaults, the second as bad a
  // case as there is for a dark ink's own end (light) and a white ink (dark).
  const HOSTS = [
    { main: '#00bfa5', light: '#5df2d6', dark: '#008e76', contrastText: '#000000' },
    { main: '#fff176', light: '#ffff8d', dark: '#cabf45', contrastText: '#000000' },
    { main: '#7b1fa2', light: '#ae52d4', dark: '#4a0072', contrastText: '#ffffff' },
  ];
  it.each(HOSTS)('derives a passing sweep for $main from the theme, at every state', (hue) => {
    const theme = themeOf(mode, { info: hue });
    const { stops, ink } = emitted(theme, 'info');
    for (const state of STATES) {
      for (const stop of stops) {
        for (const shimmer of [false, true]) {
          expect(worstAt(theme, stop, ink, state, shimmer)).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it('is not a table: two hosts get two different sweeps', () => {
    const a = emitted(themeOf(mode, { info: HOSTS[0] }), 'info').stops;
    const b = emitted(themeOf(mode, { info: HOSTS[2] }), 'info').stops;
    expect(a).not.toEqual(b);
  });
});
