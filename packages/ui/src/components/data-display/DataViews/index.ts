/**
 * DataViews — the reusable admin table/grid machinery (FUT-88/89): a filter bar,
 * saved views, sort, column visibility, select-all + bulk actions, and an opt-in
 * "Grade" (cards) layout. Framework-agnostic: {@link DataViewsTableBase} takes its
 * saved-view persistence + router side-effects as injected props, so a host app
 * wires them to its backend and framework router.
 */
export { BaseCard } from "./base-card";
export { BaseListCard, type BaseListCardProps } from "./base-list-card";
// THE LIST'S HALF OF THE CARD API. `BaseListCard` alone is not usable as
// designed: its cells are declared by the GROUP and typed by
// `ListCardCellConfig`, and without these a consumer can only fall back to the
// named slots and standalone rails — which is the layout the cell config
// replaced, and gives up the alignment that was the point.
export {
  ListCardGroup,
  DEFAULT_RAILS,
  RAIL_COUNT,
  type ListRails,
} from "./list-card-rails";
export {
  type ListCardCellConfig,
  DEFAULT_CELL_WIDTH,
} from "./list-card-cells";
// The list's columns declared at the TABLE, not per card — which is what makes
// a Lista line up by construction. Without it a consumer can still hand a cell
// config to each row, and they agree until one row carries a wider value.
export type { ListGroupConfig } from "./list-card-rails";
// Published by a drag container so a row can draw the marker; a consumer wiring
// its own DnD needs the type to build the value.
export { DropIndicator } from "./data-views-drag";
export {
  DragContainerProvider,
  useDragItem,
  type DragContainerValue,
  type DragItemProps,
} from "./data-views-drag";
export { DataViewsGrid } from "./DataViewsGrid";
export { DataViewsTableBase, type DataViewsTableBaseProps } from "./DataViewsTableBase";
export { toSavedViewSummary, CARD_ASPECT_RATIOS, DATA_VIEWS_LAYOUTS } from "./data-views-types";
export { cardScaleForZoom, cardMinWidthForZoom } from "./data-views-layout-context";
export { DataViewsBoard, type BoardConfig, type BoardGroup } from "./DataViewsBoard";
export type {
  DataViewExport,
  DataViewExportFormat,
  DataViewExportRequest,
} from "./data-views-export";
export type { SelectionExtraContext, SelectionExtraRender } from "./data-views-selection-extra";
export {
  DataViewsScopeTabs,
  resolveScope,
  assertNoScopePillOverlap,
  type ScopeConfig,
} from "./data-views-scopes";
export type {
  RowAction,
  DataViewCardSelection,
  CardAspectRatio,
  SavedViewSummary,
  DataViewState,
  DataViewSyncState,
  DataViewsLayout,
  DataViewColumn,
  FilterFieldConfig,
  RangeFieldConfig,
  RangeFieldKind,
  RangeValue,
  RangePreset,
  NumberRangeFieldConfig,
  DayRangeFieldConfig,
  DataViewPersistence,
  DataViewRouter,
  DataViewSaveInput,
  DataViewMutationResult,
  DataViewQuery,
  DataViewServer,
} from "./data-views-types";

// The words this surface renders, and the provider that puts them in scope.
// REQUIRED config: `useDataViewsCopy` throws outside a provider rather than
// falling back to the origin host's Portuguese (FUT-760).
export { DataViewsCopyProvider, useDataViewsCopy } from "./data-views-copy-context";
export type {
  DataViewsCopy,
  DataViewsBoardCopy,
  DeleteViewCopy,
  ManageViewsCopy,
  SaveViewCopy,
  DataViewsColumnsCopy,
  DataViewsDisplayCopy,
  DataViewsExportCopy,
  DataViewsGridCopy,
  DataViewsFiltersCopy,
  DataViewsSelectionCopy,
  DataViewsNavCopy,
  DataViewsSearchCopy,
} from "./data-views-copy";
