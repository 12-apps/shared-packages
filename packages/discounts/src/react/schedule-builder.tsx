"use client";

import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { MAX_SCHEDULE_WINDOWS, type DiscountSchedule, type DiscountScheduleWindow } from "../engine/schedule";

import { fill, type DiscountsWebCopy } from "./copy";
import { formatScheduleWindow } from "./schedule-summary";

/**
 * "Toda sexta, das 16:00 às 20:00" — the weekly schedule editor (FUT-996).
 *
 * The shape is chosen from how a merchant DESCRIBES a promotion, not from how
 * a week is stored. Three decisions carry it:
 *
 * **Day chips, not checkboxes.** Seven chips in a row read as a week at a
 * glance; seven checkboxes read as a list you have to parse. Monday-first,
 * because that is the axis `WeekHours` and every hours screen already uses, and
 * a promotions screen starting on Sunday next to an hours screen starting on
 * Monday is its own bug report.
 *
 * **A LIST of rows, each with its own days and hours** — not a per-weekday
 * hours grid. One row covers "toda sexta das 16 às 20" and "segunda e terça à
 * tarde" alike; a second covers "sexta 16–20 e sábado 12–16". The grid shape
 * (what `openingHours` uses) asks seven questions to answer one, and a
 * promotion is a sentence, not a business week.
 *
 * **A live read-back.** See `./schedule-summary` — it is the only thing on this
 * screen the operator can check against what they meant.
 *
 * Presets WRITE INTO the chips rather than being a mode: after "Seg a Sex" the
 * operator can still deselect Wednesday, which is what makes them a shortcut
 * instead of a fourth thing to understand.
 */

/** Monday-first, 0..6 — the axis the engine and every hours surface share. */
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_PRESET = [0, 1, 2, 3, 4];
const WEEKEND_PRESET = [5, 6];

/** A new row: the most common promotion, so an operator edits rather than fills. */
export function blankWindow(): DiscountScheduleWindow {
  return { days: [], from: "16:00", to: "20:00" };
}

function toggleDay(days: readonly number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

/** One day chip. A button rather than a checkbox — see the header. */
function DayChip({
  label,
  index,
  selected,
  onClick,
}: {
  label: string;
  /** The ROW this chip belongs to — test ids must be unique across rows. */
  index: number;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant={selected ? "solid" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`schedule-day-${index}-${label}`}
    >
      {label}
    </Button>
  );
}

/** One "these days, these hours" row. */
function WindowRow({
  window,
  index,
  copy,
  canRemove,
  onChange,
  onRemove,
}: {
  window: DiscountScheduleWindow;
  index: number;
  copy: DiscountsWebCopy;
  canRemove: boolean;
  onChange: (next: DiscountScheduleWindow) => void;
  onRemove: () => void;
}): JSX.Element {
  const sentence = formatScheduleWindow(window, copy);
  return (
    <Stack
      spacing={1}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
      data-testid={`schedule-window-${index}`}
    >
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
        {WEEK.map((day) => (
          <DayChip
            key={day}
            label={copy.schedule.dayShort[day] ?? String(day)}
            index={index}
            selected={window.days.includes(day)}
            onClick={() => onChange({ ...window, days: toggleDay(window.days, day) })}
          />
        ))}
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={copy.schedule.removeWindow}
            data-testid={`schedule-remove-${index}`}
          >
            ✕
          </Button>
        )}
      </Box>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Text variant="caption">{copy.schedule.fromLabel}</Text>
        <Input
          type="time"
          value={window.from}
          onChange={(event) => onChange({ ...window, from: event.target.value })}
          aria-label={copy.schedule.fromLabel}
          data-testid={`schedule-from-${index}`}
        />
        <Text variant="caption">{copy.schedule.toLabel}</Text>
        <Input
          type="time"
          value={window.to}
          onChange={(event) => onChange({ ...window, to: event.target.value })}
          aria-label={copy.schedule.toLabel}
          data-testid={`schedule-to-${index}`}
        />
      </Box>
      {sentence !== null && (
        <Text variant="caption" data-testid={`schedule-summary-${index}`}>
          {sentence}
        </Text>
      )}
    </Stack>
  );
}

/** The three shortcuts. They write into the chips; they are not a mode. */
function Presets({
  copy,
  onApply,
}: {
  copy: DiscountsWebCopy;
  onApply: (days: number[]) => void;
}): JSX.Element {
  const presets: [string, number[]][] = [
    [copy.schedule.presetEveryDay, WEEK],
    [copy.schedule.presetWeekdays, WEEKDAY_PRESET],
    [copy.schedule.presetWeekend, WEEKEND_PRESET],
  ];
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {presets.map(([label, days]) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onApply([...days])}
          data-testid={`schedule-preset-${label}`}
        >
          {label}
        </Button>
      ))}
    </Box>
  );
}

export function ScheduleBuilder({
  schedule,
  copy,
  timezone,
  error,
  onChange,
}: {
  schedule: DiscountSchedule;
  copy: DiscountsWebCopy;
  /** Whose clock these times are in — a merchant setting 16:00 must know. */
  timezone: string;
  error?: string | null;
  onChange: (next: DiscountSchedule) => void;
}): JSX.Element {
  const { windows } = schedule;
  const replace = (index: number, next: DiscountScheduleWindow): void =>
    onChange({ windows: windows.map((w, i) => (i === index ? next : w)) });

  return (
    <FormControl>
      <FormLabel>{copy.schedule.builderTitle}</FormLabel>
      <Stack spacing={1} data-testid="schedule-builder">
        <Presets
          copy={copy}
          onApply={(days) =>
            onChange({
              windows:
                windows.length === 0
                  ? [{ ...blankWindow(), days }]
                  : windows.map((w, i) => (i === 0 ? { ...w, days } : w)),
            })
          }
        />
        {windows.map((window, index) => (
          <WindowRow
            // Index is the identity here: rows have no id, and the list is
            // edited by position — which is also the order the sentence reads.
            key={index}
            window={window}
            index={index}
            copy={copy}
            canRemove={windows.length > 1}
            onChange={(next) => replace(index, next)}
            onRemove={() => onChange({ windows: windows.filter((_, i) => i !== index) })}
          />
        ))}
        {windows.length < MAX_SCHEDULE_WINDOWS && (
          <Box>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ windows: [...windows, blankWindow()] })}
              data-testid="schedule-add-window"
            >
              {copy.schedule.addWindow}
            </Button>
          </Box>
        )}
        <Text variant="caption">{fill(copy.schedule.timezoneNote, { timezone })}</Text>
        <Text variant="caption">{copy.schedule.guaranteeNote}</Text>
        {error != null && error !== "" && <FormMessage error>{error}</FormMessage>}
      </Stack>
    </FormControl>
  );
}
