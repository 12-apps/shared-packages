"use client";

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Checkbox, Popover } from "@mui/material";
import { useState } from "react";

import { MultiSelectDropdown } from "../../layout/ContentToolbar";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { OverflowField } from "./data-views-overflow";
import { RangeBounds } from "./data-views-range-pill";
import { isRangeSet } from "./data-views-range-values";
import type { RangeValue } from "./data-views-types";

/**
 * "MAIS" — the filter overflow.
 *
 * It holds ONLY the fields that had no room on the toolbar, which is why its
 * badge counts hidden FIELDS rather than active filters: an applied filter
 * keeps its inline control (see `useFilterOverflow`), because a filter you
 * cannot see is a filter you forget you set, and then the list is "wrong" for
 * a reason nothing on screen explains.
 *
 * A field with one or two options renders FLAT — inside a panel there is no
 * space to win back, and two labelled checkboxes are faster than a dropdown
 * needing a second click. Past that it becomes a {@link MultiSelectDropdown}:
 * see `INLINE_OPTION_LIMIT`.
 */

interface MoreFiltersProps<T extends Record<string, unknown>> {
  fields: OverflowField<T>[];
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

/**
 * One overflowed range: its two bounds, as the same inputs the pill uses.
 *
 * It DELEGATES to {@link RangeBounds} rather than building its own pair, which
 * is the whole point — this panel used to render a raw `<input type="date">`,
 * so the masked `dd/mm/aaaa` field only existed while the filter fitted on the
 * bar. The moment "Data" overflowed it silently reverted to the native control
 * the mask replaced, and a merchant on a narrow screen never saw the fix at all
 * (FUT-744). `Valor` had the twin bug: a bare `type="number"` plus `Number(raw)`
 * dropped the decimal comma this panel is expected to accept.
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

/** The trigger, badged with how many fields had no room on the bar. */
function MoreTrigger({
  count,
  onOpen,
  testIdPrefix,
}: {
  count: number;
  onOpen: (anchor: HTMLElement) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      color="neutral"
      onClick={(event) => onOpen(event.currentTarget as HTMLElement)}
      dataTestId={`${testIdPrefix}-more-filters`}
      aria-label={`Mais filtros: ${count} sem espaço na barra`}
    >
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <TuneRoundedIcon fontSize="small" />
        <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
          Mais
        </Box>
        <Box
          component="span"
          sx={{ px: 0.75, borderRadius: 5, bgcolor: "action.selected", fontSize: "0.6875rem" }}
        >
          {count}
        </Box>
        <KeyboardArrowDownRoundedIcon fontSize="small" />
      </Box>
    </Button>
  );
}

/** One labelled group in the panel: the field's name, then its control. */
function MoreGroup<T extends Record<string, unknown>>({
  field,
  pills,
  ranges,
  onTogglePill,
  onChangeRange,
  testIdPrefix,
}: {
  field: OverflowField<T>;
} & Omit<MoreFiltersProps<T>, "fields">): React.JSX.Element {
  return (
    <Box sx={{ mb: 1.5, "&:last-of-type": { mb: 0 } }}>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
          {field.label}
          {field.group === "range" && isRangeSet(ranges[field.id] ?? {}) ? " •" : ""}
        </Box>
      </Text>
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

/** The panel's heading: what these are, and why they are in here. */
function MoreHeading(): React.JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Text variant="caption" as="span">
        <Box component="span" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.disabled" }}>
          Mais filtros
        </Box>
      </Text>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ ml: "auto", color: "text.disabled" }}>
          sem espaço na barra
        </Box>
      </Text>
    </Box>
  );
}

/** The overflow trigger + panel. Renders nothing when everything fits. */
export function MoreFilters<T extends Record<string, unknown>>({
  fields,
  ...rest
}: MoreFiltersProps<T>): React.JSX.Element | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (fields.length === 0) return null;
  return (
    <>
      <MoreTrigger count={fields.length} onOpen={setAnchor} testIdPrefix={rest.testIdPrefix} />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box data-testid={`${rest.testIdPrefix}-more-panel`}>
          <MoreHeading />
          <Box sx={{ maxHeight: 320, overflowY: "auto", p: 1.5 }}>
            {fields.map((field) => (
              <MoreGroup key={field.id} field={field} {...rest} />
            ))}
          </Box>
        </Box>
      </Popover>
    </>
  );
}
