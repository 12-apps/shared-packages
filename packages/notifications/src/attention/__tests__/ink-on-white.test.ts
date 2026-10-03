import { describe, expect, it } from 'vitest';

import { createTheme } from '@12-apps/ui/mui/styles';

import { inkOnWhite } from '../react/attention-button';

/**
 * The "+N" ball is white in every theme, so its number must read on white in
 * the dark theme too: there the dark theme's light tones (~2.6:1) are mixed
 * toward black; the light theme's approved tones are kept as they are.
 */
describe('the "+N" ink on its white ball', () => {
  const light = createTheme({ palette: { mode: 'light' } });
  const dark = createTheme({ palette: { mode: 'dark' } });

  it('keeps the light theme’s own tones', () => {
    expect(inkOnWhite(light, 'calm')).toBe(light.palette.success.main);
    expect(inkOnWhite(light, 'late')).toBe(light.palette.warning.main);
  });

  it('darkens the dark theme’s tones toward black', () => {
    expect(inkOnWhite(dark, 'calm')).toBe(`color-mix(in srgb, ${dark.palette.success.main} 65%, black)`);
    expect(inkOnWhite(dark, 'late')).toBe(`color-mix(in srgb, ${dark.palette.warning.main} 65%, black)`);
    expect(inkOnWhite(dark, 'spent')).toMatch(/^color-mix\(in srgb, color-mix\(.+\) 65%, black\)$/);
  });
});
