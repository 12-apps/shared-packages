"use client";

/**
 * ONE FIELD, RENDERED INSIDE THE "MAIS" PANEL.
 *
 * Split from `data-views-more-filters` at the file-size gate, along the seam
 * that was already there: that module is the trigger, the panel and its
 * footer — the chrome — and this is what goes in it.
 *
 * A field with one or two options renders FLAT: inside a panel there is no
 * space to win back, and two labelled checkboxes are faster than a dropdown
 * needing a second click. Past that it becomes a {@link MultiSelectDropdown} —
 * see `INLINE_OPTION_LIMIT`.
 */
import { Checkbox } from "@mui/material";

import { MultiSelectDropdown } from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { OverflowField } from "./data-views-overflow";
import { RangePresets } from "./data-views-preset-chips";
import { presetsFor } from "./data-views-range-presets";
import { isRangeSet } from "./data-views-range-values";
import type { RangeValue } from "./data-views-types";

/** What each field's control needs, minus the panel's own chrome. */
export interface MoreFieldProps {
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onChangeRange: (fieldId: string, range: RangeValue) => void;
  testIdPrefix: string;
}

/**
 * Above this many options a field is a DROPDOWN rather than a flat row of
 * checkboxes. Two options cost two lines and read faster laid out; a "Cliente"
 * with a dozen turns the panel into a scrolling wall and buries every field
 * under it, which is exactly what the overflow was meant to avoid.
 */
const INLINE_OPTION_LIMIT = 2;

