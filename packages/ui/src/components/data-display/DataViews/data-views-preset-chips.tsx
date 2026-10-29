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
 *
 * ONE LINE at every width (ADR 0190 in the host, FUT-4144): the presets are
 * the options of one question, and as wrapping chips "Este ano" fell onto a
 * second line at 320, 390 and 600, where it read as a second question. Where
 * the row is wide enough they are a segmented control of equal parts; where it
 * is not, the same question is a select.
 */
import Box from "@mui/material/Box/index.js";
import TextField from "@mui/material/TextField/index.js";
import { useTheme } from "@mui/material/styles/index.js";
import React, { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { EN_US_DATA_VIEWS_COPY } from "../../../en-US.data-display";
import { useDataViewsCopy } from "./data-views-copy-context";
import { isPresetActive, resolvePreset } from "./data-views-range-presets";
import type { RangePreset, RangeValue } from "./data-views-types";
import { sxRem } from "../../../tokens/relative";

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
        fontSize: sxRem(12),
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
        "&:hover": { borderColor: active ? "primary.main" : "text.primary" },
      }}
    >
      {preset.label}
    </Box>
  );
}

/** The chip look, for the hidden row that measures each label at its natural width. */
const MEASURE_SX = {
  display: "inline-block",
  px: 1.25,
  border: 1,
  font: "inherit",
  fontSize: sxRem(12),
  fontWeight: 600,
  whiteSpace: "nowrap",
} as const;

/**
 * Whether `count` equal parts, each as wide as the widest label, fit `width`
 * with `gap` between them. Unmeasured (`null`: the server, jsdom) counts as
 * fitting, so the row renders the buttons it always rendered.
 */
export function presetsFitOneLine(width: number | null, widest: number, count: number, gap: number): boolean {
  if (width === null) return true;
  return widest * count + gap * (count - 1) <= width;
}

/** The element's own width as it changes; `null` until measured, or where nothing can measure. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The widest label at the chip's own type, padding and border, read off the
 * hidden measuring row.
 *
 * `offsetWidth`, the LAYOUT width, never the bounding box: a popover grows in
 * from 75% scale, and a box read during that transition is a quarter short —
 * which judged "Acima de R$ 10" to fit a third of the "Mais" panel and cut it
 * to "Acima de …" (FUT-4144 UI review round 2). Measured again when the row's
 * width changes and once the web fonts have loaded, since a fallback face is
 * narrower than the one the parts will be drawn in.
 */
function useWidestLabel(ref: RefObject<HTMLElement | null>, labels: string, width: number | null): number {
  const [widest, setWidest] = useState(0);
  useLayoutEffect(() => {
    const measure = (): void => {
      const spans = ref.current?.querySelectorAll<HTMLElement>("[data-preset-measure]") ?? [];
      setWidest(Math.max(0, ...Array.from(spans, (span) => span.offsetWidth)));
    };
    measure();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
    };
  }, [ref, labels, width]);
  return widest;
}

/** The same question as a select, for a row too narrow for its parts. */
function PresetSelect({
  presets,
  value,
  onChange,
  testId,
}: {
  presets: RangePreset[];
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testId: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy().filters.presetSelect ?? EN_US_DATA_VIEWS_COPY.filters.presetSelect;
  const active = presets.find((preset) => isPresetActive(preset, value))?.id ?? "";
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={copy?.label}
      value={active}
      onChange={(event) => {
        const picked = presets.find((preset) => preset.id === event.target.value);
        // "None" is the select's way of tapping the active chip again.
        onChange(picked ? resolvePreset(picked) : {});
      }}
      SelectProps={{ native: true }}
      InputLabelProps={{ shrink: true }}
      inputProps={{ "data-testid": `${testId}-presets-select` }}
    >
      <option value="">{copy?.none}</option>
      {presets.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.label}
        </option>
      ))}
    </TextField>
  );
}

/**
 * The preset row. Renders nothing when a field declares none, so a numeric
 * range without host-configured windows keeps the popover it had.
 *
 * Carries no outer margin — the three surfaces that host it (the pill's
 * popover, the slide-in panel, the "Mais" overflow) each sit it in a different
 * stack, and a baked-in margin would be wrong in two of them.
 *
 * What is measured is the row's OWN width, not the window's: the same row
 * lives in a 670px popover, a 300px panel and a phone-wide sheet.
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
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const widest = useWidestLabel(box, presets.map((preset) => preset.label).join("|"), width);
  if (presets.length === 0) return null;
  const fits = presetsFitOneLine(width, widest, presets.length, parseFloat(theme.spacing(0.75)));
  return (
    <Box ref={box} sx={{ position: "relative", minWidth: 0 }}>
      <Box
        aria-hidden="true"
        sx={{ position: "absolute", top: 0, left: 0, width: "max-content", height: 0, overflow: "hidden", visibility: "hidden" }}
      >
        {presets.map((preset) => (
          <Box key={preset.id} component="span" data-preset-measure="" sx={MEASURE_SX}>
            {preset.label}
          </Box>
        ))}
      </Box>
      {fits ? (
        <Box
          data-testid={`${testId}-presets`}
          sx={{ display: "grid", gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))`, gap: 0.75 }}
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
      ) : (
        <Box data-testid={`${testId}-presets`}>
          <PresetSelect presets={presets} value={value} onChange={onChange} testId={testId} />
        </Box>
      )}
    </Box>
  );
}
