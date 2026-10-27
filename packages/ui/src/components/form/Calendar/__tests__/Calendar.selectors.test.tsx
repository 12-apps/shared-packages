/**
 * `captionLayout="selectors"` and `defaultMonth` (FUT-4121), and the promise
 * that a calendar given neither renders as it did before them.
 *
 * Every case pins its own month through `value`, `defaultMonth` or the bounds,
 * so none depends on the day the suite runs.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PT_BR_UI_LABELS } from '../../../../pt-BR.labels';
import { Calendar } from '../Calendar';
import type { CalendarProps } from '../Calendar.types';

// The Perfil field's window on 2026-10-27: 01/01/1900 to today minus 13 years.
const MIN = new Date(1900, 0, 1);
const MAX = new Date(2013, 9, 27);
const DEFAULT_MONTH = new Date(2001, 0, 1);

/**
 * Every date the calendar handed over, newest last. A container the harness
 * MUTATES — the flakiness gate rejects a closed-over binding reassigned from
 * inside a callback.
 */
const seen = { picked: [] as Array<Date | null> };

beforeEach(() => {
  seen.picked = [];
});

const Harness = (props: Partial<CalendarProps>) => {
  const [value, setValue] = useState<Date | null>(props.value ?? null);
  return (
    <Calendar
      ariaLabel="Data de nascimento"
      locale="pt-BR"
      captionLayout="selectors"
      defaultMonth={DEFAULT_MONTH}
      minDate={MIN}
      maxDate={MAX}
      labels={PT_BR_UI_LABELS.calendar}
      {...props}
      value={value}
      onChange={(next) => {
        seen.picked.push(next);
        setValue(next);
      }}
    />
  );
};

const monthButton = () => screen.getByTestId('calendar-month-select');
const yearButton = () => screen.getByTestId('calendar-year-select');
const dayOf = (date: Date | null | undefined) =>
  date ? [date.getFullYear(), date.getMonth(), date.getDate()] : null;

describe('Calendar without the new props', () => {
  it('keeps the title-between-arrows caption, unnamed arrows included', () => {
    render(<Calendar ariaLabel="Datas" locale="en-US" value={new Date(2026, 0, 15)} />);

    expect(screen.getByTestId('calendar-header')).toHaveTextContent('January 2026');
    expect(screen.queryAllByTestId('calendar-month-select')).toHaveLength(0);
    expect(screen.queryAllByTestId('calendar-year-select')).toHaveLength(0);
    expect(screen.getByTestId('calendar-prev-month')).not.toHaveAttribute('aria-label');
    expect(screen.getByTestId('calendar-next-month')).not.toBeDisabled();
  });

  it('still shows two months for a range', () => {
    render(<Calendar ariaLabel="Datas" locale="en-US" selectionMode="range" range={{ start: new Date(2026, 0, 15) }} />);

    expect(screen.getAllByTestId('calendar-grid')).toHaveLength(2);
    expect(screen.getByTestId('calendar-month-1')).toHaveTextContent('February 2026');
  });
});

describe('defaultMonth', () => {
  it('opens on the default month when nothing is chosen', () => {
    render(<Calendar ariaLabel="Datas" locale="en-US" defaultMonth={DEFAULT_MONTH} />);
    expect(screen.getByTestId('calendar-header')).toHaveTextContent('January 2001');
  });

  it('gives way to a chosen value', () => {
    render(<Calendar ariaLabel="Datas" locale="en-US" defaultMonth={DEFAULT_MONTH} value={new Date(1990, 2, 14)} />);
    expect(screen.getByTestId('calendar-header')).toHaveTextContent('March 1990');
  });

  it('gives way to a range start', () => {
    render(
      <Calendar ariaLabel="Datas" locale="en-US" selectionMode="range" defaultMonth={DEFAULT_MONTH} range={{ start: new Date(1990, 2, 14) }} />,
    );
    expect(screen.getByTestId('calendar-month-0')).toHaveTextContent('March 1990');
  });
});

