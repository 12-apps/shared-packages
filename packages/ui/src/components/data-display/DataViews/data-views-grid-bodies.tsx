"use client";

import React, { useRef } from "react";

import { DataGrid, type GridColumn, type GridSort } from "../DataGrid";
import { Box } from "../../../mui/Box";

import {
  cardTargetWidthFor,
  cardScaleForZoom,
  DENSITY_BOARD_SCALE,
  DENSITY_ROW_PADDING,
  useDataViewsLayout,
  type DataViewsDensity,
} from "./data-views-layout-context";
import { DataViewsBoard, type BoardConfig } from "./DataViewsBoard";
import { CardBody } from "./data-views-card-body";
import { SelectAllStrip } from "./data-views-select-all-strip";
import { ListCardGroup, type ListGroupConfig } from "./list-card-rails";
import type { DataViewCardSelection } from "./data-views-types";
import { toGridExpansion, type DataViewRowDetail } from "./data-views-row-detail";
import type { DataViewsController } from "./use-data-views-state";
import { useDataViewsCopy } from "./data-views-copy-context";
import { sxRem } from "../../../tokens/relative";
import { useStickyTableHead } from "./data-views-sticky-head";

/* ── Body (grid) ─────────────────────────────────────────────────────────── */

interface GridBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  columns: GridColumn<T>[];
  getRowId: (row: T) => string | number;
  selectedIds: Array<string | number>;
  onChangeSelected: (ids: Array<string | number>) => void;
  /** False ⇒ no checkbox column at all: no header select-all, no row box, no width. */
  selectable: boolean;
  sortBy: GridSort[];
  onChangeSortBy: (next: GridSort[]) => void;
  /** "server" defers ordering to the backend (rows render as-is); "client" sorts in-grid. */
  sortMode: "client" | "server";
  /** Vertical cell padding, from the density preference. */
  rowPadding: number;
  rowDetail?: DataViewRowDetail<T>;
  dataTestId?: string;
  emptyState?: React.ReactNode;
  /** The header row follows the page scroll under the sticky toolbar. */
  stickyHead?: boolean;
}

/** The dense DataGrid with multi-select (unless opted out), wrapped in the scrollable table region. */
function GridBody<T extends Record<string, unknown>>({
  rows,
  columns,
  getRowId,
  selectedIds,
  onChangeSelected,
  selectable,
  sortBy,
  onChangeSortBy,
  sortMode,
  rowPadding,
  rowDetail,
  dataTestId,
  emptyState,
  stickyHead = false,
}: GridBodyProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const wrapperRef = useRef<HTMLDivElement>(null);
  useStickyTableHead(wrapperRef, stickyHead);
  return (
    <Box
      ref={wrapperRef}
      sx={{
        width: "100%",
        overflowX: "auto",
        mt: 1.5,
        // Tabwoah-style dense rows: MUI's default TableCell padding keeps rows
        // tall regardless of rowHeight, so the DENSITY preference is applied
        // here rather than through `rowHeight`, which it would fight.
        "& .MuiTableCell-root": { py: rowPadding, fontSize: sxRem(13) },
        "& .MuiTableCell-head": { py: 0.5, fontSize: sxRem(12) },
      }}
    >
      <DataGrid<T>
        rows={rows}
        columns={columns}
        getRowId={(row) => getRowId(row)}
        virtualizeRows={false}
        density="compact"
        rowHeight={36}
        headerHeight={36}
        selection={selectable ? { mode: "multi", selectedRowIds: selectedIds, onChangeSelected } : { mode: "none" }}
        sorting={{ mode: sortMode, sortBy, onChangeSortBy }}
        expansion={toGridExpansion(rowDetail, copy)}
        data-testid={dataTestId}
        emptyState={emptyState}
        emptyText={copy.grid.emptyFilteredTitle}
        copy={copy.grid}
      />
    </Box>
  );
}

/* ── Body (list) ─────────────────────────────────────────────────────────── */

