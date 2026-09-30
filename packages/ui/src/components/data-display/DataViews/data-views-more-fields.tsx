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
 * needing a second click. Past that — or whenever the field asks for a tree or
 * a search — it is the bar's own {@link PillControl}; see `sharesBarControl`.
 */
import Checkbox from "@mui/material/Checkbox/index.js";

import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { PillControl } from "./data-views-category-pill";
import type { OverflowField } from "./data-views-overflow";
import { RangeBounds } from "./data-views-range-pill";
import { isRangeSet } from "./data-views-range-values";
import type { RangeValue } from "./data-views-types";
import { useDataViewsCopy } from "./data-views-copy-context";
import { fieldRadiusPx } from "../../../tokens/field-radius";
import { fieldHeight } from "../../../tokens/field-height";
import { fieldEdge } from "../../../tokens/field-edge";
import { sxRem } from "../../../tokens/relative";

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

/**
 * Whether an overflowed pill keeps the SAME control it has on the bar.
 *
 * The panel used to build its own flat dropdown for every field past two
 * options, so a field's config only held while it fitted: `control:
 * "category"` lost its tree (subcategories flattened into one list, no
 * "Marcar tudo", no count footer) and `searchEnabled` lost its search, on
 * exactly the phone widths where most filters live in here. Anything the bar
 * would render as a dropdown now renders as the bar's own {@link PillControl};
 * only a plain two-option field — one that did not ask for a dropdown, a tree
 * or a search — stays a flat checkbox row, which is a panel layout rather than
 * a different control (the filter panel draws the same line).
 */
function sharesBarControl<T extends Record<string, unknown>>(field: OverflowField<T>): boolean {
  const pill = field.pill;
  if (!pill) return false;
  return (
    pill.control === "category" ||
    pill.control === "multiselect" ||
    pill.searchEnabled === true ||
    pill.options.length > INLINE_OPTION_LIMIT
  );
}

/** One overflowed pill: the bar's control, or its options as checkboxes. */
function OverflowPill<T extends Record<string, unknown>>({
  field,
  values,
  onTogglePill,
  onClear,
  testIdPrefix,
}: {
  field: OverflowField<T>;
  values: string[];
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onClear: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const testId = `${testIdPrefix}-more-${field.id}`;
  if (field.pill && sharesBarControl(field)) {
    return (
      <PillControl
        fieldId={field.id}
        pill={field.pill}
        selected={values}
        onTogglePill={onTogglePill}
        onClearField={onClear}
        testIdPrefix={testIdPrefix}
        testId={testId}
      />
    );
  }
  const onToggle = (value: string, checked: boolean) => onTogglePill(field.id, value, checked);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {(field.pill?.options ?? []).map((option) => {
        const checked = values.includes(option.value);
        return (
          <Box
            key={option.value}
            component="label"
            data-testid={`${testId}-${option.value}`}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.25,
              pr: 1,
              border: 1,
              borderStyle: "solid",
              minHeight: fieldHeight,
              borderColor: (theme) => (checked ? theme.palette.primary.main : fieldEdge(theme)),
              bgcolor: checked ? "action.selected" : "transparent",
              borderRadius: fieldRadiusPx,
              cursor: "pointer",
              fontSize: sxRem(13),
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


/**
 * One overflowed range: its presets and its two bounds, as the same controls
 * the pill uses.
 *
 * The whole control DELEGATES to {@link RangeBounds} rather than being built
 * here, which is the point — this panel used to render a raw
 * `<input type="date">`, so the masked `dd/mm/aaaa` field existed only while
 * the filter FITTED on the bar. The moment "Data" overflowed it reverted to the
 * native control the mask replaced, and a merchant on a narrow screen never saw
 * the fix at all (FUT-744). `Valor` had the twin bug: a bare `type="number"`
 * plus `Number(raw)` dropped the decimal comma this panel is meant to accept.
 *
 * That also retires the intrinsic-width workaround this pair used to need — a
 * native date input reports a wide minimum (its own mask plus the picker
 * glyph), which is what made two of them refuse to shrink and scrolled the
 * panel sideways. A text input has no such minimum.
 *
 * `RangeBounds` renders the preset chips ITSELF, above the inputs. This panel
 * must NOT render its own row as well: when the delegation above landed, the
 * chips it used to draw by hand stayed behind, and "Data" showed Hoje/Ontem/
 * Esta semana/Este mês/Este ano twice — two rows, duplicated test ids, and half
 * the panel's height spent saying the same thing (FUT-751).
 */
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
}): React.JSX.Element | null {
  // `group === "range"` is what selects this component, so `range` is always
  // set; the guard is for the type, not for a state the caller can reach.
  if (!field.range) return null;
  return (
    <RangeBounds
      field={field.range}
      value={value}
      onChange={onChange}
      testId={`${testIdPrefix}-more-${field.id}`}
    />
  );
}

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
  const copy = useDataViewsCopy();
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
              fontSize: sxRem(12),
              color: "primary.main",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {copy.filters.clear}
          </Box>
        )}
      </Box>
      {field.group === "pill" ? (
        <OverflowPill
          field={field}
          values={pills[field.id] ?? []}
          onTogglePill={onTogglePill}
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