/** One overflowed pill: its options as checkboxes, all visible at once. */
function OverflowPill<T extends Record<string, unknown>>({
  field,
  values,
  onToggle,
  onClear,
  testIdPrefix,
}: {
  field: OverflowField<T>;
  values: string[];
  onToggle: (value: string, checked: boolean) => void;
  onClear: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const options = field.pill?.options ?? [];
  if (options.length > INLINE_OPTION_LIMIT) {
    return (
      <MultiSelectDropdown
        label={field.pill?.label ?? field.label}
        options={options}
        selected={new Set(values)}
        onToggle={onToggle}
        onClear={onClear}
        allLabel="Todas"
        searchable={options.length > 6 ? true : undefined}
        searchPlaceholder="Buscar…"
        noResultsLabel="Nenhum resultado"
        layout="pill"
        data-testid={`${testIdPrefix}-more-${field.id}`}
      />
    );
  }
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {(field.pill?.options ?? []).map((option) => {
        const checked = values.includes(option.value);
        return (
          <Box
            key={option.value}
            component="label"
            data-testid={`${testIdPrefix}-more-${field.id}-${option.value}`}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.25,
              pr: 1,
              border: 1,
              borderStyle: "solid",
              borderColor: checked ? "primary.main" : "divider",
              bgcolor: checked ? "action.selected" : "transparent",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: "0.8125rem",
              color: checked ? "primary.main" : "text.secondary",
            }}
          >
            <Checkbox
              size="small"
              checked={checked}
              onChange={(event) => onToggle(option.value, event.target.checked)}
              inputProps={{ "aria-label": `${field.label}: ${option.label}` }}
            />
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}


/** One overflowed range: its two bounds, as the same inputs the pill uses. */
function OverflowRange<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  testIdPrefix,
}: {
  field: OverflowField<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const day = field.range?.kind === "day";
  const set = (bound: "min" | "max", raw: string): void => {
    const next: RangeValue = { ...value };
    if (raw === "") delete next[bound];
    else next[bound] = day ? raw : Number(raw);
    onChange(next);
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {/* The overflow offers the same one-click windows the pill does. A field
          in here is one that had no room on the bar, not one with fewer
          controls — otherwise "Data" gains and loses its presets as the window
          is resized. */}
      <RangePresets
        presets={field.range ? presetsFor(field.range) : []}
        value={value}
        onChange={onChange}
        testId={`${testIdPrefix}-more-${field.id}`}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        {(["min", "max"] as const).map((bound, index) => (
          <Box key={bound} sx={{ display: "contents" }}>
            {index === 1 && <Box component="span" sx={{ color: "text.disabled" }}>–</Box>}
            <Box
              component="input"
              type={day ? "date" : "number"}
              placeholder={bound === "min" ? "de" : "até"}
              aria-label={`${field.label} ${bound === "min" ? "de" : "até"}`}
              data-testid={`${testIdPrefix}-more-${field.id}-${bound}`}
              value={value[bound] ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(bound, event.target.value)}
              sx={{
                // `flex:1` + `minWidth:0` rather than `width:100%`. A native
                // date input reports a wide intrinsic minimum (its dd/mm/aaaa
                // mask plus the picker glyph), and a flex child defaults to
                // min-width:auto — so two of them plus the dash refused to
                // shrink and the whole panel scrolled sideways.
                flex: "1 1 0",
                minWidth: 0,
                px: 1,
                py: 0.75,
                border: 1,
                borderStyle: "solid",
                borderColor: "divider",
                borderRadius: 1,
                font: "inherit",
                fontSize: "0.8125rem",
              }}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The trigger, badged with how many fields had no room on the bar — and told
 * apart when some of them are APPLIED.
 *
 * An applied filter can land in here now (it is ranked first, not exempt), so
 * this button is the only thing on screen still saying it exists. A neutral
 * badge reading "3" would make "three filters you have not used" and "three
 * filters narrowing this list" look identical, which is the whole failure the
 * old exemption was written to avoid. So an overflow holding applied filters
 * takes the applied tone and counts them in its own badge.

/**
 * Whether a field has anything applied, and how to unapply it — the two shapes
 * (a pill's selected values, a range's bounds) answered in one place so the
 * group that renders them stays a renderer.
 */
export function fieldClearing<T extends Record<string, unknown>>({
  field,
  pills,
  ranges,
  onTogglePill,
  onChangeRange,
}: {
  field: OverflowField<T>;
} & Pick<MoreFieldProps, "pills" | "ranges" | "onTogglePill" | "onChangeRange">): {
  applied: boolean;
  clear: () => void;
} {
  if (field.group === "range") {
    return {
      applied: isRangeSet(ranges[field.id] ?? {}),
      clear: () => onChangeRange(field.id, {}),
    };
  }
  const values = pills[field.id] ?? [];
  return {
    applied: values.length > 0,
    clear: () => values.forEach((value) => onTogglePill(field.id, value, false)),
  };
}


/** One labelled group in the panel: the field's name, then its control. */
export function MoreGroup<T extends Record<string, unknown>>({
  field,
  pills,
  ranges,
  onTogglePill,
  onChangeRange,
  testIdPrefix,
}: {
  field: OverflowField<T>;
} & MoreFieldProps): React.JSX.Element {
  const { applied, clear } = fieldClearing({ field, pills, ranges, onTogglePill, onChangeRange });
  return (
    <Box sx={{ mb: 1.5, "&:last-of-type": { mb: 0 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Text variant="caption" as="span">
          <Box component="span" sx={{ color: "text.secondary" }}>
            {field.label}
            {field.group === "range" && isRangeSet(ranges[field.id] ?? {}) ? " •" : ""}
          </Box>
        </Text>
        {/* The panel's equivalent of the pill's ✕. Without it a field applied
            in here could only be cleared by finding it again on the bar —
            which is where it goes the moment it becomes active, so the
            operator has to close this panel to undo what they just did. */}
        {applied && (
          <Box
            component="button"
            type="button"
            onClick={clear}
            data-testid={`${testIdPrefix}-more-${field.id}-clear`}
            sx={{
              ml: "auto",
              border: 0,
              p: 0,
              bgcolor: "transparent",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.75rem",
              color: "primary.main",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            Limpar
          </Box>
        )}
      </Box>
      {field.group === "pill" ? (
        <OverflowPill
          field={field}
          values={pills[field.id] ?? []}
          onToggle={(value, checked) => onTogglePill(field.id, value, checked)}
          onClear={() => (pills[field.id] ?? []).forEach((v) => onTogglePill(field.id, v, false))}
          testIdPrefix={testIdPrefix}
        />
      ) : (
        <OverflowRange
          field={field}
          value={ranges[field.id] ?? {}}
          onChange={(range) => onChangeRange(field.id, range)}
          testIdPrefix={testIdPrefix}
        />
      )}
    </Box>
  );
}

