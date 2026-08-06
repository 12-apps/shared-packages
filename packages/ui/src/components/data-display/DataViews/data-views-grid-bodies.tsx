"use client";

import { DataGrid, type GridColumn, type GridSort } from "../DataGrid";
import { Box } from "../../../mui/Box";

import { cardMinWidthForZoom, cardScaleForZoom, useDataViewsLayout } from "./data-views-layout-context";
import { DataViewsBoard, type BoardConfig } from "./DataViewsBoard";
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
        // tall regardless of rowHeight, so trim it here.
        "& .MuiTableCell-root": { py: 0.25, fontSize: "0.8125rem" },
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
        gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
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
  dataTestId,
  emptyState,
}: ListBodyProps<T>): React.JSX.Element {
  if (rows.length === 0) {
    return <Box sx={{ mt: 1.5 }}>{emptyState}</Box>;
  }
  return (
    <Box
      sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 0.75 }}
      data-testid={dataTestId ? `${dataTestId}-list` : "data-views-list"}
    >
      {rows.map((row) => {
        const id = getRowId(row);
        return (
          <Box key={id}>
            {renderListRow(row, {
              selected: selectedIds.has(id),
              onToggleSelect: () => onToggleId(id),
              scale: 1,
            })}
          </Box>
        );
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
  /** Opt-in "Quadro" (board) layout — needs `renderCard`, since it reuses the card. */
  board?: BoardConfig<T>;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/** Picks the body from the layout context: board, list, cards, or the dense grid. */
export function GridMain<T extends Record<string, unknown>>({
  c,
  getRowId,
  renderCard,
  renderListRow,
  board,
  dataTestId,
  emptyState,
}: GridMainProps<T>): React.JSX.Element {
  const { layout, zoom } = useDataViewsLayout();
  if (layout === "list" && renderListRow) {
    return (
      <ListBody
        rows={c.matched}
        renderListRow={renderListRow}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onToggleId={c.toggleId}
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
        cardScale={cardScaleForZoom(zoom)}
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
        cardScale={cardScaleForZoom(zoom)}
        dataTestId={dataTestId}
        emptyState={emptyState}
      />
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
      dataTestId={dataTestId}
      emptyState={emptyState}
    />
  );
}

