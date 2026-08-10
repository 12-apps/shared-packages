// @vitest-environment jsdom
/**
 * The three views over one range, and the rule that binds them: change any, the
 * other two follow.
 *
 * Every case runs on a FROZEN instant handed in through `now`, so "today" is a
 * fact of the test rather than of the day it is run on — a quick-range picker
 * whose cases only pass in August is not a test.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DateRangePicker } from '../DateRangePicker';
import { createQuickRanges } from '../DateRangePicker.quick';
import type {
  DateRangeChangeMeta,
  DateRangeDraft,
  DateRangePickerProps,
} from '../DateRangePicker.types';

/** 02:00 UTC on the 11th — which is still the 10th in São Paulo. */
const NOW = new Date('2026-08-11T02:00:00.000Z');
/** The window the picker opens on unless a case says otherwise. */
const SEED: DateRangeDraft = { from: '2026-08-05', to: '2026-08-12' };
const TEST_ID = 'drp';

/**
 * Every change the picker reported, newest last. A container the harness
 * MUTATES — the flakiness gate rejects a closed-over binding reassigned from
 * inside a callback.
 */
const seen = { meta: [] as DateRangeChangeMeta[] };

beforeEach(() => {
  seen.meta = [];
});

type HarnessProps = Partial<Omit<DateRangePickerProps, 'value' | 'onChange'>> & {
  initial?: DateRangeDraft;
};

/** Controlled the way a caller controls it: the harness owns the draft. */
function Harness({ initial = SEED, ...props }: HarnessProps): React.JSX.Element {
  const [value, setValue] = useState<DateRangeDraft>(initial);
  return (
    <DateRangePicker
      value={value}
      onChange={(next, meta) => {
        seen.meta.push(meta);
        setValue(next);
      }}
      now={NOW}
      // Stated, so no case depends on the zone the machine running it is in.
      timeZone="UTC"
      // ONE month while a case clicks days: `Calendar` gives every cell the
      // testid `calendar-date-<day of month>`, so a second month on screen puts
      // two "12"s in the document and the query has to be disambiguated by
      // position — which the flakiness gate refuses, correctly.
      numberOfMonths={1}
      dataTestId={TEST_ID}
      {...props}
    />
  );
}

const field = (which: 'from' | 'to'): HTMLInputElement =>
  screen.getByTestId(`${TEST_ID}-${which}`) as HTMLInputElement;

const quick = (id: string): HTMLElement => screen.getByTestId(`${TEST_ID}-quick-${id}`);

const status = (): string => screen.getByTestId(`${TEST_ID}-status`).textContent ?? '';

const monthOnScreen = (): string => screen.getByTestId('calendar-header').textContent ?? '';

/** The window of the most recent change, or null when it was not a usable one. */
function lastWindow(): { from: string; to: string } | null {
  const meta = seen.meta[seen.meta.length - 1];
  return meta && meta.status.ok ? meta.status.window : null;
}

describe('the picker opens on the range it is given', () => {
  it('shows it in both fields and on the calendar', () => {
    render(<Harness />);

    expect(field('from').value).toBe('05/08/2026');
    expect(field('to').value).toBe('12/08/2026');
    expect(monthOnScreen()).toContain('August 2026');
  });

  it('says what the range is, in words', () => {
    render(<Harness />);

    expect(status()).toBe('05/08/2026 – 12/08/2026');
  });
});

describe('the quick column', () => {
  it('reports the window AND which entry produced it', () => {
    render(<Harness />);

    fireEvent.click(quick('this-month'));

    expect(lastWindow()).toEqual({ from: '2026-08-01', to: '2026-08-11' });
    // The id travels with the change so a caller can express the pick as its
    // own thing — a preset it already has — rather than as a custom window
    // that happens to hold the same two dates.
    expect(seen.meta[seen.meta.length - 1]?.quickRangeId).toBe('this-month');
  });

  it('writes the pick into both fields', () => {
    render(<Harness />);

    fireEvent.click(quick('last-7-days'));

    expect(field('from').value).toBe('05/08/2026');
    expect(field('to').value).toBe('11/08/2026');
  });

  it('marks the entry the range currently IS as pressed', () => {
    render(<Harness />);

    fireEvent.click(quick('this-quarter'));

    expect(quick('this-quarter').getAttribute('aria-pressed')).toBe('true');
    expect(quick('this-month').getAttribute('aria-pressed')).toBe('false');
  });

  it('moves the calendar to the month the pick starts in', () => {
    render(<Harness />);

    fireEvent.click(quick('this-year'));

    // January, because that is where the range now STARTS. Leaving the grid on
    // August would show a range with neither end in it.
    expect(monthOnScreen()).toContain('January 2026');
  });
});

