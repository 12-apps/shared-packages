/**
 * Shared period selector (FUT-306): the same rolling-preset ToggleGroup the
 * saved-report and dashboard viewers render, extracted so the chrome (and its
 * test ids) cannot drift between pages.
 *
 * FUT-755 gave it two more pills. `Este mês` is another rolling preset and
 * needs nothing from the caller. `Personalizado…` is different in kind — it is
 * not a period, it names one the reader supplies — so it appears ONLY for a
 * caller that passes `custom` and can therefore carry the two dates through to
 * the request. A surface that offered the pill without them would send
 * `preset=custom` with nothing to resolve and get a 400 from a control that
 * looked like it worked.
 */
import { useState, type JSX } from "react";

import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";

import {
  REPORT_RANGE_LABELS,
  REPORT_RANGES,
  REPORT_ROLLING_RANGES,
  type ReportRange,
} from "../reports-api";
import { CustomRangeDialog, type CustomRangeWindow } from "./custom-range-dialog";
import { CONTROL_HEIGHT_PX, CONTROL_RADIUS_PX } from "./report-surface";

const option = (range: ReportRange): { value: ReportRange; label: string } => ({
  value: range,
  label: REPORT_RANGE_LABELS[range],
});

const ROLLING_OPTIONS = REPORT_ROLLING_RANGES.map(option);
const ALL_OPTIONS = REPORT_RANGES.map(option);

/**
 * A SEGMENTED control, and one the height of everything beside it.
 *
 * `ToggleGroup` puts a 4px margin round each button and draws no frame, so the
 * period selector measured 44.5px in a row of 36.5px buttons — the tallest
 * thing in both toolbars, and the reason `visual-pass.md`'s "controls in a row
 * share a height" failed on every screen that renders it. Dropping the margins
 * and framing the group is also what the prototype's `.seg` is: one control
 * with several states, not a handful of buttons that happen to be adjacent.
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
  // Five pills do not fit a phone in one line; wrapping keeps them all
  // reachable instead of pushing "Personalizado…" past the edge.
  flexWrap: "wrap",
  "& .MuiToggleButtonGroup-grouped": {
    m: 0,
    height: "100%",
    minHeight: 0,
    border: 0,
    borderRadius: `${CONTROL_RADIUS_PX}px !important`,
  },
} as const;

/**
 * What a caller must supply to be allowed to offer "Personalizado…".
 *
 * Unexported: it exists to make the opt-in a single named prop, and a caller
 * writes it as an object literal at the call site.
 */
interface CustomRangeSupport {
  /**
   * The window the picker OPENS on — the applied custom range, or the window
   * currently on screen. Null only when neither is known yet.
   */
  seed: CustomRangeWindow | null;
  /** Called with the two dates once the reader confirms them. */
  onApply: (window: CustomRangeWindow) => void;
}

export function RangeToggle({
  value,
  onChange,
  dataTestId,
  custom,
}: {
  value: ReportRange;
  onChange: (next: ReportRange) => void;
  dataTestId: string;
  /** Omitted: rolling presets only. Passed: the fifth pill and its picker. */
  custom?: CustomRangeSupport;
}): JSX.Element {
  const [picking, setPicking] = useState(false);

  return (
    <>
      <ToggleGroup
        variant="exclusive"
        size="sm"
        options={custom ? ALL_OPTIONS : ROLLING_OPTIONS}
        value={value}
        onChange={(_event, next) => {
          // An exclusive `ToggleButtonGroup` reports `null` when the pill that
          // is ALREADY selected is clicked. For a rolling preset that has to be
          // a no-op — a report is always running over some period, and there is
          // no "no period" to fall back to. For `custom` it is the ONLY way
          // back into the picker once its pill is active, so re-opening is what
          // clicking it has to mean; without this the window could be set once
          // and never adjusted again without first leaving for another preset.
          if (next === null) {
            if (value === "custom") setPicking(true);
            return;
          }
          if (typeof next !== "string") return;
          // `Personalizado…` opens the picker instead of applying anything: on
          // its own the word names no window, and reporting the preset here
          // would send a request the server can only refuse. The period changes
          // when the picker is CONFIRMED, which is also what leaves the pill
          // showing as selected afterwards.
          if (next === "custom") {
            setPicking(true);
            return;
          }
          onChange(next as ReportRange);
        }}
        aria-label="Período"
        sx={SEGMENT_SX}
        dataTestId={dataTestId}
      />
      {custom ? (
        <CustomRangeDialog
          open={picking}
          seed={custom.seed}
          onApply={(window) => {
            setPicking(false);
            custom.onApply(window);
          }}
          onClose={() => setPicking(false)}
          dataTestId={`${dataTestId}-custom`}
        />
      ) : null}
    </>
  );
}
