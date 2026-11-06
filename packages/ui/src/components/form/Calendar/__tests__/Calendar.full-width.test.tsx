// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ThemeProvider, createTheme } from '../../../../mui/styles';
import { Calendar } from '../Calendar';
import { captionOf } from '../CalendarMonth';

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

  it('F3: a day fills its column and is 40 design px tall at every width, never a ratio of it', () => {
    // Round 3: the 38/35 ratio made a 36px column 33 tall at 320 wide.
    mount(true);
    const day = style('calendar-date-12');
    expect(day.width).toBe('100%');
    expect(day.height).toBe(r(40));
    expect(day.aspectRatio).toBe('');
  });

  it('F4: an outside-day placeholder sizes like a day, so rows keep one height', () => {
    render(
      <ThemeProvider theme={theme}>
        <Calendar ariaLabel="Período" selectionMode="range" numberOfMonths={1} showOutsideDays={false} fullWidth />
      </ThemeProvider>,
    );
    const placeholder = style('calendar-outside-placeholder');
    expect(placeholder.width).toBe('100%');
    expect(placeholder.height).toBe(r(40));
  });
});

/** The rule bodies Emotion emitted for `.<own class><suffix>`, joined. */
function rulesFor(element: Element, suffix: string): string {
  const css = [...document.querySelectorAll('style')].map((tag) => tag.textContent ?? '').join('\n');
  const own = [...element.classList].filter((name) => name.startsWith('css-'));
  return css
    .split('}')
    .filter((block) => own.some((name) => block.trimStart().startsWith(`.${name}${suffix}`)))
    .map((block) => block.slice(block.indexOf('{') + 1))
    .join(';');
}

describe('Calendar fullWidth, round 3 (FUT-4156)', () => {
  const monthsRow = (): Element => screen.getAllByTestId('calendar-month-0')[0]!.parentElement!;

  it('F5: the months row grows to the container in a row layout (two months side by side at 900+)', () => {
    mount(true);
    const row = getComputedStyle(monthsRow());
    expect(row.flex).toBe('1 1 auto');
    expect(row.minWidth).toBe('0');
  });

  it('F6: by default the months row keeps its content width', () => {
    mount();
    expect(getComputedStyle(monthsRow()).flex).toBe('');
  });

  it("F7: a filling row's end caps round at 20 design px, half the 40 tall cell, not half a wide column", () => {
    mount(true);
    const day = screen.getAllByTestId('calendar-date-12')[0]!;
    const start = rulesFor(day, ':nth-child(7n + 1)').replace(/\s/g, '');
    const end = rulesFor(day, ':nth-child(7n)').replace(/\s/g, '');
    expect(start).toContain(`border-start-start-radius:${r(20)}`);
    expect(start).toContain(`border-end-start-radius:${r(20)}`);
    expect(end).toContain(`border-start-end-radius:${r(20)}`);
    expect(end).toContain(`border-end-end-radius:${r(20)}`);
  });

  it('F8: off, the caps stay half the cell', () => {
    mount();
    const day = screen.getAllByTestId('calendar-date-12')[0]!;
    expect(rulesFor(day, ':nth-child(7n + 1)').replace(/\s/g, '')).toContain('border-start-start-radius:50%');
  });
});

describe('the month caption (FUT-4156, round 3)', () => {
  it("C1: is a title in the calendar's language — 'Novembro de 2026' — while the grid keeps Intl's name", () => {
    render(
      <ThemeProvider theme={theme}>
        <Calendar ariaLabel="Período" locale="pt-BR" value={new Date(2026, 10, 10)} />
      </ThemeProvider>,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Novembro de 2026');
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('novembro de 2026');
  });

  it("C2: upper-cases by the calendar's locale, not a fixed table (Turkish dotted İ)", () => {
    expect(captionOf('ilkbahar 2026', 'tr-TR')).toBe('İlkbahar 2026');
    expect(captionOf('ilkbahar 2026', 'en-US')).toBe('Ilkbahar 2026');
  });
});
