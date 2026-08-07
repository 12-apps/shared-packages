"use client";

/**
 * THE ONE-CLICK WINDOWS ABOVE A RANGE'S `De`/`Até` INPUTS.
 *
 * "Filter by last month" is two date pickers, four gestures and a mental
 * calculation of which day the month ended on. It is also the overwhelmingly
 * common case. So the common windows get a chip each, and the inputs stay for
 * the windows nobody could enumerate.
 *
 * Clicking an active preset CLEARS it. A chip that reads as pressed and does
 * nothing when pressed again is a dead control, and the alternative — hunting
 * for the pill's ✕ — is the gesture this row exists to remove.
 */
import { Box } from "@mui/material";

import { isPresetActive, resolvePreset } from "./data-views-range-presets";
import type { RangePreset, RangeValue } from "./data-views-types";

/** One preset, styled as the same pill-shaped chip the filter bar uses. */
function PresetChip({
  preset,
  active,
  onSelect,
  testId,
}: {
  preset: RangePreset;
  active: boolean;
  onSelect: () => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={testId}
      sx={{
        px: 1.25,
        py: 0.5,
        border: 1,
        borderStyle: "solid",
        borderColor: active ? "primary.main" : "divider",
        borderRadius: 999,
        bgcolor: active ? "action.selected" : "background.paper",
        color: active ? "primary.main" : "text.secondary",
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
        "&:hover": { borderColor: active ? "primary.main" : "text.primary" },
      }}
    >
      {preset.label}
    </Box>
  );
}

/**
 * The preset row. Renders nothing when a field declares none, so a numeric
 * range without host-configured windows keeps the popover it had.
 *
 * Carries no outer margin — the three surfaces that host it (the pill's
 * popover, the slide-in panel, the "Mais" overflow) each sit it in a different
 * stack, and a baked-in margin would be wrong in two of them.
 */
export function RangePresets({
  presets,
  value,
  onChange,
  testId,
}: {
  presets: RangePreset[];
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testId: string;
}): React.JSX.Element | null {
  if (presets.length === 0) return null;
  return (
    <Box
      data-testid={`${testId}-presets`}
      sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}
    >
      {presets.map((preset) => {
        const active = isPresetActive(preset, value);
        return (
          <PresetChip
            key={preset.id}
            preset={preset}
            active={active}
            onSelect={() => onChange(active ? {} : resolvePreset(preset))}
            testId={`${testId}-preset-${preset.id}`}
          />
        );
      })}
    </Box>
  );
}
