"use client";

/**
 * The INLINE filter bar — the horizontal row of controls a grid renders instead
 * of the slide-in panel on a wide screen (`inlineFilters`): the compact keyword
 * box, one pill per facet, one pill per range, and "Mais N" for whatever had no
 * room.
 *
 * There is no "Filtros ativos" row beneath it. Listing every applied filter a
 * second time, under the controls already showing them, was the same
 * information twice — and put the ✕ that removes a filter somewhere other than
 * the control that applied it. Each pill carries its own.
 *
 * Split from `data-views-filter-panel` because they are two surfaces, not one:
 * the panel is a column of stacked fields, this is a row of pills, and the only
 * thing they share is the prop shape they are both driven by.
 */
import FilterAltOffRoundedIcon from "@mui/icons-material/FilterAltOffRounded";
import { Box, Tooltip } from "@mui/material";
import { useState } from "react";

import { Button } from "../../form/Button";
import { MultiSelectDropdown } from "../../layout/ContentToolbar";

import type { GridFilterPanelProps } from "./data-views-filter-panel";
import { MoreFilters } from "./data-views-more-filters";
import type { OverflowField, OverflowSplit } from "./data-views-overflow";
import { CollapsedSearch, InlineKeyword } from "./data-views-search";
import { RangePill } from "./data-views-range-pill";
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
  onOpenChange,
  testIdPrefix,
}: {
  field: OverflowField<T>;
  onOpenChange?: (open: boolean) => void;
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
        onOpenChange={onOpenChange}
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
        onOpenChange={onOpenChange}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return null;
}

/**
 * "Limpar" — one gesture back to the unfiltered list.
 *
 * Present ONLY while something is applied, and last in the cluster, because it
 * is destructive and must never be where a filter control was a moment ago.
 * Each pill already carries its own ✕; this is the other job — six applied
 * filters is six ✕ hunts, and the operator who wants "show me everything
 * again" has no way to say it.
 *
 * Loses its label on the same rung Exibir/Exportar lose theirs, and keeps a
 * tooltip when it does: it is one of the two controls (with the search) whose
 * icon has to carry the whole meaning on a phone.
 */
function ClearAllControl({
  onClearAll,
  compact,
  testIdPrefix,
}: {
  onClearAll: () => void;
  compact: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  const button = (
    <Button
      variant="outline"
      size="sm"
      color="neutral"
      onClick={onClearAll}
      dataTestId={`${testIdPrefix}-clear-all`}
      aria-label="Limpar filtros"
    >
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <FilterAltOffRoundedIcon fontSize="small" />
        {!compact && <Box component="span">Limpar</Box>}
      </Box>
    </Button>
  );
  return compact ? <Tooltip title="Limpar filtros">{button}</Tooltip> : button;
}

/**
 * The filter CONTROLS alone — search, the fields that fit, and "Mais N" for the
 * ones that don't — with no row chrome of its own, because it is rendered ON
 * the toolbar line rather than under it (`ContentToolbar`'s `leadingControls`).
 *
 * The measurement driving the collapse lives on the toolbar ROW, not here —
 * see the note on `split` below.
 */
export function InlineFilterControls<T extends Record<string, unknown>>({
  testIdPrefix,
  pills,
  ranges,
  search,
  onSearchChange,
  onTogglePill,
  onChangeRange,
  onClearField,
  split,
  onClearAll,
  activeFilterCount,
  onControlOpenChange,
}: Omit<InlineFilterBarProps<T>, "fields" | "rangeFields"> & {
  /** How many filters are applied — decides whether "Limpar" is on the bar at all. */
  activeFilterCount: number;
  /** Reports a control opening/closing so the shell can freeze the measurement. */
  onControlOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  // MEASURED, not breakpointed — and measured ONCE, in the shell, because the
  // toolbar around it needs the same answer to drop its labels. The measured
  // element is the whole toolbar ROW (see `GridToolbar`), not this cluster:
  // `RESERVED` prices the counter and Exibir/Exportar, so measuring only the
  // controls would charge for that furniture a second time and collapse the
  // ladder while the row still had hundreds of free pixels.
  const { inline, overflow, searchCollapsed, compactControls, clearAllHidden } = split;
  // Expanded by the operator: a collapsed search that was CLICKED stays open
  // until Escape, so typing is never interrupted by a re-measure.
  const [searchOpen, setSearchOpen] = useState(false);
  const showBox = !searchCollapsed || searchOpen;
  return (
    <Box
      data-testid={`${testIdPrefix}-inline-filters`}
      sx={{
        display: "flex",
        flexWrap: "nowrap",
        alignItems: "center",
        gap: 1,
        minWidth: 0,
        // No squeezing: if the estimate over-packs, the row must overflow (and
        // the next measure sheds a control), not shrink labels to an ellipsis.
        "& > *": { flexShrink: 0 },
      }}
    >
      <SearchSlot
        search={search}
        onSearchChange={onSearchChange}
        collapsed={!showBox}
        expanded={searchOpen}
        onOpen={() => setSearchOpen(true)}
        onEscape={() => setSearchOpen(false)}
        testIdPrefix={testIdPrefix}
      />
      <FilterSlots
        inline={inline}
        overflow={overflow}
        pills={pills}
        ranges={ranges}
        onTogglePill={onTogglePill}
        onChangeRange={onChangeRange}
        onClearField={onClearField}
        onClearAll={onClearAll}
        onControlOpenChange={onControlOpenChange}
        activeFilterCount={activeFilterCount}
        compactControls={compactControls}
        clearAllHidden={clearAllHidden}
        testIdPrefix={testIdPrefix}
      />
    </Box>
  );
}

/**
 * Everything to the right of the search: the fields that fit, "Mais N" for the
 * ones that don't, and "Limpar". Split out of `InlineFilterControls` only to
 * keep that function inside the size gate — the three are one cluster and the
 * order they render in is the order they shed in.
 */
function FilterSlots<T extends Record<string, unknown>>({
  inline,
  overflow,
  pills,
  ranges,
  onTogglePill,
  onChangeRange,
  onClearField,
  onClearAll,
  onControlOpenChange,
  activeFilterCount,
  compactControls,
  clearAllHidden,
  testIdPrefix,
}: {
  inline: OverflowField<T>[];
  overflow: OverflowField<T>[];
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onChangeRange: (fieldId: string, range: RangeValue) => void;
  onClearField: (fieldId: string) => void;
  onClearAll: () => void;
  onControlOpenChange?: (open: boolean) => void;
  activeFilterCount: number;
  compactControls: boolean;
  clearAllHidden: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <>
      {inline.map((field) => (
        <InlineControl
          key={field.id}
          field={field}
          onOpenChange={onControlOpenChange}
          pills={pills}
          ranges={ranges}
          onTogglePill={onTogglePill}
          onChangeRange={onChangeRange}
          onClearField={onClearField}
          testIdPrefix={testIdPrefix}
        />
      ))}
      <MoreFilters
        onOpenChange={onControlOpenChange}
        onClearAll={onClearAll}
        anyApplied={activeFilterCount > 0}
        compact={compactControls}
        fields={overflow}
        pills={pills}
        ranges={ranges}
        onTogglePill={onTogglePill}
        onChangeRange={onChangeRange}
        testIdPrefix={testIdPrefix}
      />
      {activeFilterCount > 0 && !clearAllHidden && (
        <ClearAllControl
          onClearAll={onClearAll}
          compact={compactControls}
          testIdPrefix={testIdPrefix}
        />
      )}
    </>
  );
}

