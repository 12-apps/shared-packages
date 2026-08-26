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
import Box from "@mui/material/Box/index.js";
import { useState } from "react";


import { ClearAllControl, CloseSearchControl } from "./data-views-bar-controls";
import type { GridFilterPanelProps } from "./data-views-filter-panel";
import { MoreFilters } from "./data-views-more-filters";
import type { OverflowField, OverflowSplit } from "./data-views-overflow";
import { CollapsedSearch, InlineKeyword } from "./data-views-search";
import { PillControl } from "./data-views-category-pill";
import { RangePill } from "./data-views-range-pill";
import type { RangeValue } from "./data-views-types";



/* ── Inline (second-line) filter bar ─────────────────────────────────────── */

/** The search, in whichever of its two forms the measurement asked for. */
function SearchSlot({
  search,
  onSearchChange,
  collapsed,
  expanded,
  fill,
  onOpen,
  onEscape,
  testIdPrefix,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  collapsed: boolean;
  expanded: boolean;
  /** The box owns the cluster alone, so it may shrink below its usual floor. */
  fill: boolean;
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
      fill={fill}
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
      <PillControl
        fieldId={field.id}
        pill={field.pill}
        selected={pills[field.id] ?? []}
        onTogglePill={onTogglePill}
        onClearField={onClearField}
        onOpenChange={onOpenChange}
        testIdPrefix={testIdPrefix}
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
 * WHICH OF THE SEARCH'S THREE STATES THE BAR IS IN.
 *
 * Resting, expanded-and-sharing, or expanded-and-owning-the-cluster. They were
 * one boolean until a phone showed why they are not:
 *
 * - `fill` — an expanded box drops its usual 200px floor and takes whatever the
 *   cluster has. That floor is right for a box that lives on the row; it is
 *   wrong for one expanded into a cluster the ladder sized for an icon, where
 *   insisting on it made the row scroll sideways (154px of overhang at 320px,
 *   84px at 390px, 42px at 500px).
 * - `takesOver` — the narrower case, where shrinking has run out of road and
 *   what is left would be too small to read. Only then do the filters stand
 *   down. A large phone has room to share, and evicting them there cost the
 *   operator their filters for nothing.
 *
 * Once CLICKED the box stays open until Escape or its ✕, so typing is never
 * interrupted by a re-measure.
 */
function useSearchMode<T extends Record<string, unknown>>(
  split: OverflowSplit<T>,
): {
  showBox: boolean;
  expanded: boolean;
  fill: boolean;
  takesOver: boolean;
  open: () => void;
  close: () => void;
} {
  const [searchOpen, setSearchOpen] = useState(false);
  return {
    showBox: !split.searchCollapsed || searchOpen,
    expanded: searchOpen,
    fill: split.searchCollapsed && searchOpen,
    takesOver: searchOpen && split.searchTakeover,
    open: () => setSearchOpen(true),
    close: () => setSearchOpen(false),
  };
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
  const { inline, overflow, compactControls, clearAllHidden } = split;
  const { showBox, expanded, fill, takesOver, open, close } = useSearchMode(split);
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
        expanded={expanded}
        fill={fill}
        onOpen={open}
        onEscape={close}
        testIdPrefix={testIdPrefix}
      />
      {takesOver && <CloseSearchControl onClose={close} testIdPrefix={testIdPrefix} />}
      {!takesOver && (
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
      )}
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

