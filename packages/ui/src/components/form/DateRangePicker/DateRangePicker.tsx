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
import { useTheme } from '@mui/material/styles/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import React, { useRef } from 'react';

import type { CalendarLabels } from '../../../copy/labels';
import { Calendar } from '../Calendar';

import { toLocalDay } from './DateRangePicker.dates';
import { useDateRangePicker } from './DateRangePicker.hooks';
import { CALENDAR_CLASS, FLAT_CALENDAR, fieldsColumnSx, frameSx } from './DateRangePicker.frame';
import { besideLayout, useMeasuredWidth, type FieldsPlacement } from './DateRangePicker.layout';
import { DEFAULT_QUICK_RANGES } from './DateRangePicker.quick';
import type { DateRangeDraft, DateRangePickerProps, WeekStart } from './DateRangePicker.types';
import { DateRangeFields } from './DateRangePickerFields';
import { DateRangeQuickList } from './DateRangePickerQuickList';

const ROOT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 2,
  p: 2,
  maxWidth: '100%',
  ...FLAT_CALENDAR,
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
 * Below the theme's `md` the picker is a phone layout — the same breakpoint the
 * `sx` blocks here switch on. The query is a STRING built from `useTheme()`,
 * not `useMediaQuery`'s callback form: the callback reads the theme from
 * context and throws on a null one, so a consumer that mounts this outside a
 * `ThemeProvider` would crash — which the unit tests here do, and which is a
 * fair thing for a consumer to do. `useTheme()` falls back to MUI's default
 * theme there, whose `md` is the `(max-width:899.95px)` this used to spell out.
 */
function useMonthCount(requested: number | undefined): number | undefined {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  return narrow ? 1 : requested;
}

/** The grid, in range mode — `Calendar`, never a second implementation of one. */
/** The calendar options a picker passes through untouched. */
type CalendarDisplay = Pick<
  DateRangePickerProps,
  'showOutsideDays' | 'todayIndicator' | 'allowSameDayRange' | 'fullWidth' | 'disabled'
>;

/** Every day, for a picker that is `disabled`. */
const EVERY_DAY = (): boolean => true;

