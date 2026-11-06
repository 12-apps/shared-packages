// @vitest-environment jsdom
/**
 * The calendar options a page-embedded period picker passes through (FUT-4156,
 * round 2): days outside the month hidden, today ringed, one day refused as a
 * whole range — and the grid kept where it is, focus included, when the
 * consumer completes a tap into a different draft than the one it was handed.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { PT_BR_UI_LABELS } from '../../../../pt-BR.labels';
import { Calendar } from '../../Calendar';
import { DateRangePicker } from '../DateRangePicker';
import { defaultMessages } from '../DateRangePicker.range';
import type { DateRangeDraft, DateRangePickerProps } from '../DateRangePicker.types';

const TEST_ID = 'drp';

type HarnessProps = Partial<Omit<DateRangePickerProps, 'value' | 'onChange'>> & {
  initial?: DateRangeDraft;
  /** The consumer's own step from the tapped draft to the one it keeps. */
  keep?: (before: DateRangeDraft, tapped: DateRangeDraft) => DateRangeDraft;
};

function Harness({ initial = { from: null, to: null }, keep, ...props }: HarnessProps): React.JSX.Element {
  const [value, setValue] = useState<DateRangeDraft>(initial);
  return (
    <>
      <output data-testid="value">{`${value.from ?? '-'}|${value.to ?? '-'}`}</output>
      <DateRangePicker
        value={value}
        onChange={(next) => setValue(keep ? keep(value, next) : next)}
        locale="pt-BR"
        quickRanges={[]}
        numberOfMonths={1}
        renderFields={() => null}
        dataTestId={TEST_ID}
        {...props}
      />
    </>
  );
}

const valueText = (): string => screen.getByTestId('value').textContent ?? '';
const monthTitle = (): string => within(screen.getByTestId('calendar-month-0')).getByRole('heading').textContent ?? '';
const day = (n: number): HTMLElement =>
  within(screen.getByTestId('calendar-month-0'))
    .getAllByTestId(`calendar-date-${n}`)
    .find((cell) => cell.getAttribute('data-in-month') === 'true')!;

describe('the opening month', () => {
  it('opens on Término when only Término is chosen', () => {
    render(<Harness initial={{ from: null, to: '2027-03-15' }} />);
    expect(monthTitle()).toMatch(/março de 2027/u);
  });

  it('opens on Início when both are chosen', () => {
    render(<Harness initial={{ from: '2027-02-01', to: '2027-03-15' }} />);
    expect(monthTitle()).toMatch(/fevereiro de 2027/u);
  });
});

describe('a second tap on the start day', () => {
  it('is a one-day range by default', () => {
    render(<Harness initial={{ from: '2027-02-10', to: null }} />);
    fireEvent.click(day(10));
    expect(valueText()).toBe('2027-02-10|2027-02-10');
  });

  it('does nothing with allowSameDayRange={false}', () => {
    render(<Harness initial={{ from: '2027-02-10', to: null }} allowSameDayRange={false} />);
    fireEvent.click(day(10));
    expect(valueText()).toBe('2027-02-10|-');
  });
});

describe('days outside the month', () => {
  it('are drawn by default', () => {
    render(<Harness initial={{ from: '2027-02-10', to: null }} />);
    expect(screen.queryAllByTestId('calendar-outside-placeholder')).toHaveLength(0);
  });

  it('are blank placeholders with showOutsideDays={false}', () => {
    render(<Harness initial={{ from: '2027-02-10', to: null }} showOutsideDays={false} />);
    expect(screen.getAllByTestId('calendar-outside-placeholder').length).toBeGreaterThan(0);
    const buttons = within(screen.getByTestId('calendar-month-0')).getAllByRole('gridcell');
    expect(buttons.every((cell) => cell.getAttribute('data-in-month') === 'true')).toBe(true);
  });
});

describe("today's mark", () => {
  /** The `::before` rule emitted for today's cell — jsdom computes no pseudo-elements. */
  const todayFace = (indicator?: 'bold' | 'ring'): string => {
    const { unmount } = render(<Calendar ariaLabel="c" {...(indicator ? { todayIndicator: indicator } : {})} />);
    const cell = screen.getByTestId('calendar-today').parentElement!;
    const rules = [...document.querySelectorAll('style')].map((tag) => tag.textContent ?? '').join('\n');
    const own = cell.className
      .split(' ')
      .filter((name) => name.startsWith('css-'))
      .map((name) => rules.split(`.${name}::before{`)[1]?.split('}')[0] ?? '')
      .join('');
    unmount();
    return own;
  };

  it('is the bold number alone by default', () => {
    expect(todayFace()).not.toMatch(/inset 0 0 0/u);
  });

  it('is a ring in the primary colour with todayIndicator="ring"', () => {
    expect(todayFace('ring')).toMatch(/box-shadow:inset 0 0 0 [\d.]+rem #/u);
  });
});

describe('a tap the consumer completes differently', () => {
  // The consumer's rule FUT-4156 draws: with only an end chosen, a tap before
  // it is the start and the end stays.
  const keepEnd = (before: DateRangeDraft, tapped: DateRangeDraft): DateRangeDraft =>
    before.from === null && before.to !== null && tapped.to === null && tapped.from !== null && tapped.from < before.to
      ? { from: tapped.from, to: before.to }
      : tapped;

  it('keeps the grid on its month and focus on the tapped day', () => {
    render(<Harness initial={{ from: null, to: '2027-03-20' }} keep={keepEnd} />);
    fireEvent.click(screen.getByTestId('calendar-prev-month'));
    expect(monthTitle()).toMatch(/fevereiro de 2027/u);

    const tapped = day(10);
    tapped.focus();
    fireEvent.click(tapped);

    expect(valueText()).toBe('2027-02-10|2027-03-20');
    expect(monthTitle()).toMatch(/fevereiro de 2027/u);
    expect(tapped.isConnected).toBe(true);
    expect(document.activeElement).toBe(tapped);
  });
});

describe('the pt-BR labels', () => {
  it('say an open end in Portuguese', () => {
    expect(PT_BR_UI_LABELS.dateRangePicker.openEnded).toBe('Sem data de término.');
    expect(defaultMessages().openEnded).toBe('No end date.');
  });
});
