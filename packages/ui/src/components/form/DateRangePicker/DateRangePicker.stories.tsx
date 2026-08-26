import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { DateRangePicker } from './DateRangePicker';
import { createQuickRanges } from './DateRangePicker.quick';
import type { DateRangeChangeMeta, DateRangeDraft } from './DateRangePicker.types';

/**
 * Every story pins the clock. "Today" is the axis all nine quick ranges turn
 * on, so a story that read the real date would render a different picture every
 * morning and no visual snapshot of it would ever settle.
 */
const NOW = new Date('2026-08-10T15:00:00.000Z');
const SEED: DateRangeDraft = { from: '2026-08-03', to: '2026-08-10' };

const meta: Meta<typeof DateRangePicker> = {
  title: 'Form/DateRangePicker',
  component: DateRangePicker,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Three views of one day range — a range calendar, a quick-pick column and two typed `dd/mm/aaaa` fields. Change any and the other two follow. It knows nothing about the data behind the range: the quick list, the maximum length and the time zone "today" is read on are all props.',
      },
    },
  },
  tags: ['autodocs', 'component:DateRangePicker'],
  argTypes: {
    timeZone: { control: 'text', description: 'IANA zone TODAY is read on' },
    maxRangeDays: { control: 'number', description: 'Longest usable range, inclusive days' },
    weekStartsOn: { control: 'number', description: '0 = Sunday … 6 = Saturday' },
    numberOfMonths: { control: 'number', description: 'Months side by side' },
    locale: { control: 'text', description: 'Month names and weekday initials' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

type DemoProps = Partial<React.ComponentProps<typeof DateRangePicker>> & {
  initial?: DateRangeDraft;
};

/** The picker is controlled, so every story needs somewhere to keep the range. */
function Demo({ initial = SEED, ...props }: DemoProps): React.ReactElement {
  const [value, setValue] = useState<DateRangeDraft>(initial);
  const [meta, setMeta] = useState<DateRangeChangeMeta | null>(null);

  return (
    <Stack spacing={1} alignItems="flex-start">
      <DateRangePicker
        {...props}
        value={value}
        onChange={(next, changeMeta) => {
          setValue(next);
          setMeta(changeMeta);
        }}
        now={props.now ?? NOW}
      />
      <Typography variant="caption" color="text.secondary">
        {meta
          ? `${meta.source}${meta.quickRangeId ? ` (${meta.quickRangeId})` : ''} → ${
              meta.status.ok ? `${meta.status.window.from} … ${meta.status.window.to}` : meta.status.problem
            }`
          : 'Nothing picked yet.'}
      </Typography>
    </Stack>
  );
}

/** Two months, the built-in quick ranges, no ceiling. */
export const Default: Story = { render: () => <Demo /> };

/** One month, for a dialog that has no room for two. */
export const SingleMonth: Story = { render: () => <Demo numberOfMonths={1} /> };

/**
 * A cap the quick list is judged against: "This year" and "Last 365 days" are
 * offered, disabled, and carry the reason — never silently shortened.
 */
export const WithMaximumLength: Story = { render: () => <Demo maxRangeDays={31} /> };

/** Half a range: the picker says what is missing and reports no window. */
export const HalfChosen: Story = {
  render: () => <Demo initial={{ from: '2026-08-03', to: null }} />,
};

/** An impossible pair. The fields keep what was typed; the message explains. */
export const ReversedRange: Story = {
  render: () => <Demo initial={{ from: '2026-08-20', to: '2026-08-03' }} />,
};

/**
 * The reports surface's configuration: Portuguese copy, the tenant's zone, one
 * month, and the server's own 366-day ceiling.
 */
export const PortugueseWithTenantZone: Story = {
  render: () => (
    <Demo
      numberOfMonths={1}
      locale="pt-BR"
      timeZone="America/Sao_Paulo"
      maxRangeDays={366}
      quickRanges={createQuickRanges({
        today: 'Hoje',
        yesterday: 'Ontem',
        'this-week': 'Esta semana',
        'last-7-days': '7 dias',
        'this-month': 'Este mês',
        'last-30-days': '30 dias',
        'this-quarter': 'Este trimestre',
        'this-year': 'Este ano',
        'last-365-days': '365 dias',
      })}
      messages={{
        from: 'Data inicial',
        to: 'Data final',
        quickRanges: 'Períodos rápidos',
        incomplete: 'Escolha as duas datas.',
        reversed: 'A data final deve ser igual ou posterior à inicial.',
        overMax: ({ maxRangeDays }) => `O período não pode exceder ${maxRangeDays} dias.`,
      }}
    />
  ),
};

/** A week that starts on Monday — the grid and "this week" move together. */
export const MondayWeekStart: Story = {
  render: () => <Demo weekStartsOn={1} locale="en-GB" numberOfMonths={1} />,
};

/** A caller's own list replaces the built-in one wholesale. */
export const CallerSuppliedRanges: Story = {
  render: () => (
    <Demo
      numberOfMonths={1}
      quickRanges={[
        {
          id: 'black-friday-2025',
          label: 'Black Friday 2025',
          resolve: () => ({ from: '2025-11-28', to: '2025-11-30' }),
        },
        {
          id: 'december-2025',
          label: 'December 2025',
          resolve: () => ({ from: '2025-12-01', to: '2025-12-31' }),
        },
      ]}
    />
  ),
};

/** No quick column at all: an empty list leaves the calendar and the fields. */
export const WithoutQuickRanges: Story = {
  render: () => <Demo numberOfMonths={1} quickRanges={[]} />,
};

/**
 * A phone. The quick entries wrap ABOVE nothing and stack UNDER the calendar
 * rather than taking a column out of the day grid — at 390px a side column
 * leaves the numbers unreadable.
 */
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => (
    <Stack sx={{ width: 390, border: '1px dashed', borderColor: 'divider', p: 1 }}>
      <Demo numberOfMonths={1} />
    </Stack>
  ),
};