function RangeCalendar({
  calendarLabel,
  picker,
  value,
  locale,
  weekStartsOn,
  months,
  maxRangeDays,
  labels,
  display,
}: {
  labels: Partial<CalendarLabels> | undefined;
  display: CalendarDisplay;
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
      {...(labels ? { labels } : {})}
      showOutsideDays={display.showOutsideDays}
      todayIndicator={display.todayIndicator}
      allowSameDayRange={display.allowSameDayRange}
      fullWidth={display.fullWidth}
      {...(display.disabled === true ? { isDateDisabled: EVERY_DAY } : {})}
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

/** The typed half: the consumer's own fields, or the built-in pair and its line. */
function TypedHalf({
  props,
  picker,
  placement,
}: {
  props: DateRangePickerProps;
  picker: Picker;
  placement: FieldsPlacement;
}): React.JSX.Element {
  const disabled = props.disabled === true;
  if (props.renderFields) return <>{props.renderFields({ placement, disabled })}</>;
  return (
    <DateRangeFields
      value={props.value}
      status={picker.status}
      messages={picker.copy}
      maxRangeDays={props.maxRangeDays}
      onEdit={picker.editBound}
      statusId={picker.statusId}
      dataTestId={props.dataTestId ?? 'date-range-picker'}
      openEnd={props.openEnd ?? false}
      stacked={placement === 'beside'}
      disabled={disabled}
    />
  );
}

/**
 * How many months, and where the typed half goes. The default layout counts
 * months by the viewport, as it always did; `beside` measures the picker.
 */
function usePickerLayout(props: DateRangePickerProps): {
  root: React.RefObject<HTMLDivElement | null>;
  months: number | undefined;
  placement: FieldsPlacement;
} {
  const theme = useTheme();
  const viewportMonths = useMonthCount(props.numberOfMonths);
  const root = useRef<HTMLDivElement>(null);
  const beside = props.fieldsPlacement === 'beside';
  const width = useMeasuredWidth(root, beside);
  if (!beside || width === null) return { root, months: viewportMonths, placement: 'below' };
  const layout = besideLayout(width, props.numberOfMonths ?? 2, theme);
  return { root, months: layout.months, placement: layout.placement };
}

/** The `beside` layout: the months in their own frame, the fields on the page. */
function InPageLayout({
  props,
  picker,
  layout,
  body,
}: {
  props: DateRangePickerProps;
  picker: Picker;
  layout: ReturnType<typeof usePickerLayout>;
  body: React.ReactNode;
}): React.JSX.Element {
  const sideBySide = layout.placement === 'beside';
  return (
    <Box
      ref={layout.root}
      className={props.className}
      data-testid={props.dataTestId ?? 'date-range-picker'}
      data-fields-placement={layout.placement}
      aria-disabled={props.disabled === true ? true : undefined}
      sx={{
        display: 'flex',
        flexDirection: sideBySide ? 'row' : 'column',
        alignItems: sideBySide ? 'flex-start' : 'stretch',
        gap: sideBySide ? 4 : 2,
        width: '100%',
        minWidth: 0,
      }}
    >
      <Paper variant="outlined" sx={frameSx(sideBySide, props.fullWidth === true, layout.months ?? 1)}>
        {body}
      </Paper>
      <Box sx={fieldsColumnSx(sideBySide, props.fullWidth === true)}>
        <TypedHalf props={props} picker={picker} placement={layout.placement} />
      </Box>
    </Box>
  );
}

/** The default layout: one framed block, the typed half under the months. */
function PopoverLayout({
  props,
  picker,
  body,
}: {
  props: DateRangePickerProps;
  picker: Picker;
  body: React.ReactNode;
}): React.JSX.Element {
  const typed = <TypedHalf props={props} picker={picker} placement="below" />;
  return (
    <Paper
      className={props.className}
      data-testid={props.dataTestId ?? 'date-range-picker'}
      aria-disabled={props.disabled === true ? true : undefined}
      sx={ROOT_SX}
    >
      {body}
      {props.renderFields ? typed : <Box sx={FIELDS_DIVIDER_SX}>{typed}</Box>}
    </Paper>
  );
}

export function DateRangePicker(props: DateRangePickerProps): React.JSX.Element {
  const { value, maxRangeDays, weekStartsOn = 0, locale = 'en-US', dataTestId = 'date-range-picker' } = props;
  const picker = useDateRangePicker({
    value,
    onChange: props.onChange,
    timeZone: props.timeZone,
    now: props.now,
    maxRangeDays,
    weekStartsOn,
    quickRanges: props.quickRanges ?? DEFAULT_QUICK_RANGES,
    messages: props.messages,
    followValue: props.renderFields !== undefined,
  });
  const layout = usePickerLayout(props);

  const body = (
    <Box sx={BODY_SX}>
      <RangeCalendar
        calendarLabel={picker.copy.calendarLabel}
        picker={picker}
        value={value}
        locale={locale}
        weekStartsOn={weekStartsOn}
        months={layout.months}
        maxRangeDays={maxRangeDays}
        labels={props.calendarLabels}
        // `fullWidth` fills the in-page frame; the popover's frame is as wide
        // as its months, and a filling calendar in it spread past the quick
        // column and the typed pair (FUT-4156, round 3).
        display={{ ...props, fullWidth: props.fieldsPlacement === 'beside' && props.fullWidth === true }}
      />
      {props.disabled === true ? null : (
        <QuickColumn picker={picker} maxRangeDays={maxRangeDays} dataTestId={dataTestId} />
      )}
    </Box>
  );

  if (props.fieldsPlacement === 'beside') {
    return <InPageLayout props={props} picker={picker} layout={layout} body={body} />;
  }
  return <PopoverLayout props={props} picker={picker} body={body} />;
}

export default DateRangePicker;
