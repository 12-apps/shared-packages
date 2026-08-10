/**
 * Field primitives for "Ajustes do relatório", plus the one field with rules of
 * its own — the period a saved report OPENS on.
 *
 * They live beside the dialog rather than inside it because that file sits on
 * the size gate's ceiling: it is a LIST of settings, and every setting that
 * grows a rule of its own has to leave, or the next one cannot be added at all.
 */
import type { JSX } from "react";

import { Select } from "@12-apps/ui/form/Select";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_ROLLING_RANGES, type ReportRollingRange } from "../reports-api";
import { SECTION_LABEL_STYLE } from "./report-surface";

/** One labelled block inside the dialog — the eyebrow plus whatever it labels. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <Stack spacing={0.75}>
      <Text variant="heading" size="xs" color="secondary" as="h3" style={SECTION_LABEL_STYLE}>
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * Longer labels than the editor's range toggle, on purpose: a toggle reads in
 * context ("30 dias"), a select in a settings list has to say what it is
 * choosing without it, and `prototype.html` writes it out the same way.
 */
const DEFAULT_RANGE_LABELS: Record<ReportRollingRange, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
};

/**
 * Every ROLLING preset, and no `Personalizado…`.
 *
 * That is the whole difference between this list and the toggle's: `custom`
 * names two explicit dates, and this column has nowhere to keep them — storing
 * it would freeze the report on one window and open it there forever. `Este
 * mês` needs no dates, which is exactly why it belongs here (FUT-755).
 */
const DEFAULT_RANGE_OPTIONS = REPORT_ROLLING_RANGES.map((value) => ({
  value,
  label: DEFAULT_RANGE_LABELS[value],
}));

/**
 * Guard the wire's word before it reaches state — a stale value opens nothing.
 * Checked against the ROLLING list, which is exactly what the store admits.
 */
function asDefaultRange(value: string): ReportRollingRange {
  return REPORT_ROLLING_RANGES.find((candidate) => candidate === value) ?? "30d";
}

/** "Período padrão ao abrir" — the period a reader lands on (FUT-755). */
export function DefaultRangeField({
  value,
  onChange,
  testId,
}: {
  value: ReportRollingRange;
  onChange: (next: ReportRollingRange) => void;
  testId: string;
}): JSX.Element {
  return (
    <Field label="Período padrão ao abrir">
      <Select
        aria-label="Período padrão ao abrir"
        options={DEFAULT_RANGE_OPTIONS}
        value={value}
        onChange={(event) => onChange(asDefaultRange(String(event.target.value)))}
        size="small"
        data-testid={testId}
      />
    </Field>
  );
}