describe('the cap refuses rather than clamps', () => {
  it('disables an over-cap entry and says why, in the field the cap is stated in', () => {
    render(<Harness maxRangeDays={30} />);

    // 11 August back to 1 January is 223 days. The entry stays on screen and
    // stays reachable — it is `aria-disabled`, not `disabled` — so the reason
    // is available to the reader most likely to need it.
    const entry = quick('this-year');
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(entry.textContent).toContain('30 days');
  });

  it('leaves the range alone when the over-cap entry is clicked', () => {
    render(<Harness maxRangeDays={30} />);

    fireEvent.click(quick('this-year'));

    // Handing back eleven months of it, or a clipped 30-day window, would both
    // be a control answering a question nobody asked.
    expect(seen.meta).toHaveLength(0);
    expect(field('from').value).toBe('05/08/2026');
  });

  it('offers an entry that lands exactly ON the cap', () => {
    render(<Harness maxRangeDays={30} />);

    const entry = quick('last-30-days');
    expect(entry.hasAttribute('aria-disabled')).toBe(false);
  });

  it('refuses a TYPED window over the cap, with the same reason', () => {
    render(<Harness maxRangeDays={30} />);

    fireEvent.change(field('to'), { target: { value: '30/09/2026' } });

    // Typed, so the calendar's own length check never sees it: 57 days.
    expect(status()).toContain('30 days');
    expect(lastWindow()).toBe(null);
  });
});

describe('the typed fields', () => {
  it('moves the calendar to a date typed into it', () => {
    render(<Harness />);

    fireEvent.change(field('from'), { target: { value: '03/03/2026' } });

    expect(monthOnScreen()).toContain('March 2026');
    expect(lastWindow()).toEqual({ from: '2026-03-03', to: '2026-08-12' });
  });

  it('changes nothing while a date is half-typed', () => {
    render(<Harness />);

    fireEvent.change(field('from'), { target: { value: '03/03/20' } });

    // `0320`, `2020` and `2026` are all legal years on the way to 2026;
    // committing each would send the calendar somewhere nobody typed.
    expect(seen.meta).toHaveLength(0);
    expect(monthOnScreen()).toContain('August 2026');
  });

  it('keeps the other end when one end is retyped after a quick pick', () => {
    render(<Harness />);

    fireEvent.click(quick('last-7-days'));
    fireEvent.change(field('from'), { target: { value: '01/08/2026' } });

    expect(field('to').value).toBe('11/08/2026');
    expect(lastWindow()).toEqual({ from: '2026-08-01', to: '2026-08-11' });
  });

  it('refuses a reversed pair instead of swapping it', () => {
    render(<Harness />);

    fireEvent.change(field('to'), { target: { value: '01/08/2026' } });

    expect(status()).toBe('The end date must be on or after the start date.');
    // Both fields keep what was typed — the reader fixes the end they meant,
    // rather than finding the picker has quietly reinterpreted them.
    expect(field('from').value).toBe('05/08/2026');
    expect(field('to').value).toBe('01/08/2026');
    expect(lastWindow()).toBe(null);
  });

  it('marks the fields themselves, not only the line under them', () => {
    render(<Harness />);

    fireEvent.change(field('to'), { target: { value: '01/08/2026' } });

    // Pointed at the message by id, so it is read out WITH the field rather
    // than left to be found somewhere else on the page.
    expect(field('to').getAttribute('aria-describedby')).toBe(
      screen.getByTestId(`${TEST_ID}-status`).getAttribute('id'),
    );
  });
});

