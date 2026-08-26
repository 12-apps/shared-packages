"use client";

import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import Checkbox from "@mui/material/Checkbox/index.js";
import { useState } from "react";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { HideableColumn } from "./data-views-columns";

/* ── Colunas ─────────────────────────────────────────────────────────────── */

interface ColumnsTabProps {
  columns: HideableColumn[];
  /** Every column id in the CURRENT order (including non-hideable ones). */
  order: string[];
  visibleColumns: string[];
  onToggle: (id: string, visible: boolean) => void;
  onReorder: (order: string[]) => void;
  onShowAll: () => void;
  onReset: () => void;
  testIdPrefix: string;
}

/** Swap the column at `id` with its neighbour `delta` places away. */
function moved(order: string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * Visibility AND order in one list, because they are the same decision: an
 * operator reordering columns is deciding what to read first, and hiding one is
 * deciding not to read it at all. Drag the grip, or use the arrows — the arrows
 * exist because drag-and-drop is unusable by keyboard and awkward on a phone.
 */
export function ColumnsTab({
  columns,
  order,
  visibleColumns,
  onToggle,
  onReorder,
  onShowAll,
  onReset,
  testIdPrefix,
}: ColumnsTabProps): React.JSX.Element {
  const copy = useDataViewsCopy();
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const ordered = order.map((id) => byId.get(id)).filter((column): column is HideableColumn => Boolean(column));
  // Counted against `columns`, which is the HIDEABLE set — `visibleColumns`
  // also carries the locked ones (a `hideable: false` id like the row's
  // identifier), and counting it whole reads "9 de 8 visíveis".
  const visibleHideableCount = visibleColumns.filter((id) => byId.has(id)).length;

  const dropOn = (id: string): void => {
    if (!dragId || dragId === id) return;
    const without = order.filter((key) => key !== dragId);
    without.splice(without.indexOf(id), 0, dragId);
    onReorder(without);
    setDragId(null);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1 }}>
        <Text variant="caption" as="span">
          <Box component="span" sx={{ color: "text.secondary" }} data-testid={`${testIdPrefix}-columns-count`}>
            {copy.columns.visibleCount(visibleHideableCount, columns.length)}
          </Box>
        </Text>
        <Box sx={{ display: "flex", gap: 1 }}>
          <LinkButton label={copy.columns.showAll} onClick={onShowAll} testId={`${testIdPrefix}-columns-show-all`} />
          <LinkButton label={copy.columns.reset} onClick={onReset} testId={`${testIdPrefix}-columns-reset`} muted />
        </Box>
      </Box>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 1.5, pb: 0.5, display: "block", color: "text.disabled" }}>
          {copy.columns.dragHint}
        </Box>
      </Text>
      <Box sx={{ px: 0.75, pb: 0.75 }}>
        {ordered.map((column) => (
          <ColumnRow
            key={column.id}
            column={column}
            visible={visibleColumns.includes(column.id)}
            dragging={dragId === column.id}
            onToggle={onToggle}
            onDragStart={() => setDragId(column.id)}
            onDragEnd={() => setDragId(null)}
            onDrop={() => dropOn(column.id)}
            onMove={(delta) => onReorder(moved(order, column.id, delta))}
            testIdPrefix={testIdPrefix}
          />
        ))}
      </Box>
    </Box>
  );
}

/** A borderless text action, for the two column resets. */
function LinkButton({
  label,
  onClick,
  testId,
  muted,
}: {
  label: string;
  onClick: () => void;
  testId: string;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      data-testid={testId}
      sx={{
        border: 0,
        background: "none",
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.75rem",
        p: 0,
        color: muted ? "text.secondary" : "primary.main",
        "&:hover": { textDecoration: "underline" },
      }}
    >
      {label}
    </Box>
  );
}

interface ColumnRowProps {
  column: HideableColumn;
  visible: boolean;
  dragging: boolean;
  onToggle: (id: string, visible: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (delta: number) => void;
  testIdPrefix: string;
}

/** One column: grip, checkbox, label, and the keyboard-reachable move arrows. */
function ColumnRow({
  column,
  visible,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
  testIdPrefix,
}: ColumnRowProps): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event: React.DragEvent) => event.preventDefault()}
      onDrop={onDrop}
      data-testid={`${testIdPrefix}-column-row-${column.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        opacity: dragging ? 0.4 : 1,
        "&:hover": { bgcolor: "action.hover" },
        "&:hover .dv-col-move": { opacity: 1 },
      }}
    >
      <Box component="span" aria-hidden sx={{ display: "flex", color: "action.disabled", cursor: "grab" }}>
        <DragIndicatorRoundedIcon fontSize="small" />
      </Box>
      <Checkbox
        size="small"
        checked={visible}
        onChange={(event) => onToggle(column.id, event.target.checked)}
        inputProps={{ "aria-label": column.label }}
        data-testid={`${testIdPrefix}-column-toggle-${column.id}`}
      />
      <Text variant="caption" as="span">
        <Box component="span" sx={{ flex: 1, color: visible ? "text.primary" : "text.disabled" }}>
          {column.label}
        </Box>
      </Text>
      <Box className="dv-col-move" sx={{ ml: "auto", display: "flex", opacity: 0, transition: "opacity .15s" }}>
        <MoveButton label={copy.columns.moveUp(column.label)} onClick={() => onMove(-1)} up />
        <MoveButton label={copy.columns.moveDown(column.label)} onClick={() => onMove(1)} />
      </Box>
    </Box>
  );
}

/** One of the two reorder arrows — the keyboard's path through the drag handle. */
function MoveButton({
  label,
  onClick,
  up,
}: {
  label: string;
  onClick: () => void;
  up?: boolean;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        display: "flex",
        border: 0,
        p: 0.25,
        background: "none",
        borderRadius: 0.5,
        cursor: "pointer",
        color: "text.secondary",
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      {up ? <ArrowUpwardRoundedIcon sx={{ fontSize: 14 }} /> : <ArrowDownwardRoundedIcon sx={{ fontSize: 14 }} />}
    </Box>
  );
}

