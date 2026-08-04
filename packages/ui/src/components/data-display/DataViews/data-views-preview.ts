import type {
  DataViewColumn,
  DataViewState,
  FilterFieldConfig,
} from "./data-views-types";

/**
 * Human-readable summary of a view state (FUT-89), used by the save-view modal's
 * preview and the manage dialog. Pure + label-driven so it is unit-testable and
 * shared. Returns empty arrays for sections with nothing set.
 */
interface ViewStateDescription {
  filters: string[];
  columns: string[];
  sort: string[];
}

function columnLabel<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
  id: string,
): string {
  const col = columns.find((c) => c.id === id);
  if (col && typeof col.header === "string" && col.header) return col.header;
  return id;
}

export function describeViewState<T extends Record<string, unknown>>(
  state: DataViewState,
  fields: FilterFieldConfig<T>[],
  columns: DataViewColumn<T>[],
): ViewStateDescription {
  const filters: string[] = [];
  if (state.search.trim()) filters.push(`Busca: "${state.search.trim()}"`);
  for (const field of fields) {
    const selected = state.pills[field.id];
    if (!selected || selected.length === 0) continue;
    const labels = selected.map(
      (value) => field.options.find((option) => option.value === value)?.label ?? value,
    );
    filters.push(`${field.label}: ${labels.join(", ")}`);
  }

  const hideable = columns.filter((col) => col.hideable !== false);
  const columnsShown = hideable
    .filter((col) => state.visibleColumns.includes(col.id))
    .map((col) => columnLabel(columns, col.id));

  const sort = state.sortBy
    .filter((entry) => entry.dir)
    .map((entry) => `${columnLabel(columns, entry.id)} (${entry.dir === "asc" ? "crescente" : "decrescente"})`);

  return { filters, columns: columnsShown, sort };
}
