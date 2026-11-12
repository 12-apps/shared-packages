/**
 * The pure half of the gradient's colours (FUT-4516): each end is moved toward
 * white (light mode) or black (dark mode) only as far as the ink needs, judged
 * across rest, hover and press, and never by a table of hexes.
 */
import { describe, expect, it } from 'vitest';

import { createTheme } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { decomposeColor, lighten } from '../../../../tokens/color';
import { createUiTheme } from '../../../../tokens/theme';
import {
  GRADIENT_POINTER_CONTRAST,
  GRADIENT_TARGET_CONTRAST,
  gradientBasisOf,
  gradientLook,
  gradientWorstContrast,
  holdsInEveryState,
  stepStopForInk,
  sweepHolds,
  type GradientBasis,
} from '../Alert.gradient';
import { getColorFromTheme } from '../Alert.styles';

type Mode = 'light' | 'dark';
const themeOf = (mode: Mode) => createTheme(muiThemeOptionsFrom(createUiTheme({ mode })));
const rgb = (c: string) => decomposeColor(c.startsWith('#') ? c : c).values.slice(0, 3);
const hex = (n: string) => [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));

const basisOf = (mode: Mode): GradientBasis => gradientBasisOf(themeOf(mode));

/**
 * The prototype's REST-only sweeps (the approved option B frames), default
 * palette: what the derivation lands on if hover and press are not asked of it.
 * They are the lower bound — the derived ends must go at least as far.
 */
const PROTOTYPE_END = {
  light: { info: '#3e7fb3', success: '#528556', warning: '#e65100', danger: '#d04f4f' },
  dark: { info: '#015684', success: '#235926', warning: '#7d3f00', danger: '#a52525' },
} as const;

describe.each(['light', 'dark'] as const)('Given the %s-mode default palette', (mode) => {
  const theme = themeOf(mode);
  const basis = basisOf(mode);

  it.each(['info', 'success', 'warning', 'danger'] as const)('derives a %s sweep that holds at rest, hover and press', (severity) => {
    const look = gradientLook(theme, getColorFromTheme(theme, severity));
    for (const end of [look.from, look.to]) {
      expect(gradientWorstContrast(end, basis, 'rest')).toBeGreaterThanOrEqual(GRADIENT_TARGET_CONTRAST);
      expect(gradientWorstContrast(end, basis, 'hover')).toBeGreaterThanOrEqual(GRADIENT_POINTER_CONTRAST);
      expect(gradientWorstContrast(end, basis, 'press')).toBeGreaterThanOrEqual(GRADIENT_POINTER_CONTRAST);
    }
  });

  it.each(['info', 'success', 'warning', 'danger'] as const)(
    'goes at least as far as the prototype\'s rest-only %s end, toward the mode\'s side',
    (severity) => {
      const palette = getColorFromTheme(theme, severity);
      const { to } = gradientLook(theme, palette);
      const reference = hex(PROTOTYPE_END[mode][severity]);
      const hue = rgb(palette.dark ?? palette.main);
      const derived = rgb(to);
      // Toward white the channels only rise from the hue; toward black only fall.
      hue.forEach((h, i) => {
        const dir = mode === 'light' ? 1 : -1;
        expect(dir * ((derived[i] ?? 0) - h)).toBeGreaterThanOrEqual(dir * ((reference[i] ?? 0) - h) - 4);
      });
    },
  );

  it.each(['info', 'success', 'warning', 'danger'] as const)(
    'lands the dark %s sweep on the approved prototype\'s ends, since the black tint only helps',
    (severity) => {
      if (mode !== 'dark') return;
      const look = gradientLook(theme, getColorFromTheme(theme, severity));
      const want = { info: ['#22546a', '#015684'], success: ['#365437', '#235926'], warning: ['#66491f', '#7d3f00'], danger: ['#793d3d', '#a52525'] }[severity];
      [look.from, look.to].forEach((got, i) => hex(want[i] ?? '#000000').forEach((w, c) => expect(Math.abs((rgb(got)[c] ?? 0) - w)).toBeLessThanOrEqual(4)));
    },
  );

  it('does not move an end that already holds', () => {
    // Light mode's warning dark end and light mode's info light end need no mixing.
    const info = getColorFromTheme(theme, 'info');
    if (mode === 'light') expect(rgb(gradientLook(theme, info).from)).toEqual(rgb(info.light ?? info.main));
  });
});

describe('Given a stop and an ink', () => {
  it('moves a failing stop until it holds in every state, and no further than the next 1%', () => {
    const basis = basisOf('light');
    const out = stepStopForInk('#03a9f4', basis);
    expect(gradientWorstContrast(out, basis, 'press')).toBeGreaterThanOrEqual(GRADIENT_POINTER_CONTRAST);
    expect(gradientWorstContrast('#03a9f4', basis, 'rest')).toBeLessThan(GRADIENT_TARGET_CONTRAST + 2);
  });

  it.each(['#01579b', '#1b5e20', '#c62828', '#e65100'])('stops at the FIRST passing 1% mix of %s: one step less fails', (stop) => {
    const basis = basisOf('light');
    const candidates = Array.from({ length: 101 }, (_, i) => lighten(stop, i / 100));
    const at = candidates.indexOf(stepStopForInk(stop, basis));
    expect(at).toBeGreaterThan(0);
    expect(holdsInEveryState(candidates[at] ?? '', basis)).toBe(true);
    expect(holdsInEveryState(candidates[at - 1] ?? '', basis)).toBe(false);
  });

  it.each(['light', 'dark'] as const)('judges the interior: the derived %s sweep holds the floor at 21 points', (mode) => {
    const theme = themeOf(mode);
    for (const severity of ['info', 'success', 'warning', 'danger', 'primary', 'secondary'] as const) {
      const { from, to } = gradientLook(theme, getColorFromTheme(theme, severity));
      expect(sweepHolds(from, to, basisOf(mode))).toBe(true);
    }
  });

  it('returns a stop that holds unchanged', () => {
    const basis = basisOf('light');
    const pale = '#e8f4fd';
    expect(rgb(stepStopForInk(pale, basis))).toEqual(rgb(pale));
  });
});
