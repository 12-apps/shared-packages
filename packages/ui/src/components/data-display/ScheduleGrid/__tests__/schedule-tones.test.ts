/**
 * EVERY TONE'S TEXT READS AT 4.5:1, LIGHT AND DARK (FUT-3825).
 *
 * A block's label is 12px: WCAG AA for normal text. MUI's stock `warning`
 * failed it twice — white on the solid late block (3.1:1) and `warning.dark`
 * on the cell for away / uncovered (3.6:1). The ink is measured against the
 * ground it actually sits on: the tone's own fill when it has one, the cell
 * (`action.hover` over the page) when it is transparent.
 */
import { createTheme, type Theme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { blend, decomposeColor, getContrastRatio } from '../../../../tokens/color';
import { blockToneStyles, cellGround, signalInk } from '../schedule-tones';
import type { ScheduleBlockTone } from '../ScheduleGrid.types';

const TONES: readonly ScheduleBlockTone[] = ['plan', 'late', 'away', 'uncovered', 'onduty'];
const MODES = ['light', 'dark'] as const;

/** A translucent colour as it shows over an opaque one. */
function over(ground: string, colour: string): string {
  const { values, type } = decomposeColor(colour);
  return blend(ground, colour, type.endsWith('a') ? (values[3] ?? 1) : 1);
}

/** The ground a block's text sits on, as painted. */
function groundOf(theme: Theme, fill: string | undefined): string {
  const cell = cellGround(theme);
  return !fill || fill === 'transparent' ? cell : over(cell, fill);
}

function ratioOf(theme: Theme, tone: ScheduleBlockTone, dashedPlan: boolean): number {
  const style = blockToneStyles(theme, tone, dashedPlan);
  const ground = groundOf(theme, style.backgroundColor as string | undefined);
  return getContrastRatio(over(ground, String(style.color)), ground);
}

describe.each(MODES)('%s mode', (mode) => {
  const theme = createTheme({ palette: { mode } });

  it.each(TONES)('the %s block in the week grid reads at 4.5:1', (tone) => {
    expect(ratioOf(theme, tone, false)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)('the %s block on the day ruler reads at 4.5:1', (tone) => {
    expect(ratioOf(theme, tone, true)).toBeGreaterThanOrEqual(4.5);
  });

  it("the warning meta line under a name reads at 4.5:1 on the page", () => {
    const page = theme.palette.background.default;
    expect(getContrastRatio(signalInk(theme, 'warning', page), page)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('what the ink is', () => {
  it('the late block is solid amber with DARK ink in light mode (the prototype, G-E3)', () => {
    const theme = createTheme({ palette: { mode: 'light' } });
    const late = blockToneStyles(theme, 'late');
    expect(late.backgroundColor).toBe(theme.palette.warning.main);
    expect(late.color).toBe(theme.palette.text.primary);
  });

  it("keeps a host's contrastText when it already reads", () => {
    const theme = createTheme({ palette: { warning: { main: '#ffd54f', contrastText: '#1a1a1a' } } });
    expect(blockToneStyles(theme, 'late').color).toBe('#1a1a1a');
  });

  it('away keeps an amber hue, only deepened as far as it must', () => {
    const theme = createTheme({ palette: { mode: 'light' } });
    const ink = String(blockToneStyles(theme, 'away').color);
    const [r, g, b] = decomposeColor(ink).values;
    expect(r).toBeGreaterThan(g ?? 0);
    expect(g).toBeGreaterThan(b ?? 0);
    expect(getContrastRatio(ink, cellGround(theme))).toBeLessThan(7);
  });
});
