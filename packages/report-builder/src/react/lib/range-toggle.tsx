/**
 * Shared period selector (FUT-306): the same rolling-preset ToggleGroup the
 * saved-report and dashboard viewers render, extracted so the chrome (and its
 * test ids) cannot drift between pages.
 */
import type { JSX } from "react";

import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";

import { REPORT_RANGE_LABELS, REPORT_RANGES, type ReportRange } from "../reports-api";
import { CONTROL_HEIGHT_PX, CONTROL_RADIUS_PX } from "./report-surface";

const RANGE_OPTIONS = REPORT_RANGES.map((range) => ({
  value: range,
  label: REPORT_RANGE_LABELS[range],
}));

/**
 * A SEGMENTED control, and one the height of everything beside it.
 *
 * `ToggleGroup` puts a 4px margin round each button and draws no frame, so the
 * period selector measured 44.5px in a row of 36.5px buttons — the tallest
 * thing in both toolbars, and the reason `visual-pass.md`'s "controls in a row
 * share a height" failed on every screen that renders it. Dropping the margins
 * and framing the group is also what the prototype's `.seg` is: one control
 * with three states, not three buttons that happen to be adjacent.
 */
const SEGMENT_SX = {
  height: `${CONTROL_HEIGHT_PX}px`,
  minHeight: `${CONTROL_HEIGHT_PX}px`,
  boxSizing: "border-box",
  p: 0,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  bgcolor: "background.paper",
  "& .MuiToggleButtonGroup-grouped": {
    m: 0,
    height: "100%",
    minHeight: 0,
    border: 0,
    borderRadius: `${CONTROL_RADIUS_PX}px !important`,
  },
} as const;

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
      sx={SEGMENT_SX}
      dataTestId={dataTestId}
    />
  );
}
