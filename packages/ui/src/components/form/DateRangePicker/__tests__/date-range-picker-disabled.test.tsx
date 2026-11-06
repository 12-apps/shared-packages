// @vitest-environment jsdom
/**
 * `disabled` (FUT-4482, review round 5): a period a consumer cannot let anyone
 * change right now — its days cannot be placed — is shown, never removed.
 * Every day of the grid is disabled and a tap writes nothing, the built-in
 * boxes are disabled, the consumer's own fields are told, and the root says it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from '../DateRangePicker';

const inMonth = (n: number): HTMLElement =>
  within(screen.getByTestId('calendar-month-0'))
    .getAllByTestId(`calendar-date-${n}`)
    .find((cell) => cell.getAttribute('data-in-month') === 'true')!;

describe('a disabled picker', () => {
  it('disables every day and writes nothing on a tap', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: null, to: null }}
        onChange={onChange}
        quickRanges={[]}
        numberOfMonths={1}
        now={new Date('2026-11-06T12:00:00Z')}
        disabled
      />,
    );
    const days = within(screen.getByTestId('calendar-month-0'))
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('data-in-month') === 'true');
    expect(days.length).toBeGreaterThan(27);
    expect(days.every((cell) => cell.getAttribute('aria-disabled') === 'true')).toBe(true);
    fireEvent.click(inMonth(10));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables the built-in boxes and says so on the root', () => {
    render(
      <DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} numberOfMonths={1} disabled />,
    );
    expect(screen.getByTestId('date-range-picker').getAttribute('aria-disabled')).toBe('true');
    const boxes = within(screen.getByTestId('date-range-picker')).getAllByRole('textbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => (box as HTMLInputElement).disabled)).toBe(true);
  });

  it('tells the consumer’s own fields, beside the months', () => {
    const renderFields = vi.fn(() => null);
    render(
      <DateRangePicker
        value={{ from: null, to: null }}
        onChange={() => {}}
        quickRanges={[]}
        fieldsPlacement="beside"
        renderFields={renderFields}
        disabled
      />,
    );
    expect(renderFields).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('date-range-picker').getAttribute('aria-disabled')).toBe('true');
  });

  it('is enabled by default', () => {
    const renderFields = vi.fn(() => null);
    render(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} renderFields={renderFields} />);
    expect(renderFields).toHaveBeenCalledWith(expect.objectContaining({ disabled: false }));
    expect(screen.getByTestId('date-range-picker').getAttribute('aria-disabled')).toBeNull();
  });

  // Review round 6 (B3): every other case passes `quickRanges={[]}`, so none
  // of them could tell a disabled picker that still offered its presets.
  it('offers no quick ranges when disabled, even the default ones', () => {
    const { rerender } = render(
      <DateRangePicker value={{ from: null, to: null }} onChange={() => {}} numberOfMonths={1} now={new Date('2026-11-06T12:00:00Z')} />,
    );
    expect(screen.getByTestId('date-range-picker-quick-today')).toBeTruthy();
    rerender(
      <DateRangePicker
        value={{ from: null, to: null }}
        onChange={() => {}}
        numberOfMonths={1}
        now={new Date('2026-11-06T12:00:00Z')}
        disabled
      />,
    );
    expect(screen.queryAllByTestId('date-range-picker-quick-today')).toHaveLength(0);
  });

  // Review round 6 (N5): `aria-disabled` is valid only with a role.
  it.each([['below', undefined], ['beside', 'beside' as const]])(
    'makes the root a named group, %s the months',
    (_where, fieldsPlacement) => {
      render(
        <DateRangePicker
          value={{ from: null, to: null }}
          onChange={() => {}}
          quickRanges={[]}
          {...(fieldsPlacement ? { fieldsPlacement } : {})}
          label="Período"
          disabled
        />,
      );
      const group = screen.getByRole('group', { name: 'Período' });
      expect(group.getAttribute('aria-disabled')).toBe('true');
      expect(group).toBe(screen.getByTestId('date-range-picker'));
    },
  );

  it('names the group by the calendar label when no label is given, and is no group enabled', () => {
    const { rerender } = render(
      <DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} messages={{ calendarLabel: 'Calendário' }} disabled />,
    );
    expect(screen.getByRole('group', { name: 'Calendário' })).toBeTruthy();
    rerender(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} messages={{ calendarLabel: 'Calendário' }} />);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });

  // Review round 6: a live arrow beside a dead grid.
  it('disables the month arrows', () => {
    const { rerender } = render(
      <DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} numberOfMonths={1} />,
    );
    expect((screen.getByTestId('calendar-prev-month') as HTMLButtonElement).disabled).toBe(false);
    rerender(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} quickRanges={[]} numberOfMonths={1} disabled />);
    expect((screen.getByTestId('calendar-prev-month') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('calendar-next-month') as HTMLButtonElement).disabled).toBe(true);
  });
});
