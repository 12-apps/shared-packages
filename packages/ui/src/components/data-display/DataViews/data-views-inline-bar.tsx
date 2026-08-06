"use client";

/**
 * The INLINE filter bar — the horizontal row of controls a grid renders instead
 * of the slide-in panel on a wide screen (`inlineFilters`): the compact keyword
 * box, one pill per facet, one pill per range, and the "Filtros ativos" chips
 * underneath.
 *
 * Split from `data-views-filter-panel` because they are two surfaces, not one:
 * the panel is a column of stacked fields, this is a row of pills, and the only
 * thing they share is the prop shape they are both driven by.
 */
import { Box, Button, Chip, Typography } from "@mui/material";
import { useState } from "react";

import { MultiSelectDropdown } from "../../layout/ContentToolbar";

import type { GridFilterPanelProps } from "./data-views-filter-panel";
import { MoreFilters } from "./data-views-more-filters";
import type { OverflowField, OverflowSplit } from "./data-views-overflow";
import { CollapsedSearch, InlineKeyword } from "./data-views-search";
import { isRangeSet, RangePill, rangeChipLabel } from "./data-views-range-pill";
import type { RangeValue } from "./data-views-types";



/* ── Inline (second-line) filter bar ─────────────────────────────────────── */

/** The search, in whichever of its two forms the measurement asked for. */
function SearchSlot({
  search,
  onSearchChange,
  collapsed,
  expanded,
  onOpen,
  onEscape,
  testIdPrefix,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  collapsed: boolean;
  expanded: boolean;
  onOpen: () => void;
  onEscape: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  if (collapsed) {
    return (
      <CollapsedSearch active={search !== ""} onOpen={onOpen} testId={`${testIdPrefix}-search-all`} />
    );
  }
  return (
    <InlineKeyword
      value={search}
      onChange={onSearchChange}
      testId={`${testIdPrefix}-search-all`}
      autoFocus={expanded}
      onEscape={onEscape}
    />
  );
}

/** Props the inline bar needs (the slide-in panel's, minus its own chrome). */
type InlineFilterBarProps<T extends Record<string, unknown>> = Pick<
  GridFilterPanelProps<T>,
  | "testIdPrefix"
  | "search"
  | "fields"
  | "rangeFields"
  | "pills"
  | "ranges"
  | "onSearchChange"
  | "onTogglePill"
  | "onChangeRange"
  | "onClearField"
  | "onClearAll"
> & {
  /** The measured degradation state, computed once in `GridShell`. */
  split: OverflowSplit<T>;
};

/** One removable active-filter chip: a search term, a pill value or a window. */
interface ActiveChip {
  key: string;
  label: string;
  onDelete: () => void;
}

/**
 * Every applied filter flattened into removable chips. A pill contributes one
 * chip per selected value (deleting one leaves the rest), while a RANGE
 * contributes a single chip for the whole window — "remove the period" means
 * both ends, not an arbitrary one.
 */
function activeChips<T extends Record<string, unknown>>({
  search,
  fields,
  rangeFields,
  pills,
  ranges,
  onSearchChange,
  onTogglePill,
  onChangeRange,
}: Pick<
  GridFilterPanelProps<T>,
  | "search"
  | "fields"
  | "rangeFields"
  | "pills"
  | "ranges"
  | "onSearchChange"
  | "onTogglePill"
  | "onChangeRange"
>): ActiveChip[] {
  const searchChip: ActiveChip[] =
    search.trim() === ""
      ? []
      : [{ key: "__search", label: `Busca: ${search}`, onDelete: () => onSearchChange("") }];
  const pillChips: ActiveChip[] = fields.flatMap((field) =>
    (pills[field.id] ?? []).map((value) => ({
      key: `${field.id}:${value}`,
      label: `${field.label}: ${field.options.find((option) => option.value === value)?.label ?? value}`,
      onDelete: () => onTogglePill(field.id, value, false),
    })),
  );
  const rangeChips: ActiveChip[] = rangeFields.flatMap((field) => {
    const range = ranges[field.id];
    if (!range || !isRangeSet(range)) return [];
    return [
      {
        key: `range:${field.id}`,
        label: rangeChipLabel(field, range),
        onDelete: () => onChangeRange(field.id, {}),
      },
    ];
  });
  return [...searchChip, ...pillChips, ...rangeChips];
}

/**
 * A horizontal filter bar (used instead of the slide-in {@link GridFilterPanel} on
 * wide screens): the compact keyword search, each field as a rounded pill dropdown,
 * and — when anything is applied — a row of removable "active filter" chips. Range
 * filters are not shown here (the slide-in panel keeps those).
 */
/**
 * One filter control on the bar: a multi-select pill or a min/max range. The
 * two are the same thing from the bar's point of view — a labelled control that
 * writes into the view state — so which one to build is decided here rather
 * than in the bar's own render.
 */
function InlineControl<T extends Record<string, unknown>>({
  field,
  pills,
  ranges,
  onTogglePill,
  onChangeRange,
  onClearField,
  testIdPrefix,
}: {
  field: OverflowField<T>;
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onChangeRange: (fieldId: string, range: RangeValue) => void;
  onClearField: (fieldId: string) => void;
  testIdPrefix: string;
}): React.JSX.Element | null {
  if (field.group === "pill" && field.pill) {
    return (
      <MultiSelectDropdown
        label={field.pill.label}
        options={field.pill.options}
        selected={new Set(pills[field.id] ?? [])}
        onToggle={(value, checked) => onTogglePill(field.id, value, checked)}
        onClear={() => onClearField(field.id)}
        allLabel="Todas"
        searchable={field.pill.searchEnabled ? true : undefined}
        searchPlaceholder="Buscar…"
        noResultsLabel="Nenhum resultado"
        layout="pill"
        data-testid={`${testIdPrefix}-filter-${field.id}`}
      />
    );
  }
  if (field.group === "range" && field.range) {
    return (
      <RangePill
        field={field.range}
        value={ranges[field.id] ?? {}}
        onChange={(range) => onChangeRange(field.id, range)}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return null;
}

export function InlineFilterBar<T extends Record<string, unknown>>({
  testIdPrefix,
  search,
  fields,
  rangeFields,
  pills,
  ranges,
  onSearchChange,
  onTogglePill,
  onChangeRange,
  onClearField,
  onClearAll,
  split,
}: InlineFilterBarProps<T>): React.JSX.Element {
  const chips = activeChips({
    search,
    fields,
    rangeFields,
    pills,
    ranges,
    onSearchChange,
    onTogglePill,
    onChangeRange,
  });
  // MEASURED, not breakpointed — and measured ONCE, in the shell, because the
  // toolbar above needs the same answer to drop its labels. See `useFilterOverflow`.
  const { inline, overflow, searchCollapsed, barRef } = split;
  // Expanded by the operator: a collapsed search that was CLICKED stays open
  // until Escape, so typing is never interrupted by a re-measure.
  const [searchOpen, setSearchOpen] = useState(false);
  const showBox = !searchCollapsed || searchOpen;
  const renderControl = (field: OverflowField<T>): React.JSX.Element | null => (
    <InlineControl
      key={field.id}
      field={field}
      pills={pills}
      ranges={ranges}
      onTogglePill={onTogglePill}
      onChangeRange={onChangeRange}
      onClearField={onClearField}
      testIdPrefix={testIdPrefix}
    />
  );
  return (
    <Box
      data-testid={`${testIdPrefix}-inline-filters`}
      sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1.5 }}
    >
      <Box ref={barRef} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
        <SearchSlot
          search={search}
          onSearchChange={onSearchChange}
          collapsed={!showBox}
          expanded={searchOpen}
          onOpen={() => setSearchOpen(true)}
          onEscape={() => setSearchOpen(false)}
          testIdPrefix={testIdPrefix}
        />
        {inline.map(renderControl)}
        <MoreFilters
          fields={overflow}
          pills={pills}
          ranges={ranges}
          onTogglePill={onTogglePill}
          onChangeRange={onChangeRange}
          testIdPrefix={testIdPrefix}
        />
      </Box>
      <ActiveChipRow
        chips={chips}
        testIdPrefix={testIdPrefix}
        onClearAll={onClearAll}
      />
    </Box>
  );
}

/**
 * The "Filtros ativos:" row — one removable chip per applied filter plus the
 * single "Limpar" that drops them all. Renders nothing when nothing is applied,
 * so the bar collapses to its controls.
 */
function ActiveChipRow({
  chips,
  testIdPrefix,
  onClearAll,
}: {
  chips: ActiveChip[];
  testIdPrefix: string;
  onClearAll: () => void;
}): React.JSX.Element | null {
  if (chips.length === 0) return null;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
      <Typography component="span" sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
        Filtros ativos:
      </Typography>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          label={chip.label}
          size="small"
          variant="outlined"
          onDelete={chip.onDelete}
          data-testid={`${testIdPrefix}-active-${chip.key}`}
        />
      ))}
      <Button
        variant="text"
        size="small"
        color="inherit"
        onClick={onClearAll}
        data-testid={`${testIdPrefix}-clear-filters`}
        sx={{ fontSize: "0.75rem", color: "text.secondary", textTransform: "none" }}
      >
        Limpar
      </Button>
    </Box>
  );
}
