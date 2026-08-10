/**
 * The two typed ends, and the one line that says what the picker currently has.
 *
 * WHEN A TYPED DATE COMMITS: the moment it is a WHOLE, REAL day — eight digits
 * that name a date that exists. Not on every keystroke (`2026` passes through
 * `0002`, `0020` and `0202`, each a legal year, and committing those makes the
 * calendar jump to the year 20 while you are still typing) and not only on blur
 * (a reader who types a date and looks at the calendar to check it would see
 * the old month until they clicked somewhere else). Half-typed text stays in
 * the field and changes nothing; leaving the field discards it and shows what
 * the range actually is. Enter needs no special case — by the time it can be
 * pressed the date has already committed.
 *
 * The field itself is `DayBoundInput`, the masked `dd/mm/aaaa` control the data
 * views already use. Same package, imported rather than re-implemented: a
 * second masked date field is a second set of rules for what backspace does.
 */
import { Box, Typography } from '@mui/material';
import React from 'react';

import { DayBoundInput } from '../../data-display/DataViews/data-views-day-input';

import { statusMessage } from './DateRangePicker.range';
import type {
  DateRangePickerMessages,
  DateRangeDraft,
  DateRangeStatus,
  DayString,
} from './DateRangePicker.types';

export interface DateRangeFieldsProps {
  value: DateRangeDraft;
  status: DateRangeStatus;
  messages: DateRangePickerMessages;
  maxRangeDays: number | undefined;
  onEdit: (which: 'from' | 'to', bound: DayString | null) => void;
  /** Id of the status line, so both fields can point at it. */
  statusId: string;
  dataTestId: string;
}

export function DateRangeFields({
  value,
  status,
  messages,
  maxRangeDays,
  onEdit,
  statusId,
  dataTestId,
}: DateRangeFieldsProps): React.JSX.Element {
  // "Incomplete" is not an error — it is a range that is not finished yet, and
  // painting it red would make the first click on a two-click control look like
  // a mistake. The pair being impossible is what gets marked.
  const rejected = !status.ok && status.problem !== 'incomplete';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <DayBoundInput
          label={messages.from}
          value={value.from ?? undefined}
          onChange={(bound) => onEdit('from', bound ?? null)}
          testId={`${dataTestId}-from`}
          error={rejected}
          describedBy={statusId}
        />
        <DayBoundInput
          label={messages.to}
          value={value.to ?? undefined}
          onChange={(bound) => onEdit('to', bound ?? null)}
          testId={`${dataTestId}-to`}
          error={rejected}
          describedBy={statusId}
        />
      </Box>
      <Typography
        id={statusId}
        // A live region, so the reason a range was refused is spoken when it
        // appears rather than only being found by someone who goes looking.
        role="status"
        aria-live="polite"
        variant="body2"
        color={rejected ? 'error.main' : 'text.secondary'}
        data-testid={`${dataTestId}-status`}
      >
        {statusMessage(status, messages, maxRangeDays)}
      </Typography>
    </Box>
  );
}