describe('captionLayout="selectors"', () => {
  it('names its buttons and says which grid is open', () => {
    render(<Harness />);

    expect(monthButton()).toHaveAccessibleName('Janeiro, escolher mês');
    expect(yearButton()).toHaveAccessibleName('2001, escolher ano');
    expect(yearButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('calendar-prev-month')).toHaveAccessibleName('Mês anterior');
    expect(screen.getByTestId('calendar-next-month')).toHaveAccessibleName('Próximo mês');

    fireEvent.click(yearButton());

    expect(yearButton()).toHaveAttribute('aria-expanded', 'true');
    const years = screen.getByRole('group', { name: 'Anos' });
    expect(yearButton()).toHaveAttribute('aria-controls', years.id);
    expect(screen.queryAllByTestId('calendar-grid')).toHaveLength(0);
  });

  it('falls back to the English names without labels', () => {
    render(<Harness labels={undefined} locale="en-US" />);

    expect(monthButton()).toHaveAccessibleName('January, choose month');
    expect(yearButton()).toHaveAccessibleName('2001, choose year');
  });

  it('shows one month even when asked for more', () => {
    render(<Harness numberOfMonths={2} />);
    expect(screen.getAllByTestId('calendar-grid')).toHaveLength(1);
  });

  it('picks 14/03/1990 in five taps: year, 1990, month, mar, 14', () => {
    render(<Harness />);

    fireEvent.click(yearButton());
    fireEvent.click(screen.getByTestId('calendar-years-1990'));
    expect(yearButton()).toHaveTextContent('1990');
    expect(monthButton()).toHaveTextContent('Janeiro');

    fireEvent.click(monthButton());
    fireEvent.click(screen.getByTestId('calendar-months-2'));
    expect(monthButton()).toHaveTextContent('Março');

    fireEvent.click(within(screen.getByTestId('calendar-grid')).getByText('14'));
    expect(dayOf(seen.picked.at(-1))).toEqual([1990, 2, 14]);
  });

  it('lists the years newest first, from the ceiling to the floor, the shown one current', async () => {
    render(<Harness />);
    fireEvent.click(yearButton());

    const years = within(screen.getByRole('group', { name: 'Anos' })).getAllByRole('button');
    expect(years[0]).toHaveTextContent('2013');
    expect(years.at(-1)).toHaveTextContent('1900');
    expect(screen.getByTestId('calendar-years-2001')).toHaveAttribute('aria-current', 'true');
    // Opening the grid puts focus on the shown year.
    await waitFor(() => expect(screen.getByTestId('calendar-years-2001')).toHaveFocus());
  });

  it('disables the months after the ceiling and ignores a tap on one', () => {
    render(<Harness defaultMonth={new Date(2013, 0, 1)} />);
    fireEvent.click(monthButton());

    expect(screen.getByTestId('calendar-months-9')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('calendar-months-10')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByTestId('calendar-months-10'));
    expect(screen.getByRole('group', { name: 'Meses' })).toBeInTheDocument();
    expect(monthButton()).toHaveTextContent('Janeiro');
  });

  it('pulls the month inside the bounds when the picked year cannot show it', () => {
    render(<Harness defaultMonth={new Date(2001, 11, 1)} />);

    fireEvent.click(yearButton());
    fireEvent.click(screen.getByTestId('calendar-years-2013'));

    expect(monthButton()).toHaveTextContent('Outubro');
  });

  it('shows the days past the ceiling disabled, and the arrows stop at both ends', () => {
    const { unmount } = render(<Harness defaultMonth={new Date(2013, 9, 1)} />);

    const grid = screen.getByTestId('calendar-grid');
    expect(within(grid).getByText('27')).toHaveAttribute('aria-disabled', 'false');
    expect(within(grid).getByText('28')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('calendar-next-month')).toBeDisabled();
    expect(screen.getByTestId('calendar-prev-month')).not.toBeDisabled();
    unmount();

    render(<Harness defaultMonth={new Date(1900, 0, 1)} />);
    expect(screen.getByTestId('calendar-prev-month')).toBeDisabled();
  });

  it('goes back to the days when an arrow is used with a grid open', () => {
    render(<Harness />);
    fireEvent.click(monthButton());
    fireEvent.click(screen.getByTestId('calendar-next-month'));

    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
    expect(monthButton()).toHaveTextContent('Fevereiro');
  });

  it('lists a shown year past the bounds, disabled, so the list still holds where you are', () => {
    render(<Harness defaultMonth={new Date(2020, 0, 1)} />);
    fireEvent.click(yearButton());

    expect(screen.getByTestId('calendar-years-2020')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('calendar-years-2013')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByTestId('calendar-years-2020'));
    expect(screen.getByRole('group', { name: 'Anos' })).toBeInTheDocument();
  });

  it('closes a grid when its own button is pressed again', () => {
    render(<Harness />);
    fireEvent.click(monthButton());
    fireEvent.click(monthButton());

    expect(monthButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
  });
});

describe('captionLayout="selectors" from the keyboard', () => {
  it('moves through the year grid, picks, and lands focus on the day grid', async () => {
    render(<Harness />);
    fireEvent.click(yearButton());

    const years = screen.getByRole('group', { name: 'Anos' });
    // Newest first: one to the right is a year earlier, one row down four.
    fireEvent.keyDown(years, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('calendar-years-2000')).toHaveFocus());
    fireEvent.keyDown(years, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('calendar-years-1996')).toHaveFocus());
    expect(screen.getByTestId('calendar-years-1996')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('calendar-years-2001')).toHaveAttribute('tabindex', '-1');

    fireEvent.click(screen.getByTestId('calendar-years-1996'));

    expect(yearButton()).toHaveTextContent('1996');
    // The month's first day is the grid's one tab stop, and it has focus.
    const firstDay = within(screen.getByTestId('calendar-grid'))
      .getAllByRole('gridcell')
      .find((cell) => cell.tabIndex === 0);
    expect(firstDay).toHaveTextContent('1');
    await waitFor(() => expect(firstDay).toHaveFocus());
  });

  it('moves through the month grid by rows of three', async () => {
    render(<Harness />);
    fireEvent.click(monthButton());

    await waitFor(() => expect(screen.getByTestId('calendar-months-0')).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('group', { name: 'Meses' }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('calendar-months-3')).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('group', { name: 'Meses' }), { key: 'End' });
    await waitFor(() => expect(screen.getByTestId('calendar-months-11')).toHaveFocus());
  });

  it('leaves a grid on Escape with nothing changed and focus on its button', async () => {
    render(<Harness />);
    fireEvent.click(yearButton());

    const years = screen.getByRole('group', { name: 'Anos' });
    fireEvent.keyDown(years, { key: 'ArrowRight' });
    fireEvent.keyDown(years, { key: 'Escape' });

    await waitFor(() => expect(yearButton()).toHaveFocus());
    expect(yearButton()).toHaveTextContent('2001');
    expect(yearButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('hands Escape on a caption button to the host while no grid is open', () => {
    const escapes = { count: 0 };
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escapes.count += 1;
        }}
      >
        <Harness />
      </div>,
    );

    fireEvent.keyDown(yearButton(), { key: 'Escape' });
    fireEvent.keyDown(screen.getByTestId('calendar-next-month'), { key: 'Escape' });

    expect(escapes.count).toBe(2);
  });

  it('keeps Escape from the host while it closes a grid', async () => {
    const escapes = { count: 0 };
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escapes.count += 1;
        }}
      >
        <Harness />
      </div>,
    );

    fireEvent.click(monthButton());
    fireEvent.keyDown(monthButton(), { key: 'Escape' });

    expect(escapes.count).toBe(0);
    await waitFor(() => expect(monthButton()).toHaveAttribute('aria-expanded', 'false'));
  });

  it('closes a grid on Escape from a caption button too', async () => {
    render(<Harness />);
    fireEvent.click(monthButton());
    fireEvent.keyDown(yearButton(), { key: 'Escape' });

    expect(monthButton()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(monthButton()).toHaveFocus());
  });

  it('keeps the day keys in the day view, Shift+PageUp a year back', () => {
    render(<Harness />);
    const container = screen.getByTestId('calendar-container');

    fireEvent.keyDown(container, { key: 'PageDown' });
    expect(monthButton()).toHaveTextContent('Fevereiro');
    fireEvent.keyDown(container, { key: 'PageUp', shiftKey: true });
    expect(yearButton()).toHaveTextContent('2000');
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    fireEvent.keyDown(container, { key: 'Enter' });

    expect(dayOf(seen.picked.at(-1))).toEqual([2000, 1, 2]);
  });

  it('lets Enter on a caption button be the button, not a day pick', () => {
    render(<Harness />);
    fireEvent.keyDown(monthButton(), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('calendar-prev-month'), { key: 'ArrowRight' });

    expect(seen.picked).toHaveLength(0);
  });

  it('does not let a key in a pick grid reach the hidden days', () => {
    render(<Harness />);
    fireEvent.click(monthButton());
    fireEvent.keyDown(screen.getByRole('group', { name: 'Meses' }), { key: 'PageDown' });

    expect(monthButton()).toHaveTextContent('Janeiro');
    expect(seen.picked).toHaveLength(0);
  });
});
