"use client";

import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, Chip, InputAdornment, Link, TextField, Typography } from "@mui/material";
import { useRef, useState } from "react";

import { StackedModal, StackedModalContent } from "../../feedback/StackedModal";
import { MultiSelectDropdown } from "../../layout/ContentToolbar";
import { TableFilter } from "../../layout/TableFilter";

import type {
  FilterFieldConfig,
  RangeFieldConfig,
  RangeValue,
} from "./data-views-types";

/* ── Filter panel ────────────────────────────────────────────────────────── */

interface GridFilterPanelProps<T extends Record<string, unknown>> {
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
            <TableFilter.RangeField
              key={field.id}
              label={field.label}
              unit={field.unit}
              step={field.step}
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

/* ── Inline (second-line) filter bar ─────────────────────────────────────── */

/** Compact keyword box for the inline bar: commits on Enter/blur (like the panel). */
function InlineKeyword({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const prev = useRef(value);
  if (prev.current !== value) {
    prev.current = value;
    if (draft !== value) setDraft(value);
  }
  const commit = (): void => {
    if (draft !== value) onChange(draft);
  };
  return (
    <TextField
      size="small"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
      placeholder="Buscar…"
      inputProps={{ "aria-label": "Buscar em todas as colunas", "data-testid": testId }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </InputAdornment>
        ),
      }}
      sx={{ minWidth: 220 }}
    />
  );
}

/** Props the inline bar needs (a subset of the slide-in panel's — no ranges). */
type InlineFilterBarProps<T extends Record<string, unknown>> = Pick<
  GridFilterPanelProps<T>,
  "testIdPrefix" | "search" | "fields" | "pills" | "onSearchChange" | "onTogglePill" | "onClearField" | "onClearAll"
>;

/** One removable active-filter chip: a search term or a selected pill value. */
interface ActiveChip {
  key: string;
  label: string;
  onDelete: () => void;
}

/**
 * A horizontal filter bar (used instead of the slide-in {@link GridFilterPanel} on
 * wide screens): the compact keyword search, each field as a rounded pill dropdown,
 * and — when anything is applied — a row of removable "active filter" chips. Range
 * filters are not shown here (the slide-in panel keeps those).
 */
export function InlineFilterBar<T extends Record<string, unknown>>({
  testIdPrefix,
  search,
  fields,
  pills,
  onSearchChange,
  onTogglePill,
  onClearField,
  onClearAll,
}: InlineFilterBarProps<T>): React.JSX.Element {
  // Flatten every applied filter into a removable chip (flatMap + map avoids a
  // nested loop). A chip's delete clears just that value; the search chip clears `q`.
  const pillChips: ActiveChip[] = fields.flatMap((field) =>
    (pills[field.id] ?? []).map((value) => ({
      key: `${field.id}:${value}`,
      label: `${field.label}: ${field.options.find((option) => option.value === value)?.label ?? value}`,
      onDelete: () => onTogglePill(field.id, value, false),
    })),
  );
  const chips: ActiveChip[] = [
    ...(search.trim() !== "" ? [{ key: "__search", label: `Busca: ${search}`, onDelete: () => onSearchChange("") }] : []),
    ...pillChips,
  ];
  return (
    <Box
      data-testid={`${testIdPrefix}-inline-filters`}
      sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1.5 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
        <InlineKeyword value={search} onChange={onSearchChange} testId={`${testIdPrefix}-search-all`} />
        {fields.map((field) => (
          <MultiSelectDropdown
            key={field.id}
            label={field.label}
            options={field.options}
            selected={new Set(pills[field.id] ?? [])}
            onToggle={(value, checked) => onTogglePill(field.id, value, checked)}
            onClear={() => onClearField(field.id)}
            allLabel="Todas"
            searchable={field.searchEnabled ? true : undefined}
            searchPlaceholder="Buscar…"
            noResultsLabel="Nenhum resultado"
            layout="pill"
            data-testid={`${testIdPrefix}-filter-${field.id}`}
          />
        ))}
      </Box>
      {chips.length > 0 && (
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
      )}
    </Box>
  );
}
