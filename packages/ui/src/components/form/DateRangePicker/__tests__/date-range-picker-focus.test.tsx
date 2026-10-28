// @vitest-environment jsdom
/**
 * Where focus goes after a key pressed on a day, in the two-month range grid.
 *
 * The day the keyboard is on is drawn TWICE when the months sit side by side:
 * as a day of its own month, and as an outside day in the month before. Focus
 * that follows the tab stop must land on the first of those, and must not move
 * at all when the key did not move the day (Enter picks where you are).
 * FUT-4144's first cut took the first match in the document — the muted copy in
 * the left grid — so Enter on the 2nd of the right month threw focus left.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DateRangePicker } from '../DateRangePicker';
import type { DateRangeDraft } from '../DateRangePicker.types';

const NOW = new Date('2026-09-15T15:00:00.000Z');

/** The newest draft the picker reported; mutated, never reassigned (flakiness gate). */
const seen = { drafts: [] as DateRangeDraft[] };
const seenLast = (): DateRangeDraft | undefined => seen.drafts[seen.drafts.length - 1];

function Harness(): React.JSX.Element {
  const [value, setValue] = useState<DateRangeDraft>({ from: '2026-09-10', to: '2026-09-12' });
  return (
    <DateRangePicker
      value={value}
      onChange={(next) => {
        seen.drafts.push(next);
        setValue(next);
      }}
      now={NOW}
      timeZone="UTC"
      locale="pt-BR"
      numberOfMonths={2}
      dataTestId="drp"
    />
  );
}

const rightDay = (name: string): HTMLElement =>
  within(screen.getByTestId('calendar-month-1')).getByRole('gridcell', { name });

describe('DateRangePicker — focus in the two-month grid (FUT-4144)', () => {
  it('keeps focus on the day Enter was pressed on, in the right month', async () => {
    render(<Harness />);
    // Setembro | outubro, outside days shown: "2 de outubro" is drawn in both.
    expect(within(screen.getByTestId('calendar-month-0')).getByRole('gridcell', { name: '2 de outubro de 2026' })).toBeInTheDocument();

    fireEvent.click(rightDay('2 de outubro de 2026'));

    // Enter re-picks the day it is on and moves nothing, so focus must not be
    // moved at all — not to the muted "2 de outubro" in setembro's grid.
    fireEvent.keyDown(rightDay('2 de outubro de 2026'), { key: 'Enter' });

    await waitFor(() => expect(document.body).toHaveFocus());
    expect(seenLast()).toEqual({ from: '2026-10-02', to: '2026-10-02' });
  });

  it('moves focus to the day of its own month when an arrow lands on one drawn twice', async () => {
    render(<Harness />);
    fireEvent.click(rightDay('1 de outubro de 2026'));

    fireEvent.keyDown(rightDay('1 de outubro de 2026'), { key: 'ArrowRight' });

    // The view may follow the day into its month; wherever October now sits,
    // focus is on ITS 2nd, never on a muted copy in another month's grid.
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('aria-label', '2 de outubro de 2026');
      expect(document.activeElement).toHaveAttribute('data-in-month', 'true');
    });
  });
});
