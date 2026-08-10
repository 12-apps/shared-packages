"use client";

import React from "react";

import { DataGrid, type GridColumn, type GridSort } from "../DataGrid";
import { Box } from "../../../mui/Box";

import {
  cardMinWidthForZoom,
  cardScaleForZoom,
  DENSITY_BOARD_SCALE,
  DENSITY_CARD_COLUMNS,
  DENSITY_ROW_PADDING,
  useDataViewsLayout,
  type DataViewsDensity,
} from "./data-views-layout-context";
import { DataViewsBoard, type BoardConfig } from "./DataViewsBoard";
import { SelectAllStrip } from "./data-views-select-all-strip";
import { ListCardGroup, type ListGroupConfig } from "./list-card-rails";
import type { DataViewCardSelection } from "./data-views-types";
import type { DataViewsController } from "./use-data-views-state";

/* ── Body (grid) ─────────────────────────────────────────────────────────── */

interface GridBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  columns: GridColumn<T>[];
  getRowId: (row: T) => string | number;
  selectedIds: Array<string | number>;
  onChangeSelected: (ids: Array<string | number>) => void;
  sortBy: GridSort[];
  onChangeSortBy: (next: GridSort[]) => void;
  /** "server" defers ordering to the backend (rows render as-is); "client" sorts in-grid. */
  sortMode: "client" | "server";
  /** Vertical cell padding, from the density preference. */
  rowPadding: number;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/** The dense DataGrid with multi-select, wrapped in the scrollable table region. */
function GridBody<T extends Record<string, unknown>>({
  rows,
  columns,
  getRowId,
  selectedIds,
  onChangeSelected,
  sortBy,
  onChangeSortBy,
  sortMode,
  rowPadding,
  dataTestId,
  emptyState,
}: GridBodyProps<T>): React.JSX.Element {
  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        mt: 1.5,
        // Tabwoah-style dense rows: MUI's default TableCell padding keeps rows
        // tall regardless of rowHeight, so the DENSITY preference is applied
        // here rather than through `rowHeight`, which it would fight.
        "& .MuiTableCell-root": { py: rowPadding, fontSize: "0.8125rem" },
        "& .MuiTableCell-head": { py: 0.5, fontSize: "0.75rem" },
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
        selection={{ mode: "multi", selectedRowIds: selectedIds, onChangeSelected }}
        sorting={{ mode: sortMode, sortBy, onChangeSortBy }}
        data-testid={dataTestId}
        emptyState={emptyState}
      />
    </Box>
  );
}

/* ── Body (cards) ────────────────────────────────────────────────────────── */

interface CardBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  renderCard: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  onToggleId: (id: string | number) => void;
  minCardWidth: number;
  /** Cap on cards per row, from the density preference. */
  maxColumns: number;
  /** Content scale (padding + type) handed to each card, from the zoom slider. */
  cardScale: number;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/**
 * The "Grade" layout: the filtered/sorted rows rendered as an auto-filling grid
 * of entity-supplied cards. Reuses `rows` (= `c.matched`), so search/filter/sort
 * apply; the column width comes from the zoom slider, and each card is handed its
 * selection state so it can drive its own checkbox (BaseCard) — the same
 * selection model as the table.
 */
function CardBody<T extends Record<string, unknown>>({
  rows,
  renderCard,
  getRowId,
  selectedIds,
  onToggleId,
  minCardWidth,
  maxColumns,
  cardScale,
  dataTestId,
  emptyState,
}: CardBodyProps<T>): React.JSX.Element {
  if (rows.length === 0) {
    return <Box sx={{ mt: 1.5 }}>{emptyState}</Box>;
  }
  return (
    <Box
      sx={{
        mt: 1.5,
        display: "grid",
        // Fixed inter-card gap — deliberately NOT scaled by the zoom slider, so
        // only the cards grow while the space between them stays constant.
        gap: 1.5,
        // `auto-fill` still decides how many FIT; density caps how many are
        // ALLOWED, so "Poucos" reads as bigger cards rather than more of them.
        gridTemplateColumns: {
          xs: "1fr",
          sm: `repeat(auto-fill, minmax(max(${minCardWidth}px, calc((100% - ${(maxColumns - 1) * 12}px) / ${maxColumns})), 1fr))`,
        },
      }}
      data-testid={dataTestId ? `${dataTestId}-cards` : "data-views-cards"}
    >
      {rows.map((row) => {
        const id = getRowId(row);
        return (
          <Box key={id}>
            {renderCard(row, {
              selected: selectedIds.has(id),
              onToggleSelect: () => onToggleId(id),
              scale: cardScale,
            })}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Body (list) ─────────────────────────────────────────────────────────── */

interface ListBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  renderListRow: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  onToggleId: (id: string | number) => void;
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
    onToggleSelect: () => onToggleId(id),
    scale: 1,
  });

  if (group) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <ListCardGroup
          cells={group.cells}
          metaColumns={group.metaColumns}
          rails={group.rails}
          reserveGutters={group.reserveGutters}
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
  dataTestId?: string;
  emptyState?: React.ReactNode;
  testIdPrefix: string;
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
  testIdPrefix,
  children,
}: {
  c: DataViewsController<T>;
  getRowId: (row: T) => string | number;
  testIdPrefix: string;
  children: React.ReactNode;
}): React.JSX.Element {
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
  { c, getRowId, renderCard, renderListRow, listGroup, board, dataTestId, emptyState }: GridMainProps<T>,
  { layout, zoom, density }: ReturnType<typeof useDataViewsLayout>,
): React.ReactNode | null {
  if (layout === "list" && renderListRow) {
    return (
      <ListBody
        rows={c.matched}
        renderListRow={renderListRow}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onToggleId={c.toggleId}
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
        onToggleId={c.toggleId}
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
        onToggleId={c.toggleId}
        minCardWidth={cardMinWidthForZoom(zoom)}
        maxColumns={DENSITY_CARD_COLUMNS[density]}
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
  const { c, getRowId, dataTestId, emptyState, testIdPrefix } = props;
  const layoutState = useDataViewsLayout();
  const body = headerlessBody(props, layoutState);
  if (body) {
    return (
      <Headerless c={c} getRowId={getRowId} testIdPrefix={testIdPrefix}>
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
      sortBy={c.state.sortBy}
      onChangeSortBy={(next: GridSort[]) => c.patch({ sortBy: next })}
      sortMode={c.serverMode ? "server" : "client"}
      rowPadding={DENSITY_ROW_PADDING[layoutState.density]}
      dataTestId={dataTestId}
      emptyState={emptyState}
    />
  );
}

