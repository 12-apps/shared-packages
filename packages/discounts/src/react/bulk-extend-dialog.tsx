"use client";

import { useState, type JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { NumberField } from "@12-apps/ui/form/NumberField";
import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";
import { UsableModal } from "@12-apps/ui/feedback/UsableModal";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import type { DiscountsBulkRequest } from "./use-discounts-bulk";
import { fill } from "./copy";
import type { DiscountsBulkCopy } from "./copy-bulk";
import { maskDate, maskedToIso } from "./date-field";

/**
 * "Estender validade…" (FUT-4420, contract C3, C5-C7, L1): the one thing the
 * package draws for the bulk actions, because it is a question rather than a
 * report. Two ways to say it - `+ dias` or `Nova data` - as ONE row of equal
 * parts at every width, 320 included (the owner's rule for the options of one
 * question). A modal on a computer, a bottom sheet on a phone (`UsableModal`).
 *
 * It sends nothing itself: it hands the screen the request, and the screen
 * runs it so the host's report shows the answer.
 */

type Mode = "days" | "date";

/** The typed day as the dialog sees it: complete and real, still being typed, or not a day. */
function dayState(masked: string): "empty" | "incomplete" | "invalid" | "ok" {
  if (masked === "") return "empty";
  if (masked.length < 10) return "incomplete";
  return maskedToIso(masked) === null ? "invalid" : "ok";
}

/** What the dialog's two inputs hold, and what each says about itself. */
function useExtendForm(copy: DiscountsBulkCopy, today: string) {
  const [mode, setMode] = useState<Mode>("days");
  const [days, setDays] = useState<number | null>(7);
  const [typed, setTyped] = useState("");
  const [tried, setTried] = useState(false);
  const day = dayState(typed);
  // Refused before saving: a new last day before today can never be right for any row.
  const past = day === "ok" && (maskedToIso(typed) ?? today) < today;
  const dayMessage = past
    ? copy.datePast
    : day === "invalid"
      ? copy.dateInvalid
      : day === "ok"
        ? undefined
        : copy.dateIncomplete;
  const daysMessage = days === null || days < 1 ? copy.daysRequired : undefined;
  return {
    mode,
    days,
    typed,
    tried,
    setDays,
    setTyped,
    setTried,
    pickMode: (next: Mode) => {
      setMode(next);
      setTried(false);
    },
    message: mode === "days" ? daysMessage : dayMessage,
    daysMessage,
    dayMessage,
  };
}

type ExtendForm = ReturnType<typeof useExtendForm>;

/** The request the form describes, or null while it is not sendable. */
function requestOf(form: ExtendForm, ids: readonly string[]): DiscountsBulkRequest | null {
  if (form.message !== undefined) return null;
  const iso = maskedToIso(form.typed);
  if (form.mode === "days" && form.days !== null) return { operation: "extendWindow", ids: [...ids], days: form.days };
  if (form.mode === "date" && iso !== null) return { operation: "extendWindow", ids: [...ids], endsOn: iso };
  return null;
}

function ExtendFields({
  form,
  copy,
  onSubmit,
}: {
  form: ExtendForm;
  copy: DiscountsBulkCopy;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
      // Enter in a field confirms, like the button: one tap less (UX3).
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          onSubmit();
        }
      }}
    >
      <ToggleGroup
        variant="exclusive"
        fullWidth
        aria-label={copy.modeLabel}
        dataTestId="bulk-extend-mode"
        value={form.mode}
        onChange={(_event, next: Mode | null) => {
          if (next !== null) form.pickMode(next);
        }}
        options={[
          { value: "days", label: copy.modeDays },
          { value: "date", label: copy.modeDate },
        ]}
        sx={{ "& .MuiToggleButton-root": { flex: 1, minWidth: 0, whiteSpace: "nowrap" } }}
      />
      {form.mode === "days" ? (
        <NumberField
          label={copy.daysLabel}
          value={form.days}
          onChange={form.setDays}
          min={1}
          max={3650}
          suffix={copy.daysSuffix}
          error={form.tried && form.daysMessage !== undefined}
          helperText={form.tried ? form.daysMessage : undefined}
          data-testid="bulk-extend-days"
          autoFocus
        />
      ) : (
        <Input
          label={copy.dateLabel}
          placeholder={copy.datePlaceholder}
          value={form.typed}
          onChange={(event) => form.setTyped(maskDate(event.target.value, form.typed))}
          error={form.tried && form.dayMessage !== undefined}
          helperText={form.tried ? form.dayMessage : undefined}
          inputProps={{ inputMode: "numeric", maxLength: 10, autoComplete: "off", "data-testid": "bulk-extend-date" }}
          autoFocus
        />
      )}
      <Text variant="caption" as="p" data-testid="bulk-extend-hint">
        {form.mode === "days" ? copy.extendHintDays : copy.extendHintDate}
      </Text>
    </Box>
  );
}

export function BulkExtendDialog({
  ids,
  copy,
  today,
  onConfirm,
  onCancel,
}: {
  /** The selection the dialog was opened for; `null` when closed. */
  ids: readonly string[] | null;
  copy: DiscountsBulkCopy;
  /** Today in the store's calendar (`YYYY-MM-DD`): the earliest "Nova data". */
  today: string;
  onConfirm: (request: DiscountsBulkRequest) => void;
  onCancel: () => void;
}): JSX.Element {
  const form = useExtendForm(copy, today);
  const count = ids?.length ?? 0;
  const confirm = (): void => {
    const request = ids === null ? null : requestOf(form, ids);
    if (request === null) form.setTried(true);
    else onConfirm(request);
  };
  return (
    <UsableModal
      open={ids !== null}
      onClose={onCancel}
      title={count === 1 ? copy.extendTitleOne : fill(copy.extendTitleMany, { count })}
      // A four-line question: a narrow panel on a computer, not half the screen.
      panelWidth={{ share: "40vw", maxPx: 480, fullBelowPx: 600 }}
      closeLabel={copy.close}
      backLabel={copy.back}
      dataTestId="discount-bulk-extend-dialog"
      footer={
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", width: "100%" }}>
          <Button onClick={confirm} dataTestId="discount-bulk-extend-confirm">
            {fill(copy.extendConfirm, { count })}
          </Button>
          <Button variant="outline" onClick={onCancel} dataTestId="discount-bulk-extend-cancel">
            {copy.cancel}
          </Button>
        </Box>
      }
    >
      <ExtendFields form={form} copy={copy} onSubmit={confirm} />
    </UsableModal>
  );
}
