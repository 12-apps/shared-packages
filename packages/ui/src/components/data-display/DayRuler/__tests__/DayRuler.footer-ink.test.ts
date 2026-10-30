/**
 * A GROUP FOOTER'S MARKED WORDS READ AT 4.5:1, LIGHT AND DARK (FUT-3882).
 *
 * The marked counts are 12px and the marked note 13px: WCAG AA for normal
 * text. `warning.main` on a white page is 3.1:1, so the words take the
 * deepened warning ink; the 1px outline keeps `warning.main` (non-text, 3:1).
 */
import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { getContrastRatio } from '../../../../tokens/color';
import { footerInk } from '../DayRuler.styles';

describe.each(['light', 'dark'] as const)('%s mode', (mode) => {
  const theme = createTheme({ palette: { mode } });
  const page = theme.palette.background.default;

  it('a marked count or note reads at 4.5:1 on the page', () => {
    expect(getContrastRatio(footerInk(theme, true, theme.palette.text.primary), page)).toBeGreaterThanOrEqual(4.5);
  });

  it('an unmarked one keeps the ink it was given', () => {
    expect(footerInk(theme, false, theme.palette.text.secondary)).toBe(theme.palette.text.secondary);
  });

  it('is not the raw warning.main, which fails on a light page', () => {
    if (mode === 'light') expect(getContrastRatio(theme.palette.warning.main, page)).toBeLessThan(4.5);
    expect(footerInk(theme, true, theme.palette.text.primary)).not.toBe(theme.palette.warning.main);
  });
});
