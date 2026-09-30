import * as mui from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import {
  alpha,
  blend,
  darken,
  decomposeColor,
  emphasize,
  getContrastRatio,
  getLuminance,
  hexToRgb,
  hslToRgb,
  lighten,
  recomposeColor,
} from '../color';

/**
 * PARITY, NOT PLAUSIBILITY.
 *
 * `color.ts` exists so the native renderer can compute the shade the web
 * paints without importing MUI. The only assertion worth making about it is
 * therefore "same input, same string as MUI" — over every format the package
 * uses and every coefficient the components pass. A hand-picked expected value
 * would pin THIS file's opinion; MUI's own function pins the web's.
 */
const COLORS = [
  '#6366F1',
  '#8B5CF6',
  '#2e7d32',
  '#ed6c02',
  '#fff',
  '#000',
  '#abc',
  '#6366F180',
  'rgb(99, 102, 241)',
  'rgba(0, 0, 0, 0.87)',
  'rgba(255, 255, 255, 0.7)',
  'hsl(239, 84%, 67%)',
  'hsla(239, 84%, 67%, 0.5)',
];

const COEFFICIENTS = [0, 0.04, 0.08, 0.1, 0.12, 0.2, 0.3, 0.35, 0.5, 0.6, 1];

describe('color.ts matches @mui/system/colorManipulator', () => {
  it.each(COLORS)('decomposes and recomposes %s like MUI', (color) => {
    expect(decomposeColor(color)).toEqual(mui.decomposeColor(color));
    expect(recomposeColor(decomposeColor(color))).toBe(mui.recomposeColor(mui.decomposeColor(color)));
  });

  it.each(COLORS.filter((color) => color.startsWith('#')))('hexToRgb(%s)', (color) => {
    expect(hexToRgb(color)).toBe(mui.hexToRgb(color));
  });

  it.each(COLORS.filter((color) => color.startsWith('hsl')))('hslToRgb(%s)', (color) => {
    expect(hslToRgb(color)).toBe(mui.hslToRgb(color));
  });

  it.each(COLORS)('luminance of %s', (color) => {
    expect(getLuminance(color)).toBe(mui.getLuminance(color));
  });

  it.each(COLORS)('contrast of %s against white and black', (color) => {
    expect(getContrastRatio(color, '#fff')).toBe(mui.getContrastRatio(color, '#fff'));
    expect(getContrastRatio(color, '#000')).toBe(mui.getContrastRatio(color, '#000'));
  });

  describe.each(COEFFICIENTS)('at coefficient %d', (coefficient) => {
    it.each(COLORS)('lighten(%s)', (color) => {
      expect(lighten(color, coefficient)).toBe(mui.lighten(color, coefficient));
    });
    it.each(COLORS)('darken(%s)', (color) => {
      expect(darken(color, coefficient)).toBe(mui.darken(color, coefficient));
    });
    it.each(COLORS)('alpha(%s)', (color) => {
      expect(alpha(color, coefficient)).toBe(mui.alpha(color, coefficient));
    });
    it.each(COLORS)('emphasize(%s)', (color) => {
      expect(emphasize(color, coefficient)).toBe(mui.emphasize(color, coefficient));
    });
  });

  it('truncates rgb channels rather than rounding them, as MUI does', () => {
    // 0x66 = 102; 102 + (255 - 102) * 0.2 = 132.6. Rounding would say 133.
    expect(lighten('#6366F1', 0.2)).toBe('rgb(130, 132, 243)');
  });

  it('refuses a colour format it does not implement', () => {
    expect(() => decomposeColor('color(display-p3 0 1 0)')).toThrow(/unsupported colour/);
  });
});

/**
 * `blend` has no MUI counterpart reachable from here (`@mui/material/styles`
 * does not re-export it), so it is pinned by its arithmetic: each channel is
 * `round(background × (1 − opacity) + overlay × opacity)`, which is MUI's own
 * `blend` at its default gamma of 1.
 */
describe('blend', () => {
  it('composites the overlay over the background, rounding each channel', () => {
    // 255·0.92 + 46·0.08 = 238.28; 255·0.92 + 125·0.08 = 244.6; 255·0.92 + 50·0.08 = 238.6
    expect(blend('#ffffff', '#2e7d32', 0.08)).toBe('rgb(238, 245, 239)');
  });

  it('returns an opaque rgb() whatever the inputs carry', () => {
    expect(blend('rgba(255, 255, 255, 0.5)', '#6366F180', 0.5)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('is the background at 0 and the overlay at 1', () => {
    expect(blend('#abc', '#123456', 0)).toBe('rgb(170, 187, 204)');
    expect(blend('#abc', '#123456', 1)).toBe('rgb(18, 52, 86)');
  });

  it('converts hsl() before mixing, rather than mixing hue as red', () => {
    expect(blend('hsl(0, 0%, 100%)', 'hsl(0, 0%, 0%)', 0.5)).toBe(blend('#ffffff', '#000000', 0.5));
  });
});