interface ListBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  renderListRow: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  /** Absent on a grid that is not selectable: rows get no toggle, so no checkbox. */
  onToggleId?: (id: string | number) => void;
  /** Gap between rows, from the density preference. */
  rowGap: number;
  /** The list's shared column config. See {@link ListGroupConfig}. */
  group?: ListGroupConfig<T>;
  /** The density every row answers, handed to the group when there is one. */
  density: DataViewsDensity;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/**
 * The "Lista" layout: one FULL-WIDTH row per record, rendered by the entity — a
 * marker, a title, a subtitle and a value on the right is the shape it was
 * designed for (FUT-733).
 *
 * It sits between the table and the cards rather than replacing either: the
 * table is for comparing many columns, the cards are for browsing, and the list
 * is for scanning a queue on a narrow screen. Selection is the SAME model as
 * both — each row receives its selection state, so it can drive its own
 * checkbox and the bulk menu behaves identically in every layout.
 *
 * `scale` is handed over as 1 rather than the zoom multiplier, and the zoom
 * slider is hidden in this layout: a full-width row has no card size to
 * multiply. See {@link DataViewsZoomSlider}.
 */
function ListBody<T extends Record<string, unknown>>({
  rows,
  renderListRow,
  getRowId,
  selectedIds,
  onToggleId,
  rowGap,
  group,
  density,
  dataTestId,
  emptyState,
}: ListBodyProps<T>): React.JSX.Element {
  if (rows.length === 0) {
    return <Box sx={{ mt: 1.5 }}>{emptyState}</Box>;
  }
  const testId = dataTestId ? `${dataTestId}-list` : "data-views-list";
  const selectionFor = (id: string | number): DataViewCardSelection => ({
    selected: selectedIds.has(id),
    onToggleSelect: onToggleId && (() => onToggleId(id)),
    scale: 1,
  });

  if (group) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <ListCardGroup
          cells={group.cells}
          metaColumns={group.metaColumns}
          rails={group.rails}
          // A list nobody can select holds no checkbox gutter open: reserving
          // one is how a selectable and a read-only row line up, and here no
          // row is selectable. Gutters a row DOES use still get their track.
          reserveGutters={onToggleId ? group.reserveGutters : false}
          density={density}
          gap={rowGap}
          dataTestId={testId}
        >
          {rows.map((row) => {
            const id = getRowId(row);
            // A FRAGMENT, NOT A BOX. The row is subgrid over the group's tracks
            // (`gridColumn: span railCount`), which only resolves while the card
            // is a DIRECT child of the group's grid. One wrapper element and the
            // span is measured against a grid that isn't there, so every rail
            // collapses — the exact failure the group exists to prevent.
            return (
              <React.Fragment key={id}>
                {renderListRow(row, selectionFor(id))}
              </React.Fragment>
            );
          })}
        </ListCardGroup>
      </Box>
    );
  }

  return (
    <Box
      sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: rowGap }}
      data-testid={testId}
    >
      {rows.map((row) => {
        const id = getRowId(row);
        return <Box key={id}>{renderListRow(row, selectionFor(id))}</Box>;
      })}
    </Box>
  );
}

/* ── Body selector (board vs list vs cards vs table, from context) ───────── */

interface GridMainProps<T extends Record<string, unknown>> {
  c: DataViewsController<T>;
  getRowId: (row: T) => string | number;
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** Opt-in "Lista" layout — one full-width row per record. */
  renderListRow?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** The Lista's shared columns. Omitted, each row resolves its own tracks. */
  listGroup?: ListGroupConfig<T>;
  /** Opt-in "Quadro" (board) layout — needs `renderCard`, since it reuses the card. */
  board?: BoardConfig<T>;
  /** Opt-in expandable rows — the TABLE only; the headerless layouts ignore it. */
  rowDetail?: DataViewRowDetail<T>;
  /** False ⇒ no selection anywhere: no checkboxes, no select-all strip. */
  selectable: boolean;
  dataTestId?: string;
  emptyState?: React.ReactNode;
  testIdPrefix: string;
  /** The table's header row follows the page under a sticky toolbar. */
  stickyHead?: boolean;
}

/**
 * The headerless layouts, each preceded by its own select-all.
 *
 * The strip is rendered HERE rather than inside each body so all three agree on
 * where it sits and what it says — and so the table, which already has one in
 * its `<thead>`, never gets a second.
 */
