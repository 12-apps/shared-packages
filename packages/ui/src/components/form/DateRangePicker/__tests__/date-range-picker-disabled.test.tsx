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
});
