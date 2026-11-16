import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ToggleGroup } from '../ToggleGroup';

const RED = '#d32f2f';
const options = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
];

function chosen(selection?: 'fill' | 'quiet') {
  const theme = createTheme({ palette: { primary: { main: RED } } });
  render(
    <ThemeProvider theme={theme}>
      <ToggleGroup
        variant="exclusive"
        options={options}
        value="week"
        dataTestId="grain"
        {...(selection ? { selection } : {})}
      />
    </ThemeProvider>,
  );
  return getComputedStyle(screen.getByTestId('grain-item-week'));
}

describe('ToggleGroup selection="quiet" (FUT-4063)', () => {
  it('draws the chosen option in the text ink, ringed, never in the brand colour', () => {
    const style = chosen('quiet');
    expect(style.backgroundColor).not.toBe('rgb(211, 47, 47)');
    expect(style.color).toBe('rgba(0, 0, 0, 0.87)');
    expect(style.boxShadow).toContain('inset');
    expect(screen.getByTestId('grain')).toHaveAttribute('data-selection', 'quiet');
    expect(screen.getByTestId('grain-item-week')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the filled choice by default', () => {
    const style = chosen();
    expect(style.backgroundColor).toBe('rgb(211, 47, 47)');
    expect(screen.getByTestId('grain')).not.toHaveAttribute('data-selection');
  });
});
