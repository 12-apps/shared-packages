"use client";

import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import {
  MAX_SCHEDULE_WINDOWS,
  toMinutes,
  type DiscountSchedule,
  type DiscountScheduleWindow,
} from "../engine/schedule";

import { ClockInput } from "./clock-input";
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

/**
 * The options of one question on ONE line, in equal parts (FUT-4143 UI review,
 * ADR 0190 in the host): seven day chips, or three presets. Each part shrinks
 * with the form instead of wrapping to a second line, and a label too long for
 * its part is cut with an ellipsis — the full text stays the button's name.
 */
function equalParts(count: number, compact = false) {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
    gap: 0.25,
    // No side padding, and a smaller type on a phone, so every label fits its
    // part whole at 320; the ellipsis is only for a form narrower than that.
    "& > button.MuiButton-root": {
      minWidth: 0,
      width: "100%",
      px: 0,
      // Days at 13 px on a phone: "Dom" is 31 px at 14 and its part ~30.
      fontSize: compact ? "0.75rem" : { xs: "0.8125rem", sm: "0.875rem" },
    },
  };
}

/** A label that ellipsizes inside its part rather than wrapping. */
function OneLine({ children }: { children: string }): JSX.Element {
  return (
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Where a schedule refusal is about: a row's days, or a row's times. */
interface ErrorSpot {
  index: number;
  part: "days" | "times";
}

function badTimes(window: DiscountScheduleWindow): boolean {
  const from = toMinutes(window.from);
  const to = toMinutes(window.to);
  return from === null || to === null || from === to;
}

/**
 * Put the refusal under the control it is about (FUT-4143 UI review): "choose
 * a day" under the first row with no day, a time refusal under the first row
 * whose times are refused. Anything else stays at the foot of the builder.
 */
function errorSpot(
  error: string | null | undefined,
  windows: readonly DiscountScheduleWindow[],
  copy: DiscountsWebCopy,
): ErrorSpot | null {
  if (error == null || error === "") return null;
  const { daysRequired, timesRequired, timeIncomplete } = copy.schedule;
  const days = error === daysRequired ? windows.findIndex((w) => w.days.length === 0) : -1;
  if (days >= 0) return { index: days, part: "days" };
  const isTime = error === timesRequired || error === timeIncomplete;
  const times = isTime ? windows.findIndex(badTimes) : -1;
  return times >= 0 ? { index: times, part: "times" } : null;
}

function ScheduleMessage({ text }: { text: string }): JSX.Element {
  return (
    <FormMessage error dataTestId="schedule-builder-message">
      {text}
    </FormMessage>
  );
}

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
      <OneLine>{label}</OneLine>
    </Button>
  );
}

/** One row's "Das … às …", two 24-hour clocks. */
function WindowTimes({
  window,
  index,
  copy,
  onChange,
}: {
  window: DiscountScheduleWindow;
  index: number;
  copy: DiscountsWebCopy;
  onChange: (next: DiscountScheduleWindow) => void;
}): JSX.Element {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Box sx={{ pt: 1 }}>
        <Text variant="caption">{copy.schedule.fromLabel}</Text>
      </Box>
      <ClockInput
        value={window.from}
        label={copy.schedule.fromLabel}
        invalidMessage={copy.schedule.invalidTime}
        incompleteMessage={copy.schedule.timeIncomplete}
        onChange={(from) => onChange({ ...window, from })}
        dataTestId={`schedule-from-${index}`}
      />
      <Box sx={{ pt: 1 }}>
        <Text variant="caption">{copy.schedule.toLabel}</Text>
      </Box>
      <ClockInput
        value={window.to}
        label={copy.schedule.toLabel}
        invalidMessage={copy.schedule.invalidTime}
        incompleteMessage={copy.schedule.timeIncomplete}
        onChange={(to) => onChange({ ...window, to })}
        dataTestId={`schedule-to-${index}`}
      />
    </Box>
  );
}

/** One "these days, these hours" row. */
function WindowRow({
  window,
  index,
  copy,
  canRemove,
  message,
  onChange,
  onRemove,
}: {
  window: DiscountScheduleWindow;
  index: number;
  copy: DiscountsWebCopy;
  canRemove: boolean;
  /** This row's share of the builder's refusal, painted under the part it names. */
  message: { part: "days" | "times"; text: string } | null;
  onChange: (next: DiscountScheduleWindow) => void;
  onRemove: () => void;
}): JSX.Element {
  const sentence = formatScheduleWindow(window, copy);
  return (
    <Stack
      spacing={1}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: { xs: 1, sm: 1.5 } }}
      data-testid={`schedule-window-${index}`}
    >
      {/* The remove control sits on its own line, top-right, so the seven
          days keep the whole width for their one line. */}
      {canRemove && (
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
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
        </Box>
      )}
      <Box sx={equalParts(WEEK.length)} data-testid={`schedule-days-${index}`}>
        {WEEK.map((day) => (
          <DayChip
            key={day}
            label={copy.schedule.dayShort[day] ?? String(day)}
            index={index}
            selected={window.days.includes(day)}
            onClick={() => onChange({ ...window, days: toggleDay(window.days, day) })}
          />
        ))}
      </Box>
      {message?.part === "days" && <ScheduleMessage text={message.text} />}
      <WindowTimes window={window} index={index} copy={copy} onChange={onChange} />
      {message?.part === "times" && <ScheduleMessage text={message.text} />}
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
    <Box sx={equalParts(presets.length, true)}>
      {presets.map(([label, days]) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onApply([...days])}
          data-testid={`schedule-preset-${label}`}
        >
          <OneLine>{label}</OneLine>
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
  const spot = errorSpot(error, windows, copy);
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
            message={
              spot !== null && spot.index === index && error != null
                ? { part: spot.part, text: error }
                : null
            }
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
        {spot === null && error != null && error !== "" && <ScheduleMessage text={error} />}
      </Stack>
    </FormControl>
  );
}
