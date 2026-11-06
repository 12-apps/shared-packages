// @vitest-environment jsdom
/**
 * The opt-in options a form that OWNS its typed dates needs (FUT-4156): the
 * fields beside the months when the picker has the room, the consumer's own
 * fields instead of the built-in pair, a start with no end as a finished
 * answer, and named month arrows. Every one is off by default, and the first
 * cases pin that a picker given none of them renders exactly as before.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from '../DateRangePicker';
import type { DateRangeDraft, DateRangePickerProps } from '../DateRangePicker.types';

const NOW = new Date('2026-11-06T15:00:00.000Z');
const TEST_ID = 'drp';

type HarnessProps = Partial<Omit<DateRangePickerProps, 'value' | 'onChange'>> & {
  initial?: DateRangeDraft;
};

/** A consumer that owns the draft, and can set it from outside the picker. */
function Harness({ initial = { from: null, to: null }, ...props }: HarnessProps): React.JSX.Element {
  const [value, setValue] = useState<DateRangeDraft>(initial);
  return (
    <>
      <button type="button" onClick={() => setValue({ from: '2027-01-10', to: null })}>
        outside
      </button>
      <DateRangePicker
        value={value}
        onChange={(next) => setValue(next)}
        now={NOW}
        timeZone="UTC"
        quickRanges={[]}
        dataTestId={TEST_ID}
        {...props}
      />
    </>
  );
}

/** Every element the picker measures reports `width` px. */
function pickerWidth(width: number): void {
  class FixedWidthObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FixedWidthObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const months = (): number => screen.getAllByTestId(/^calendar-month-/).length;
const placement = (): string | null =>
  screen.getByTestId(TEST_ID).getAttribute('data-fields-placement');

describe('given none of the options, the picker is what it was', () => {
  it('draws its own fields under the months, with the summary line', () => {
    pickerWidth(1100);
    render(<Harness initial={{ from: '2026-11-10', to: '2026-11-20' }} numberOfMonths={2} />);

    expect(placement()).toBeNull();
    expect(screen.getByTestId(`${TEST_ID}-from`)).toBeTruthy();
    expect(screen.getByTestId(`${TEST_ID}-status`).textContent).toBe('10/11/2026 – 20/11/2026');
    expect(months()).toBe(2);
  });

  it('still calls a start with no end incomplete', () => {
    render(<Harness initial={{ from: '2026-11-10', to: null }} />);

    expect(screen.getByTestId(`${TEST_ID}-status`).textContent).toBe('Choose both dates.');
  });
});

describe('fieldsPlacement="beside"', () => {
  it('puts the fields beside two months when the picker is wide enough for both', () => {
    pickerWidth(1100);
    render(<Harness fieldsPlacement="beside" numberOfMonths={2} />);

    expect(placement()).toBe('beside');
    expect(months()).toBe(2);
  });

  it('moves the fields under the two months when only the months fit', () => {
    pickerWidth(700);
    render(<Harness fieldsPlacement="beside" numberOfMonths={2} />);

    expect(placement()).toBe('below');
    expect(months()).toBe(2);
  });

  it('draws one month, fields under it, when two months would not fit either', () => {
    pickerWidth(358);
    render(<Harness fieldsPlacement="beside" numberOfMonths={2} />);

    expect(placement()).toBe('below');
    expect(months()).toBe(1);
  });
});

describe('renderFields', () => {
  const ownFields = ({ placement: where }: { placement: string }) => (
    <div data-testid="own-fields" data-where={where}>
      own
    </div>
  );

  it("draws the consumer's fields instead of the built-in pair and its summary", () => {
    pickerWidth(1100);
    render(<Harness fieldsPlacement="beside" numberOfMonths={2} renderFields={ownFields} />);

    expect(screen.getByTestId('own-fields').getAttribute('data-where')).toBe('beside');
    // Neither the built-in pair nor its summary line is drawn at all.
    expect(screen.getByTestId(TEST_ID).querySelectorAll('input')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('tells the fields where they are, so they can lay themselves out', () => {
    pickerWidth(358);
    render(<Harness fieldsPlacement="beside" renderFields={ownFields} />);

    expect(screen.getByTestId('own-fields').getAttribute('data-where')).toBe('below');
  });

  it('follows a range the consumer set from outside, as it follows a typed one', () => {
    render(<Harness numberOfMonths={1} renderFields={ownFields} />);
    expect(screen.getByTestId('calendar-header').textContent).toContain('November 2026');

    fireEvent.click(screen.getByText('outside'));

    expect(screen.getByTestId('calendar-header').textContent).toContain('January 2027');
  });
});

describe('openEnd', () => {
  it('reads a start with no end as a finished answer, without repeating the date', () => {
    render(<Harness initial={{ from: '2026-11-10', to: null }} openEnd />);

    const line = screen.getByTestId(`${TEST_ID}-status`);
    expect(line.textContent).toBe('No end date.');
    expect(line.textContent).not.toContain('10/11/2026');
  });

  it('takes its own words for it', () => {
    render(
      <Harness
        initial={{ from: '2026-11-10', to: null }}
        openEnd
        messages={{ openEnded: 'Sem término.' }}
      />,
    );

    expect(screen.getByTestId(`${TEST_ID}-status`).textContent).toBe('Sem término.');
  });

  it('still asks for both ends when NOTHING is chosen', () => {
    render(<Harness openEnd />);

    expect(screen.getByTestId(`${TEST_ID}-status`).textContent).toBe('Choose both dates.');
  });
});

describe('calendarLabels', () => {
  it('names the month arrows', () => {
    render(<Harness calendarLabels={{ previousMonth: 'Mês anterior', nextMonth: 'Próximo mês' }} />);

    expect(screen.getAllByRole('button', { name: 'Mês anterior' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Próximo mês' }).length).toBeGreaterThan(0);
  });
});