describe('the calendar', () => {
  it('writes a picked range into the fields', () => {
    render(<Harness />);

    // Two clicks: the first opens a new range, the second closes it. Days 12
    // and 20 are inside August 2026 only — the grid's leading and trailing
    // cells are 26–31 July and 1–5 September.
    fireEvent.click(screen.getByTestId('calendar-date-12'));
    fireEvent.click(screen.getByTestId('calendar-date-20'));

    expect(field('from').value).toBe('12/08/2026');
    expect(field('to').value).toBe('20/08/2026');
    expect(lastWindow()).toEqual({ from: '2026-08-12', to: '2026-08-20' });
  });

  it('does not jump under the pointer that is picking in it', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('calendar-date-12'));

    // The range now starts on 12 August and the grid is showing August. A
    // control that re-anchored on every change would repaint mid-selection.
    expect(monthOnScreen()).toContain('August 2026');
  });
});

describe('the zone decides which day is today', () => {
  it('resolves the same instant to the 11th in UTC', () => {
    render(<Harness timeZone="UTC" />);

    fireEvent.click(quick('today'));

    expect(lastWindow()).toEqual({ from: '2026-08-11', to: '2026-08-11' });
  });

  it('and to the 10th in São Paulo', () => {
    render(<Harness timeZone="America/Sao_Paulo" />);

    fireEvent.click(quick('today'));

    // Same clock, same click, a different day of trading. A picker that read
    // the host's zone would report on a day the store has not started.
    expect(lastWindow()).toEqual({ from: '2026-08-10', to: '2026-08-10' });
  });
});

describe('the list and the copy are the caller’s', () => {
  it('renders a caller’s own quick ranges and nothing else', () => {
    const only = createQuickRanges({ today: 'Hoje' }).filter((range) => range.id === 'today');
    render(<Harness quickRanges={only} />);

    expect(quick('today').textContent).toBe('Hoje');
    expect(screen.queryByTestId(`${TEST_ID}-quick-this-year`)).toBe(null);
  });

  it('takes replacement copy for the fields and the messages', () => {
    render(
      <Harness
        messages={{
          from: 'Início',
          to: 'Fim',
          reversed: 'A data final deve ser igual ou posterior à inicial.',
        }}
      />,
    );

    fireEvent.change(field('to'), { target: { value: '01/08/2026' } });

    expect(status()).toBe('A data final deve ser igual ou posterior à inicial.');
    expect(screen.getByLabelText('Início')).toBe(field('from'));
  });
});

/**
 * The phone layout, which is a RENDER decision and not a stylesheet one.
 *
 * `sx` breakpoints handle the rest of the narrow tier — the quick list turning
 * from a column into a scrolling pill row, the rules changing axis — and those
 * are CSS, so jsdom has nothing to say about them and they are checked in the
 * browser. What is testable here is the one thing CSS cannot do: a second month
 * is not rendered at all below `md`, because two 280px grids do not fit on a
 * 390px screen and `display: none` would still cost the layout.
 */
describe('the picker draws one month on a narrow screen', () => {
  /** Whatever jsdom had, so a stub cannot leak into the cases above. */
  const original = { matchMedia: window.matchMedia };

  beforeEach(() => {
    // jsdom implements no `matchMedia`, so MUI falls back to "does not match"
    // and every other case in this file takes the wide path. Only the cases
    // below opt in.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original.matchMedia,
    });
  });

  it('caps a consumer asking for two months at one', () => {
    render(<Harness numberOfMonths={2} />);

    // The reports dialog asks for two, and is right to on a desktop. Here the
    // request cannot be honoured, so it is capped rather than half-drawn.
    expect(screen.getAllByTestId(/^calendar-month-/)).toHaveLength(1);
  });

  it('still offers the quick ranges — they are the fastest answer on a phone', () => {
    render(<Harness numberOfMonths={2} />);

    // The narrow layout MOVES them above the calendar; it does not drop them.
    expect(quick('today')).toBeTruthy();
    expect(screen.getByTestId(`${TEST_ID}-quick-list`)).toBeTruthy();
  });
});
