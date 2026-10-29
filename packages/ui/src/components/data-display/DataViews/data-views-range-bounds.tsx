'use client';

/**
 * The `De`/`Até` pair of a range filter, its preset chips, the line under it
 * and — for a day range — the calendar under that (FUT-4144). Shared by the
 * pill's popover, the slide-in panel and the "Mais" sheet, so the three cannot
 * drift on what a bound accepts or how it clears.
 */
import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useState } from 'react';

import { useDataViewsCopy } from './data-views-copy-context';
import { DayBoundInput } from './data-views-day-input';
import { NumberBoundInput } from './data-views-number-input';
import { RangePresets } from './data-views-preset-chips';
import { DayRangeCalendar } from './data-views-range-calendar';
import { presetsFor } from './data-views-range-presets';
import { useOutsideResetKey } from './data-views-range-reset';
import { isRangeInverted } from './data-views-range-values';
import type { RangeFieldConfig, RangeValue } from './data-views-types';
import { sxRem } from '../../../tokens/relative';

/**
 * One end of the range. A day keeps its `AAAA-MM-DD` string verbatim (the form
 * both the field and the backend speak) and is typed through the masked
 * `dd/mm/aaaa` field rather than a native date input — see
 * {@link DayBoundInput} for why. A number parses, and an unparseable/blank
 * entry CLEARS the bound rather than writing `NaN`.
 */
function BoundField<T extends Record<string, unknown>>({
  field,
  label,
  value,
  onChange,
  testId,
}: {
  field: RangeFieldConfig<T>;
  label: string;
  value: number | string | undefined;
  onChange: (bound: number | string | undefined) => void;
  testId: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  if (field.kind === 'day') {
    return (
      <DayBoundInput
        fill
        mask={copy.filters.dayMask}
        invalidMessage={copy.filters.dayInvalid}
        label={label}
        value={value == null ? undefined : String(value)}
        onChange={onChange}
        testId={testId}
      />
    );
  }
  return (
    <NumberBoundInput
      label={label}
      value={value}
      unit={field.unit}
      onChange={onChange}
      testId={testId}
    />
  );
}


/** One box of the pair: an equal share of the row for a day, as it was for a number. */
function BoundCell({ grow, children }: { grow: boolean; children: React.ReactNode }): React.JSX.Element {
  if (!grow) return <>{children}</>;
  return <Box sx={{ flex: '1 1 0', minWidth: 0 }}>{children}</Box>;
}

/**
 * The line under the pair: why an inverted window matches nothing, or — for a
 * day range — that BOTH days are in the result. Saying so is FUT-668's other
 * half: the bounds compare as ISO strings precisely so `até` keeps its whole
 * day, and nothing on screen would otherwise tell the merchant that.
 */
function RangeNote({
  day,
  inverted,
  testId,
}: {
  day: boolean;
  inverted: boolean;
  testId: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  if (inverted) {
    return (
      <Typography
        component="p"
        data-testid={`${testId}-inverted`}
        sx={{ mt: 0.75, fontSize: sxRem(12), color: 'error.main' }}
      >
        {copy.filters.rangeInvalid}
      </Typography>
    );
  }
  if (!day) return null;
  return (
    <Typography
      component="p"
      data-testid={`${testId}-inclusive`}
      // `text.secondary`, not `disabled`: the note is read, and disabled grey
      // at 12px is 2.68:1 (FUT-4144 UI review).
      sx={{ mt: 0.75, fontSize: sxRem(12), color: 'text.secondary' }}
    >
      {copy.filters.rangeInclusiveNote}
    </Typography>
  );
}

/** Props of {@link RangeBounds}. */
interface RangeBoundsProps<T extends Record<string, unknown>> {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testId: string;
  /**
   * Months the day calendar shows side by side (FUT-4144). Two where the
   * popover has the room; one, with the month/year selectors, on a phone and
   * in the panels.
   */
  calendarMonths?: 1 | 2;
  /**
   * Whether the day calendar is mounted. A host that keeps the pair mounted
   * while hidden (the slide-in panel) passes its open state, so a closed panel
   * holds no calendar of its own.
   */
  showCalendar?: boolean;
}

/**
 * The `De`/`Até` pair for a range — shared by the pill's popover and the
 * slide-in panel's day fields, so the two surfaces cannot drift on what a bound
 * accepts or how it clears.
 */
export function RangeBounds<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  testId,
  calendarMonths = 1,
  showCalendar = true,
}: RangeBoundsProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { key, emitted } = useOutsideResetKey(value);
  // Moves the calendar to a TYPED day. A typed write is the fields' own, so
  // the outside key above does not see it; a tap on the calendar moves
  // neither, which is what keeps it still under the finger.
  const [typed, setTyped] = useState(0);
  const typedChange = (range: RangeValue) => {
    setTyped((n) => n + 1);
    onChange(emitted(range));
  };
  const day = field.kind === 'day';
  return (
    <Box data-testid={`${testId}-panel`}>
      {/* Above the inputs, not below: the presets are the answer for most
          merchants, and the two date pickers are the escape hatch. */}
      <Box sx={{ '&:not(:empty)': { mb: 1.5 } }}>
        <RangePresets presets={presetsFor(field, copy)} value={value} onChange={onChange} testId={testId} />
      </Box>
      {/* Top-aligned: a day that does not exist grows ITS field by a message
          line, and centring would push the other box half a line down. The two
          boxes are one height, so with no message this is the same row. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        {/* A day pair shares the row equally, so it spans the calendar under
            it; a number pair keeps its own widths. */}
        <BoundCell grow={day}>
          <BoundField
            key={`min-${key}`}
            field={field}
            label={copy.filters.rangeStart}
            value={value.min}
            onChange={(min) => typedChange({ ...value, min })}
            testId={`${testId}-min`}
          />
        </BoundCell>
        <BoundCell grow={day}>
          <BoundField
            key={`max-${key}`}
            field={field}
            label={copy.filters.rangeEnd}
            value={value.max}
            onChange={(max) => typedChange({ ...value, max })}
            testId={`${testId}-max`}
          />
        </BoundCell>
      </Box>
      <RangeNote day={day} inverted={isRangeInverted(value)} testId={testId} />
      {/* Under the boxes and the note, with no button to reach it: the typed
          path stays as short as it was, and a period is two taps (FUT-4144). */}
      {day && showCalendar && (
        <DayRangeCalendar
          fieldLabel={field.label}
          value={value}
          onChange={(range) => onChange(emitted(range))}
          months={calendarMonths}
          viewKey={`${key}-${typed}`}
          testId={testId}
        />
      )}
    </Box>
  );
}
