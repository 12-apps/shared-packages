"use client";

import type { JSX } from "react";

import { DateRangePicker, type DateRangeDraft } from "@12-apps/ui/form/DateRangePicker";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";

import type { DiscountsWebCopy } from "./copy";
import { DateField, isIsoDay } from "./date-field";

/**
 * "Quando vale"'s period: approved prototype option B (FUT-4156).
 *
 * A range calendar ALWAYS open (the library's `DateRangePicker`, no quick
 * ranges) — two months beside the boxes on a computer, one above them on a
 * phone, decided by the form's own width — and the same DD/MM/AAAA boxes as
 * before, which keep every rule they had: the mask, the numeric keypad, a
 * half-typed date kept until Criar refuses it, an impossible day marked. They
 * are the FORM's fields (`renderFields`), not the picker's, because the
 * picker's own pair discards a half-typed date on blur.
 *
 * The two stay in step through the form values alone: the calendar reads a box
 * once it holds a whole real day, and a tap writes only the bound it moved.
 *
 * As B draws it: only the month's own days, today ringed, and — where the
 * server counts no whole days — a second tap on Início does nothing, since
 * Início = Término would be refused. Where it counts them (`wholeDays`,
 * FUT-4482) that tap is a one-day promotion.
 */

/** A form value as the calendar reads it: a whole real ISO day, or no bound. */
const dayOf = (value: string | undefined): string | null =>
  value !== undefined && isIsoDay(value) ? value : null;

/**
 * Where a tap leaves the period. The calendar's own step, with one addition
 * the prototype draws: with only Término chosen, a tap before it is Início and
 * Término stays — the calendar alone would start a fresh range and drop it.
 */
function afterTap(draft: DateRangeDraft, next: DateRangeDraft): DateRangeDraft {
  const keepsEnd =
    next.to === null && draft.from === null && draft.to !== null && next.from !== null && next.from < draft.to;
  return keepsEnd ? { from: next.from, to: draft.to } : next;
}

function PeriodBoxes({
  copy,
  placement,
}: {
  copy: DiscountsWebCopy;
  placement: "beside" | "below";
}): JSX.Element {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        // Beside the months the two stack; under them they sit two-up, as the
        // prototype draws them at 390.
        gridTemplateColumns: placement === "beside" ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
      }}
    >
      {(["startsAt", "endsAt"] as const).map((name) => (
        <DateField
          key={name}
          name={name}
          label={copy.form[name]}
          placeholder={copy.form.datePlaceholder}
          invalidMessage={copy.form.invalidDate}
          incompleteMessage={copy.form.dateIncomplete}
        />
      ))}
    </Box>
  );
}

export function PeriodPicker({ copy, wholeDays }: { copy: DiscountsWebCopy; wholeDays: boolean }): JSX.Element {
  const { values, setFieldValue } = useFormContext();
  const draft: DateRangeDraft = { from: dayOf(values.startsAt), to: dayOf(values.endsAt) };
  const names = copy.form.calendar;
  return (
    <DateRangePicker
      value={draft}
      onChange={(tapped, meta) => {
        // The boxes write the form themselves; only a tap needs writing here.
        if (meta.source !== "calendar") return;
        const next = afterTap(draft, tapped);
        if (next.from !== draft.from) setFieldValue("startsAt", next.from ?? "");
        if (next.to !== draft.to) setFieldValue("endsAt", next.to ?? "");
      }}
      quickRanges={[]}
      numberOfMonths={2}
      fieldsPlacement="beside"
      openEnd
      dataTestId="discount-period-picker"
      renderFields={({ placement }) => <PeriodBoxes copy={copy} placement={placement} />}
      showOutsideDays={false}
      todayIndicator="ring"
      allowSameDayRange={wholeDays}
      locale={names.locale}
      messages={{ calendarLabel: names.label }}
      calendarLabels={{ previousMonth: names.previousMonth, nextMonth: names.nextMonth }}
    />
  );
}
