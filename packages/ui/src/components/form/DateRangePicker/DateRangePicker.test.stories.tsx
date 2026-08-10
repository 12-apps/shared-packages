import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { DateRangePicker } from './DateRangePicker';
import type { DateRangeDraft } from './DateRangePicker.types';

/** 02:00 UTC on the 11th — still the 10th in São Paulo. */
const NOW = new Date('2026-08-11T02:00:00.000Z');
const SEED: DateRangeDraft = { from: '2026-08-05', to: '2026-08-12' };
const TEST_ID = 'drp';

const meta: Meta<typeof DateRangePicker> = {
  title: 'Form/DateRangePicker/Tests',
  component: DateRangePicker,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
    docs: {
      description: {
        component:
          'Test stories for the three views over one range: the quick column, the typed fields and the calendar, plus the cap that refuses rather than clamps.',
      },
    },
  },
  tags: ['autodocs', 'test'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

type HarnessProps = Partial<React.ComponentProps<typeof DateRangePicker>> & {
  initial?: DateRangeDraft;
};

/** Controlled the way a caller controls it, on a frozen clock. */
function Harness({ initial = SEED, ...props }: HarnessProps): React.ReactElement {
  const [value, setValue] = useState<DateRangeDraft>(initial);
  return (
    <DateRangePicker
      timeZone="UTC"
      // One month while a story clicks days: `Calendar` gives every cell the
      // testid `calendar-date-<day>`, so a second month puts two of each in the
      // canvas.
      numberOfMonths={1}
      dataTestId={TEST_ID}
      {...props}
      value={value}
      onChange={setValue}
      now={props.now ?? NOW}
    />
  );
}

// 1. The quick column

export const QuickRangeFillsBothFields: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId(`${TEST_ID}-quick-this-month`));

    await expect(canvas.getByTestId(`${TEST_ID}-from`)).toHaveValue('01/08/2026');
    await expect(canvas.getByTestId(`${TEST_ID}-to`)).toHaveValue('11/08/2026');
  },
};

export const QuickRangeShowsAsPressed: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId(`${TEST_ID}-quick-this-quarter`));

    await expect(canvas.getByTestId(`${TEST_ID}-quick-this-quarter`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};

export const QuickRangeIsKeyboardOperable: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const entry = canvas.getByTestId(`${TEST_ID}-quick-yesterday`);

    // A real button: Enter activates it without a pointer ever being involved.
    // Focus here is the ACTION, not a state being asserted — the assertion
    // below is on the value the keypress produced.
    // eslint-disable-next-line test-flakiness/no-focus-check -- focusing is the action under test
    entry.focus();
    await userEvent.keyboard('{Enter}');

    await expect(canvas.getByTestId(`${TEST_ID}-from`)).toHaveValue('10/08/2026');
  },
};

// 2. The cap

export const OverCapEntryIsDisabledWithItsReason: Story = {
  render: () => <Harness maxRangeDays={30} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const entry = canvas.getByTestId(`${TEST_ID}-quick-this-year`);

    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).toHaveTextContent('30 days');

    await userEvent.click(entry);
    // Refused, not shortened: the range on screen is untouched.
    await expect(canvas.getByTestId(`${TEST_ID}-from`)).toHaveValue('05/08/2026');
  },
};

// 3. The typed fields

export const TypedDateMovesTheCalendar: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const from = canvas.getByTestId(`${TEST_ID}-from`);

    await userEvent.clear(from);
    await userEvent.type(from, '03032026');

    await expect(canvas.getByTestId('calendar-header')).toHaveTextContent('March 2026');
  },
};

export const ReversedRangeIsRefused: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const to = canvas.getByTestId(`${TEST_ID}-to`);

    await userEvent.clear(to);
    await userEvent.type(to, '01082026');

    await expect(canvas.getByTestId(`${TEST_ID}-status`)).toHaveTextContent('on or after');
  },
};

// 4. The calendar

export const CalendarPickWritesTheFields: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId('calendar-date-12'));
    await userEvent.click(canvas.getByTestId('calendar-date-20'));

    await expect(canvas.getByTestId(`${TEST_ID}-from`)).toHaveValue('12/08/2026');
    await expect(canvas.getByTestId(`${TEST_ID}-to`)).toHaveValue('20/08/2026');
  },
};

// 5. The zone

export const ZoneDecidesWhichDayIsToday: Story = {
  render: () => <Harness timeZone="America/Sao_Paulo" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId(`${TEST_ID}-quick-today`));

    // 02:00 UTC on the 11th is still the 10th for the store being reported on.
    await expect(canvas.getByTestId(`${TEST_ID}-from`)).toHaveValue('10/08/2026');
  },
};
