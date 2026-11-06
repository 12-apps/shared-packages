// @vitest-environment jsdom
/**
 * A calendar inside a `<form>` picks days; it never submits the form.
 *
 * Its days and its month/year picker are `<button>`s, and a button with no
 * `type` inside a form is a SUBMIT button: every tap on a day sent the form
 * around it (found with the discount form's always-open period, FUT-4156).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Calendar } from '../Calendar';

describe('a Calendar inside a form', () => {
  it('does not submit the form when a day is picked', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const pick = vi.fn();
    render(
      <form onSubmit={submit}>
        <Calendar
          ariaLabel="Calendar"
          selectionMode="single"
          defaultMonth={new Date(2026, 10, 1)}
          onChange={pick}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole('gridcell', { name: 'November 12, 2026' }));

    expect(pick).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('marks every day as a plain button', () => {
    render(<Calendar ariaLabel="Calendar" selectionMode="range" defaultMonth={new Date(2026, 10, 1)} />);

    const days = screen.getAllByRole('gridcell');
    expect(days.length).toBeGreaterThan(27);
    expect(days.every((day) => day.getAttribute('type') === 'button')).toBe(true);
  });
});
