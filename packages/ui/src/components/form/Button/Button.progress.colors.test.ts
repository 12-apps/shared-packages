import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { getContrastRatio } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';
import {
  BUTTON_PROGRESS_MIN_CONTRAST,
  BUTTON_PROGRESS_MIN_SEPARATION,
  buttonProgressColors,
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

describe('Button progress colours for ANY brand, extremes included', () => {
  const MAINS = ['#000', '#111', '#1a1a2e', '#fff', '#f5f5f5', '#ffeb3b', createTheme().palette.primary.main];

  it.each(MAINS)('%s: label on track and on fill ≥ 4.5, fill apart from track ≥ 1.3', (main) => {
    const ink = createTheme({ palette: { primary: { main } } }).palette.primary.contrastText;
    const { track, fill } = buttonProgressColors(main, ink);
    expect(getContrastRatio(ink, track)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(getContrastRatio(ink, fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_CONTRAST);
    expect(getContrastRatio(track, fill)).toBeGreaterThanOrEqual(BUTTON_PROGRESS_MIN_SEPARATION);
  });
});

