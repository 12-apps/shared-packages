"use client";

import { Box, Link } from "@mui/material";

import { StackedModal, StackedModalContent } from "../../feedback/StackedModal";
import { MultiSelectDropdown } from "../../layout/ContentToolbar";
import { TableFilter } from "../../layout/TableFilter";

import { PanelRangeField } from "./data-views-range-pill";
import type {
  FilterFieldConfig,
  RangeFieldConfig,
  RangeValue,
} from "./data-views-types";

/* ── Filter panel ────────────────────────────────────────────────────────── */

export interface GridFilterPanelProps<T extends Record<string, unknown>> {
  testIdPrefix: string;
  search: string;
  fields: FilterFieldConfig<T>[];
  rangeFields: RangeFieldConfig<T>[];
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  onSearchChange: (value: string) => void;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onChangeRange: (fieldId: string, range: RangeValue) => void;
  onClearField: (fieldId: string) => void;
  onClearAll: () => void;
}

/** One pill field: a compact multi-select for long lists, else a checkbox list. */
function PillField<T extends Record<string, unknown>>({
  field,
  selected,
  testIdPrefix,
  onTogglePill,
  onClearField,
}: {
  field: FilterFieldConfig<T>;
  selected: string[];
  testIdPrefix: string;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onClearField: (fieldId: string) => void;
}): React.JSX.Element {
  const testId = `${testIdPrefix}-filter-${field.id}`;
  // `searchEnabled` forces the searchable multi-select; a plain `multiselect`
  // keeps the auto "search only when the list is long" rule.
  if (field.searchEnabled || field.control === "multiselect") {
    return (
      <MultiSelectDropdown
        label={field.label}
        options={field.options}
        selected={new Set(selected)}
        onToggle={(value, checked) => onTogglePill(field.id, value, checked)}
        onClear={() => onClearField(field.id)}
        allLabel="Todas"
        searchable={field.searchEnabled ? true : undefined}
        searchPlaceholder="Buscar…"
        noResultsLabel="Nenhum resultado"
        layout="stacked"
        data-testid={testId}
      />
    );
  }
  return (
    <TableFilter.CheckboxField
      label={field.label}
      options={field.options}
      selected={new Set(selected)}
      onToggle={(value, checked) => onTogglePill(field.id, value, checked)}
      testId={testId}
    />
  );
}

/** The filter controls (keyword + pill facets + numeric ranges), surface-agnostic. */
function FilterControls<T extends Record<string, unknown>>({
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
}: Omit<GridFilterPanelProps<T>, "onClearAll">): React.JSX.Element {
  return (
    <>
      <TableFilter.Keyword
        value={search}
        onChange={onSearchChange}
        label="Buscar em todas as colunas"
        placeholder="Pressione Enter para filtrar"
        testId={`${testIdPrefix}-search-all`}
      />
      {(fields.length > 0 || rangeFields.length > 0) && (
        <TableFilter.Section title="Filtros">
          {fields.map((field) => (
            <PillField
              key={field.id}
              field={field}
              selected={pills[field.id] ?? []}
              testIdPrefix={testIdPrefix}
              onTogglePill={onTogglePill}
              onClearField={onClearField}
            />
          ))}
          {rangeFields.map((field) => (
            <PanelRangeField
              key={field.id}
              field={field}
              value={ranges[field.id] ?? {}}
              onChange={(range) => onChangeRange(field.id, range)}
              testId={`${testIdPrefix}-range-${field.id}`}
            />
          ))}
        </TableFilter.Section>
      )}
    </>
  );
}

/** The slide-in filter panel: keyword + checkbox facets + numeric ranges. */
export function GridFilterPanel<T extends Record<string, unknown>>(
  props: GridFilterPanelProps<T>,
): React.JSX.Element {
  return (
    <TableFilter.Panel
      onClearAll={props.onClearAll}
      clearTestId={`${props.testIdPrefix}-clear-filters`}
      ariaLabel="Filtros"
    >
      <FilterControls {...props} />
    </TableFilter.Panel>
  );
}

/** Props for the modal filter surface used below the inline breakpoint. */
interface FilterDialogProps<T extends Record<string, unknown>> extends GridFilterPanelProps<T> {
  open: boolean;
  onClose: () => void;
}

/**
 * The same filter controls in a centered modal — used on smaller screens where the
 * slide-in panel would overlap the table. The "Filtros" toolbar button opens it.
 */
export function FilterDialog<T extends Record<string, unknown>>({
  open,
  onClose,
  ...props
}: FilterDialogProps<T>): React.JSX.Element {
  return (
    <StackedModal
      open={open}
      onClose={onClose}
      navigationTitle="Filtros"
      modalId={`${props.testIdPrefix}-filters`}
      maxWidth="xs"
      dataTestId={`${props.testIdPrefix}-filter-dialog`}
    >
      <StackedModalContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={props.onClearAll}
              data-testid={`${props.testIdPrefix}-clear-filters`}
              sx={{ fontSize: "0.75rem", color: "text.secondary" }}
            >
              Clear All Filters
            </Link>
          </Box>
          <FilterControls {...props} />
        </Box>
      </StackedModalContent>
    </StackedModal>
  );
}
