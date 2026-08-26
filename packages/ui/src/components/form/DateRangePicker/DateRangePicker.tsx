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
import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { Calendar } from '../Calendar';

import { toLocalDay } from './DateRangePicker.dates';
import { useDateRangePicker } from './DateRangePicker.hooks';
import { DEFAULT_QUICK_RANGES } from './DateRangePicker.quick';
import type { DateRangeDraft, DateRangePickerProps, WeekStart } from './DateRangePicker.types';
import { DateRangeFields } from './DateRangePickerFields';
import { DateRangeQuickList } from './DateRangePickerQuickList';

const CALENDAR_CLASS = 'date-range-picker__calendar';

/** Below this the picker is a phone layout. MUI's own `md`, written out. */
const NARROW_QUERY = '(max-width:899.95px)';

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
  // The quick column sits BESIDE the calendar on a wide screen. Narrow, it
  // moves ABOVE it — `column-reverse`, so the DOM order stays calendar-then-
  // list (the calendar is the primary control and should be reached first by a
  // screen reader and by Tab) while the eye meets the quick ranges first, which
  // is the order the phone mock asks for and the order a thumb wants: nine
  // one-tap answers before a grid of thirty.
  //
  // A side column at 390px would squeeze the day grid to roughly half its width
  // and make the numbers unreadable. Checked at 390px.
  flexDirection: { xs: 'column-reverse', md: 'row' },
  alignItems: { xs: 'stretch', md: 'flex-start' },
  gap: 2,
  maxWidth: '100%',
};

/**
 * The rule between the calendar and the quick ranges.
 *
 * Two lists of dates side by side with only whitespace between them read as one
 * ragged thing; the rule says which numbers belong to which control. It turns
 * with the layout — a vertical rule when the list is a column beside the
 * calendar, a horizontal one when it has moved above it — because a divider
 * that keeps its axis while the flex direction flips ends up separating nothing.
 */
const QUICK_DIVIDER_SX: SxProps<Theme> = {
  borderColor: 'divider',
  borderStyle: 'solid',
  borderWidth: 0,
  borderLeftWidth: { xs: 0, md: '1px' },
  borderBottomWidth: { xs: '1px', md: 0 },
  pl: { xs: 0, md: 2 },
  pb: { xs: 2, md: 0 },
  alignSelf: 'stretch',
};

/** And the rule above the typed pair, which is a third way in, not a caption. */
const FIELDS_DIVIDER_SX: SxProps<Theme> = {
  borderTop: '1px solid',
  borderColor: 'divider',
  pt: 2,
};

type Picker = ReturnType<typeof useDateRangePicker>;

/**
 * How many months to draw.
 *
 * A month grid has a floor: seven columns that must stay legible, which is
 * about 280px. Two of them need 580, so on a phone the consumer's
 * `numberOfMonths` is not a preference that can be honoured — it is a request
 * for a layout that does not fit. Capped here rather than left to the consumer,
 * because the consumer chooses for its own reason (the reports dialog wants two
 * because a period often crosses a month boundary) and has no way to know the
 * picker is currently 390px wide.
 *
 * A media query rather than an `sx` breakpoint: this decides what to RENDER,
 * and CSS cannot un-render a second month.
 *
 * The query is a LITERAL, not `theme.breakpoints.down('md')`. The callback form
 * reads the theme from context and throws on a null one, so a consumer that
 * mounts this outside a `ThemeProvider` would crash — which the unit tests here
 * do, and which is a fair thing for a consumer to do.
 */
function useMonthCount(requested: number | undefined): number | undefined {
  const narrow = useMediaQuery(NARROW_QUERY);
  return narrow ? 1 : requested;
}

/** The grid, in range mode — `Calendar`, never a second implementation of one. */
function RangeCalendar({
  calendarLabel,
  picker,
  value,
  locale,
  weekStartsOn,
  months,
  maxRangeDays,
}: {
  picker: Picker;
  value: DateRangeDraft;
  locale: string;
  weekStartsOn: WeekStart;
  months: number | undefined;
  maxRangeDays: number | undefined;
  calendarLabel: string;
}): React.JSX.Element {
  return (
    <Calendar
      key={picker.viewNonce}
      ariaLabel={calendarLabel}
      className={CALENDAR_CLASS}
      selectionMode="range"
      locale={locale}
      // One prop drives the grid's first column AND the day "this week" starts
      // on, so a highlighted week can never begin mid-row.
      firstDayOfWeek={weekStartsOn}
      numberOfMonths={months}
      range={{ start: toLocalDay(value.from), end: toLocalDay(value.to) }}
      // BOTH callbacks, and the intermediate one does the work: the other fires
      // only on the click that CLOSES a range, so a picker wired to it alone
      // would not repaint after the first click.
      onIntermediateRangeChange={picker.pickOnCalendar}
      onRangeChange={picker.pickOnCalendar}
      // The same ceiling the quick list is judged against, so the calendar
      // cannot hand back a window the control has just called too long.
      maxRangeLength={maxRangeDays}
    />
  );
}

/** The quick ranges, inside the rule that separates them from the grid. */
function QuickColumn({
  picker,
  maxRangeDays,
  dataTestId,
}: {
  picker: Picker;
  maxRangeDays: number | undefined;
  dataTestId: string;
}): React.JSX.Element | null {
  if (picker.options.length === 0) return null;
  return (
    <Box sx={QUICK_DIVIDER_SX}>
      <DateRangeQuickList
        options={picker.options}
        activeId={picker.activeId}
        onPick={picker.pickQuick}
        reasonFor={(option) =>
          picker.copy.overMax({ maxRangeDays: maxRangeDays ?? option.days, days: option.days })
        }
        label={picker.copy.quickRanges}
        dataTestId={dataTestId}
      />
    </Box>
  );
}

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
  const months = useMonthCount(numberOfMonths);

  return (
    <Paper className={className} data-testid={dataTestId} sx={ROOT_SX}>
      <Box sx={BODY_SX}>
        <RangeCalendar
          calendarLabel={picker.copy.calendarLabel}
          picker={picker}
          value={value}
          locale={locale}
          weekStartsOn={weekStartsOn}
          months={months}
          maxRangeDays={maxRangeDays}
        />
        <QuickColumn picker={picker} maxRangeDays={maxRangeDays} dataTestId={dataTestId} />
      </Box>
      <Box sx={FIELDS_DIVIDER_SX}>
        <DateRangeFields
          value={value}
          status={picker.status}
          messages={picker.copy}
          maxRangeDays={maxRangeDays}
          onEdit={picker.editBound}
          statusId={picker.statusId}
          dataTestId={dataTestId}
        />
      </Box>
    </Paper>
  );
}

export default DateRangePicker;
