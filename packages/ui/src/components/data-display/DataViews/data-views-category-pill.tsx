"use client";

import { useDataViewsCopy } from "./data-views-copy-context";
import { CategorySelect } from "../../form/CategorySelect";
import { MultiSelectDropdown } from "../../layout/ContentToolbar";

import type { FilterFieldConfig, FilterOption } from "./data-views-types";

/**
 * Diff a whole-array selection back into per-value toggles.
 *
 * The filter state's only channel is `onTogglePill(field, value, checked)`, but
 * a tree hands back the entire selection at once. Diffing here keeps that one
 * channel the single way a pill ever changes, rather than giving the
 * hierarchical control a private path into the state.
 */
export function emitPillDiff(
  fieldId: string,
  before: readonly string[],
  after: readonly string[],
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void,
): void {
  const had = new Set(before);
  const wants = new Set(after);
  after.forEach((value) => {
    if (!had.has(value)) onTogglePill(fieldId, value, true);
  });
  before.forEach((value) => {
    if (!wants.has(value)) onTogglePill(fieldId, value, false);
  });
}

/** A filter option as the category tree wants it. */
const toCategoryOption = (option: FilterOption) => ({
  id: option.value,
  name: option.label,
  parentId: option.parentId ?? null,
});

interface PillControlProps<T extends Record<string, unknown>> {
  fieldId: string;
  pill: FilterFieldConfig<T>;
  selected: string[];
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onClearField: (fieldId: string) => void;
  onOpenChange?: (open: boolean) => void;
  testIdPrefix: string;
  /** `stacked` in the filter panel, `pill` on the inline bar. */
  layout?: "stacked" | "pill";
}

/**
 * One filter pill: the hierarchical category tree, or the flat multi-select.
 *
 * A category set nests, and flattening it into one list is what made "Massas"
 * (mercearia) indistinguishable from "Massas" (pratos principais). `control:
 * "category"` opts a field into the tree, which shows each hit under its parent.
 */
export function PillControl<T extends Record<string, unknown>>({
  fieldId,
  pill,
  selected,
  onTogglePill,
  onClearField,
  onOpenChange,
  testIdPrefix,
  layout = "pill",
}: PillControlProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const testId = `${testIdPrefix}-filter-${fieldId}`;
  if (pill.control === "category") {
    return (
      <CategorySelect
        copy={copy.categorySelect}
        placeholder={pill.label}
        label={layout === "stacked" ? pill.label : undefined}
        fullWidth={layout === "stacked"}
        options={pill.options.map(toCategoryOption)}
        value={selected}
        onChange={(next) => emitPillDiff(fieldId, selected, next, onTogglePill)}
        dataTestId={testId}
      />
    );
  }
  return (
    <MultiSelectDropdown
      clearLabel={copy.filters.clearRange(pill.label)}
      label={pill.label}
      options={pill.options}
      selected={new Set(selected)}
      onToggle={(value, checked) => onTogglePill(fieldId, value, checked)}
      onClear={() => onClearField(fieldId)}
      allLabel={copy.filters.allOption}
      searchable={pill.searchEnabled ? true : undefined}
      searchPlaceholder={copy.filters.optionSearchPlaceholder}
      noResultsLabel={copy.filters.optionsEmpty}
      layout={layout}
      onOpenChange={onOpenChange}
      data-testid={testId}
    />
  );
}
