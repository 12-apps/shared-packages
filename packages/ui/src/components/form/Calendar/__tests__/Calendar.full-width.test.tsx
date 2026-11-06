// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ThemeProvider, createTheme } from '../../../../mui/styles';
import { Calendar } from '../Calendar';

/**
 * `fullWidth` (FUT-4156, round 2): a calendar laid into a page section meets
 * its edges. The months take the row, the seven columns spread, and the day
 * faces keep their 40 design px — only the spacing grows. Off by default, so
 * every other adopter's calendar is the 304px month it was.
 */

const theme = createTheme();
const r = (px: number) => theme.typography.pxToRem(px);

function mount(fullWidth?: boolean): void {
  render(
    <ThemeProvider theme={theme}>
      <Calendar
        ariaLabel="Período"
        selectionMode="range"
        numberOfMonths={2}
        range={{ start: new Date(2026, 10, 10), end: new Date(2026, 10, 20) }}
        {...(fullWidth === undefined ? {} : { fullWidth })}
      />
    </ThemeProvider>,
  );
}

const style = (testId: string): CSSStyleDeclaration => getComputedStyle(screen.getAllByTestId(testId)[0]!);

describe('Calendar fullWidth', () => {
  it('F1: by default keeps the 304 design px month and its fixed columns', () => {
    mount();
    expect(style('calendar-month-0').maxWidth).toBe(r(304));
    expect(style('calendar-date-12').width).toBe(r(304 / 7));
    expect(style('calendar-container').width).not.toBe('100%');
  });

  it('F2: spreads the months and their columns across the width it is given', () => {
    mount(true);
    expect(style('calendar-container').width).toBe('100%');
    const month = style('calendar-month-0');
    expect(month.maxWidth).toBe('none');
    // A real basis, so the month grows: an `sxRem` interpolated into the string
    // was dropped as invalid CSS and left the month at its content's width.
    expect(month.flex).toBe(`1 1 ${r(280)}`);
  });

  it('F3: a day fills its column but its face stays 40 design px tall at most', () => {
    mount(true);
    const day = style('calendar-date-12');
    expect(day.width).toBe('100%');
    expect(day.maxHeight).toBe(r(40));
    expect(day.aspectRatio.replace(/\s/g, '')).toBe('38/35');
  });

  it('F4: an outside-day placeholder sizes like a day, so rows keep one height', () => {
    render(
      <ThemeProvider theme={theme}>
        <Calendar ariaLabel="Período" selectionMode="range" numberOfMonths={1} showOutsideDays={false} fullWidth />
      </ThemeProvider>,
    );
    const placeholder = style('calendar-outside-placeholder');
    expect(placeholder.width).toBe('100%');
    expect(placeholder.maxHeight).toBe(r(40));
  });
});
