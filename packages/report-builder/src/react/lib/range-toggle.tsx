/**
 * Shared period selector (FUT-306): the same rolling-preset ToggleGroup the
 * saved-report and dashboard viewers render, extracted so the chrome (and its
 * test ids) cannot drift between pages.
 */
import type { JSX } from "react";

import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";

import { REPORT_RANGE_LABELS, REPORT_RANGES, type ReportRange } from "../reports-api";

const RANGE_OPTIONS = REPORT_RANGES.map((range) => ({
  value: range,
  label: REPORT_RANGE_LABELS[range],
}));

export function RangeToggle({
  value,
  onChange,
  dataTestId,
}: {
  value: ReportRange;
  onChange: (next: ReportRange) => void;
  dataTestId: string;
}): JSX.Element {
  return (
    <ToggleGroup
      variant="exclusive"
      size="sm"
      options={RANGE_OPTIONS}
      value={value}
      onChange={(_event, next) => {
        if (typeof next === "string") onChange(next as ReportRange);
      }}
      aria-label="Período"
      dataTestId={dataTestId}
    />
  );
}