function Headerless<T extends Record<string, unknown>>({
  c,
  getRowId,
  selectable,
  testIdPrefix,
  children,
}: {
  c: DataViewsController<T>;
  getRowId: (row: T) => string | number;
  selectable: boolean;
  testIdPrefix: string;
  children: React.ReactNode;
}): React.JSX.Element {
  // Not selectable ⇒ no strip: a select-all over rows that cannot be selected.
  if (!selectable) return <>{children}</>;
  return (
    <>
      <SelectAllStrip
        rows={c.matched}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onChange={(next) => c.setSelectedIds(next)}
        testIdPrefix={testIdPrefix}
      />
      {children}
    </>
  );
}

/**
 * The body for one of the three HEADERLESS layouts, or `null` for the table.
 *
 * Split out from {@link GridMain} so the select-all strip is wrapped around the
 * result exactly once instead of being repeated identically in every branch —
 * which is also what keeps either function inside the line budget.
 */
function headerlessBody<T extends Record<string, unknown>>(
  { c, getRowId, renderCard, renderListRow, listGroup, board, selectable, dataTestId, emptyState }: GridMainProps<T>,
  { layout, zoom, density }: ReturnType<typeof useDataViewsLayout>,
): React.ReactNode | null {
  // ONE switch for every headerless body: no toggle reaches a card or row, and
  // BaseCard / BaseListCard draw no checkbox for a record without one.
  const onToggleId = selectable ? c.toggleId : undefined;
  if (layout === "list" && renderListRow) {
    return (
      <ListBody
        rows={c.matched}
        renderListRow={renderListRow}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onToggleId={onToggleId}
        rowGap={DENSITY_ROW_PADDING[density]}
        group={listGroup}
        density={density}
        dataTestId={dataTestId}
        emptyState={emptyState}
      />
    );
  }
  if (layout === "board" && board && renderCard) {
    return (
      <DataViewsBoard
        rows={c.matched}
        board={board}
        getRowId={getRowId}
        renderCard={renderCard}
        selectedIds={c.selectedIds}
        onToggleId={onToggleId}
        // DENSITY, not zoom: the board's own knob in the Exibição tab is how
        // wide its columns are, and it is the only sizing control the board
        // has since the zoom slider was removed.
        cardScale={DENSITY_BOARD_SCALE[density]}
        dataTestId={dataTestId}
      />
    );
  }
  if (layout === "cards" && renderCard) {
    return (
      <CardBody
        rows={c.matched}
        renderCard={renderCard}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onToggleId={onToggleId}
        targetCardWidth={cardTargetWidthFor(zoom, density)}
        cardScale={cardScaleForZoom(zoom)}
        dataTestId={dataTestId}
        emptyState={emptyState}
      />
    );
  }
  return null;
}

/** Picks the body from the layout context: board, list, cards, or the dense grid. */
export function GridMain<T extends Record<string, unknown>>(props: GridMainProps<T>): React.JSX.Element {
  const { c, getRowId, selectable, dataTestId, emptyState, testIdPrefix } = props;
  const layoutState = useDataViewsLayout();
  const body = headerlessBody(props, layoutState);
  if (body) {
    return (
      <Headerless c={c} getRowId={getRowId} selectable={selectable} testIdPrefix={testIdPrefix}>
        {body}
      </Headerless>
    );
  }
  return (
    <GridBody
      rows={c.matched}
      columns={c.gridColumns}
      getRowId={getRowId}
      selectedIds={[...c.selectedIds]}
      onChangeSelected={(ids) => c.setSelectedIds(new Set(ids))}
      selectable={selectable}
      sortBy={c.state.sortBy}
      onChangeSortBy={(next: GridSort[]) => c.patch({ sortBy: next })}
      sortMode={c.serverMode ? "server" : "client"}
      rowPadding={DENSITY_ROW_PADDING[layoutState.density]}
      rowDetail={props.rowDetail}
      dataTestId={dataTestId}
      emptyState={emptyState}
      stickyHead={props.stickyHead}
    />
  );
}

