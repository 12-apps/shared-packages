import type { FC } from 'react';
import React from 'react';

import { bandFor } from './Calendar.band';
import { isSameDay } from './Calendar.dates';
import { buildDayArgs } from './Calendar.selection';
import type { CalendarProps, DateRange, MonthMatrixDay, SelectionMode } from './Calendar.types';
import { CalendarDay } from './CalendarDay';

// Everything a cell needs that is the same for every cell in the calendar.
export interface DayCellContext {
  selectionMode: SelectionMode;
  /** BCP-47 tag each day's spoken name is written in. */
  locale: string;
  value: Date | null;
  range: DateRange;
  hoveredDate: Date | null;
  focusedDate: Date;
  today: Date;
  showOutsideDays: boolean;
  isDisabled: (date: Date) => boolean;
  renderDay?: CalendarProps['renderDay'];
  dayClassName?: CalendarProps['dayClassName'];
  onSelect: (date: Date) => void;
  onHover: (date: Date) => void;
  onHoverEnd: () => void;
}

export const CalendarDayCell: FC<DayCellContext & { day: MonthMatrixDay }> = ({
  day,
  focusedDate,
  showOutsideDays,
  renderDay,
  dayClassName,
  onSelect,
  onHover,
  onHoverEnd,
  locale,
  ...context
}) => {
  const args = buildDayArgs({ day, ...context });

  if (renderDay) return <>{renderDay(args)}</>;

  return (
    <CalendarDay
      day={args}
      locale={locale}
      band={bandFor({ args, ...context })}
      focused={isSameDay(args.date, focusedDate)}
      showOutsideDays={showOutsideDays}
      dayClassName={dayClassName}
      onSelect={onSelect}
      onHover={onHover}
      onHoverEnd={onHoverEnd}
    />
  );
};
