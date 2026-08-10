'use client';

/**
 * Three views of ONE range: a calendar, a quick-pick column, and two typed
 * dates. Change any and the other two follow.
 *
 * WHY IT EXISTS: a range calendar alone makes "this quarter" cost two clicks,
 * a month of paging, and a mental note of which day a quarter starts on; a list
 * of presets alone cannot express "the 3rd to the 19th"; and typed fields alone
 * make you spell out a window you can see. Each of the three is the fastest
 * route to a different range, so the control offers all three over one value
 * rather than picking a favourite.
 *
 * WHAT IT DOES NOT KNOW: anything about the data behind the range. No preset
 * list of a product's own, no ceiling of its own, no notion of whose clock
 * "today" runs on — `quickRanges`, `maxRangeDays` and `timeZone` are props, and
 * a consumer that needs its own periods passes them rather than teaching this
 * file about its domain. The calendar is `Calendar` in `selectionMode="range"`,
 * not a second implementation of one.
 *
 * The value is a DRAFT (`{ from, to }`, either end possibly null) rather than a
 * finished window, so a half-picked or impossible range has somewhere to live
 * while it is being fixed. Every `onChange` carries the verdict with it.
 */
import { Box, Paper } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import React from 'react';

import { Calendar } from '../Calendar';

import { toLocalDay } from './DateRangePicker.dates';
import { useDateRangePicker } from './DateRangePicker.hooks';
import { DEFAULT_QUICK_RANGES } from './DateRangePicker.quick';
import type { DateRangePickerProps } from './DateRangePicker.types';
import { DateRangeFields } from './DateRangePickerFields';
import { DateRangeQuickList } from './DateRangePickerQuickList';

const CALENDAR_CLASS = 'date-range-picker__calendar';

const ROOT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 2,
  p: 2,
  maxWidth: '100%',
  // `Calendar` renders its own `Paper` with 24px of padding. Nested in this one
  // that reads as a box inside a box, so the inner frame is flattened here
  // through the className hook the component exposes for exactly this.
  [`& .${CALENDAR_CLASS}`]: {
    p: 0,
    boxShadow: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
};

const BODY_SX: SxProps<Theme> = {
  display: 'flex',
  // The quick column sits BESIDE the calendar and drops UNDER it when there is
  // no room for both. At 390px a side column would squeeze the day grid to
  // roughly half its width and make the numbers unreadable; stacking keeps the
  // grid whole and costs a scroll. Checked at 390px.
  flexDirection: { xs: 'column', md: 'row' },
  alignItems: 'flex-start',
  gap: 2,
  maxWidth: '100%',
  overflowX: 'auto',
};

export function DateRangePicker({
  value,
  onChange,
  timeZone,
  now,
  maxRangeDays,
  weekStartsOn = 0,
  quickRanges = DEFAULT_QUICK_RANGES,
  locale = 'en-US',
  numberOfMonths,
  messages,
  dataTestId = 'date-range-picker',
  className,
}: DateRangePickerProps): React.JSX.Element {
  const picker = useDateRangePicker({
    value,
    onChange,
    timeZone,
    now,
    maxRangeDays,
    weekStartsOn,
    quickRanges,
    messages,
  });

  return (
    <Paper className={className} data-testid={dataTestId} sx={ROOT_SX}>
      <Box sx={BODY_SX}>
        <Calendar
          key={picker.viewNonce}
          className={CALENDAR_CLASS}
          selectionMode="range"
          locale={locale}
          // One prop drives the grid's first column AND the day "this week"
          // starts on, so a highlighted week can never begin mid-row.
          firstDayOfWeek={weekStartsOn}
          numberOfMonths={numberOfMonths}
          range={{ start: toLocalDay(value.from), end: toLocalDay(value.to) }}
          // BOTH callbacks, and the intermediate one does the work: the other
          // fires only on the click that CLOSES a range, so a picker wired to
          // it alone would not repaint after the first click.
          onIntermediateRangeChange={picker.pickOnCalendar}
          onRangeChange={picker.pickOnCalendar}
          // The same ceiling the quick list is judged against, so the calendar
          // cannot hand back a window the control has just called too long.
          maxRangeLength={maxRangeDays}
        />
        {picker.options.length > 0 && (
          <DateRangeQuickList
            options={picker.options}
            activeId={picker.activeId}
            onPick={picker.pickQuick}
            reasonFor={(option) =>
              picker.copy.overMax({
                maxRangeDays: maxRangeDays ?? option.days,
                days: option.days,
              })
            }
            label={picker.copy.quickRanges}
            dataTestId={dataTestId}
          />
        )}
      </Box>
      <DateRangeFields
        value={value}
        status={picker.status}
        messages={picker.copy}
        maxRangeDays={maxRangeDays}
        onEdit={picker.editBound}
        statusId={picker.statusId}
        dataTestId={dataTestId}
      />
    </Paper>
  );
}

export default DateRangePicker;
