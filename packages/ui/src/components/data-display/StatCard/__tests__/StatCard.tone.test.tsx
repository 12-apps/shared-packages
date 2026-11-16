import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { getContrastRatio } from '../../../../tokens/color';
import { StatCard } from '../StatCard';

function deltaColour(mode: 'light' | 'dark', tone?: 'positive' | 'negative' | 'neutral') {
  const theme = createTheme({ palette: { mode } });
  render(
    <ThemeProvider theme={theme}>
      <StatCard
        label="Receita"
        value="R$ 1.000"
        delta={{ value: '-4%', direction: 'down', ...(tone ? { tone } : {}) }}
        dataTestId="stat"
      />
    </ThemeProvider>,
  );
  const text = screen.getByText('-4%');
  return { theme, colour: getComputedStyle(text).color, arrow: screen.getByTestId('stat-delta').querySelector('svg') };
}

/** jsdom reports `rgb(r, g, b)`; the palette speaks hex. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('StatCard fall tone (FUT-145)', () => {
  it('draws a fall in amber, never the error red, with its arrow', () => {
    const { theme, colour, arrow } = deltaColour('light');
    expect(colour).not.toBe(rgb(theme.palette.error.main));
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'negative');
    expect(arrow).toBeInTheDocument();
  });

  it('reads the fall at 4.5:1 on the card in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const { theme, colour } = deltaColour(mode);
      expect(getContrastRatio(colour, theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
      cleanup();
    }
  });

  it('keeps an amber hue: a warning shade, not black', () => {
    const { colour } = deltaColour('light');
    const [r = 0, g = 0, b = 0] = (colour.match(/\d+/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('lets a card read a fall as neutral or positive', () => {
    const neutral = deltaColour('light', 'neutral');
    expect(neutral.colour).toBe('rgba(0, 0, 0, 0.6)');
    cleanup();
    const positive = deltaColour('light', 'positive');
    expect(positive.colour).toBe(rgb(positive.theme.palette.success.main));
  });
});
