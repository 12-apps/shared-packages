import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { getContrastRatio } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';
import {
  BUTTON_PROGRESS_MIN_CONTRAST,
  BUTTON_PROGRESS_MIN_SEPARATION,
  buttonProgressColors,
  drawnInk,
} from './Button.progress.colors';

/** The label sits on the track AND on the fill: both must read at AA. */
function contrasts(main: string, ink: string): { track: number; fill: number } {
  const { track, fill } = buttonProgressColors(main, ink);
  return { track: getContrastRatio(ink, track), fill: getContrastRatio(ink, fill) };
}

describe('Button progress colours keep the label readable (4.5:1)', () => {
  it('on the default theme primary', () => {
    const { main, contrastText } = createTheme().palette.primary;
    const ratio = contrasts(main, contrastText);
    expect(ratio.track).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(ratio.fill).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
  });

  it("on this package's own default theme primary", () => {
    const { main, contrastText } = createUiTheme().palette.primary;
    const ratio = contrasts(main, contrastText);
    expect(ratio.track).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(ratio.fill).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
  });

  it('on a light brand primary, whose ink is dark', () => {
    const { main, contrastText } = createTheme({ palette: { primary: { main: '#ffd54f' } } }).palette.primary;
    const ratio = contrasts(main, contrastText);
    expect(ratio.track).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(ratio.fill).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
  });

  it('on a mid brand colour with light ink, which needs shading', () => {
    const ratio = contrasts('#e57373', '#fff');
    expect(ratio.track).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(ratio.fill).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
  });

  it('keeps the fill apart from the track, so the bar is visible', () => {
    const { main, contrastText } = createTheme().palette.primary;
    const { track, fill } = buttonProgressColors(main, contrastText);
    expect(fill).not.toBe(track);
    expect(getContrastRatio(track, fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_SEPARATION);
  });
});

/** Black, near-black, white, near-white, a pale yellow, and the MUI default. */
const MAINS = ['#000', '#111', '#1a1a2e', '#fff', '#f5f5f5', '#ffeb3b', createTheme().palette.primary.main];

/** `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` as [r, g, b, a] — parsed here, not by the code under test. */
function channels(color: string): [number, number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  }
  const parts = (color.match(/[\d.]+/g) ?? []).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/**
 * The label as the eye sees it, blended BY HAND: each channel is
 * `surface × (1 − a) + ink × a`, rounded — independent of the module's own
 * `drawnInk`, so the test cannot agree with a bug in it.
 */
function drawn(ink: string, surface: string): string {
  const [ir, ig, ib, a] = channels(ink);
  const [sr, sg, sb] = channels(surface);
  const mix = (s: number, i: number) => Math.round(s * (1 - a) + i * a);
  return `rgb(${mix(sr, ir)}, ${mix(sg, ig)}, ${mix(sb, ib)})`;
}

describe('the label as drawn', () => {
  it('flattens MUI dark ink over white and black to the known greys', () => {
    expect(drawn('rgba(0, 0, 0, 0.87)', '#fff')).toBe('rgb(33, 33, 33)');
    expect(drawnInk('rgba(0, 0, 0, 0.87)', '#fff')).toBe('rgb(33, 33, 33)');
    expect(drawnInk('rgba(0, 0, 0, 0.87)', '#ffeb3b')).toBe(drawn('rgba(0, 0, 0, 0.87)', '#ffeb3b'));
    expect(drawnInk('#fff', '#000')).toBe('rgb(255, 255, 255)');
  });
});

describe('Button progress colours for ANY brand, extremes included', () => {
  it.each(MAINS)('%s: label on track and on fill ≥ 4.5, fill apart from track ≥ 1.3', (main) => {
    const ink = createTheme({ palette: { primary: { main } } }).palette.primary.contrastText;
    const { track, fill } = buttonProgressColors(main, ink);
    expect(getContrastRatio(ink, track)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(getContrastRatio(ink, fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(getContrastRatio(track, fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_SEPARATION);
  });

  it.each(MAINS)('%s: the label AS DRAWN (alpha-blended) reads ≥ 4.5 on the track and on the fill', (main) => {
    const ink = createTheme({ palette: { primary: { main } } }).palette.primary.contrastText;
    const { track, fill } = buttonProgressColors(main, ink);
    expect(getContrastRatio(drawn(ink, track), track)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(getContrastRatio(drawn(ink, fill), fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
  });
});

