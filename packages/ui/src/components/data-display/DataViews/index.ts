/**
 * DataViews — the reusable admin table/grid machinery (FUT-88/89): a filter bar,
 * saved views, sort, column visibility, select-all + bulk actions, and an opt-in
 * "Grade" (cards) layout. Framework-agnostic: {@link DataViewsTableBase} takes its
 * saved-view persistence + router side-effects as injected props, so a host app
 * wires them to its backend and framework router.
 */
export { BaseCard } from "./base-card";
export { DataViewsGrid } from "./DataViewsGrid";
export { DataViewsTableBase, type DataViewsTableBaseProps } from "./DataViewsTableBase";
export { toSavedViewSummary, CARD_ASPECT_RATIOS } from "./data-views-types";
export { cardScaleForZoom, cardMinWidthForZoom } from "./data-views-layout-context";
export type {
  RowAction,
  DataViewCardSelection,
  CardAspectRatio,
  SavedViewSummary,
  DataViewState,
  DataViewSyncState,
  DataViewColumn,
  FilterFieldConfig,
  RangeFieldConfig,
  DataViewPersistence,
  DataViewRouter,
  DataViewSaveInput,
  DataViewMutationResult,
  DataViewQuery,
  DataViewServer,
} from "./data-views-types";
