import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import type * as React from 'react';

import type { ScheduleGridLabels } from './ScheduleGrid.labels';
import { daysBetween, isOpen } from './schedule-grid-model';
import { SCHEDULE_GRID_METRICS } from './ScheduleGrid.metrics';
import {
  blockedLabelSx,
  blockSx,
  breakSx,
  cellSx,
  ghostSx,
  gripSx,
  groupTitleSx,
  headerCellSx,
  headerSublabelSx,
  headerRowSx,
  nameCellSx,
  personRowSx,
  plusButtonSx,
  skeletonCellSx,
  SR_ONLY_SX,
  totalCellSx,
  totalHeaderSx,
} from './ScheduleGrid.styles';
import { cornerSx, headerAdornmentSx } from './schedule-header-host.styles';
import type { CellLook } from './ScheduleGrid.styles';
import type {
  ScheduleGridBlock,
  ScheduleGridCell,
  ScheduleGridColumn,
  ScheduleGridProps,
  ScheduleGridRow,
} from './ScheduleGrid.types';
import { ScheduleNameCell } from './ScheduleNameCell';
import type { GridDrag, GridDragApi } from './useGridDrag';

/** What the grid lets a cell do, resolved once per render. */
export interface CellAbilities {
  create: boolean;
  copy: boolean;
  move: boolean;
}

/** A row's shared columns, as an `sx` part. */
type RowSx = (theme: Theme) => CSSObject;

interface CellProps {
  row: ScheduleGridRow;
  day: number;
  column: ScheduleGridColumn;
  cell: ScheduleGridCell;
  drag: GridDrag | null;
  dragApi: GridDragApi;
  can: CellAbilities;
  createPreview?: (rowId: string) => string;
  onCreate?: (rowId: string, days: number[]) => void;
  onBlockClick?: (blockId: string) => void;
  labels: ScheduleGridLabels;
  testId: string;
}

/** The ghost text this cell shows during a create or copy, or `null` when the gesture does not land here. */
function ghostFor(props: CellProps): string | null {
  const { drag, row, day, cell, createPreview } = props;
  if (!drag || drag.mode === 'move' || drag.rowId !== row.id || !isOpen(cell)) return null;
  if (!daysBetween(drag.anchor, drag.day).includes(day)) return null;
  if (drag.mode === 'copy') return day === drag.anchor ? null : drag.preview;
  return createPreview?.(row.id) ?? '';
}

/** The keys a block answers to, for `aria-keyshortcuts`. */
function shortcutsOf(movable: boolean, copyable: boolean): string | undefined {
  const keys = [movable ? 'Alt+ArrowLeft Alt+ArrowRight' : '', copyable ? 'Shift+ArrowLeft Shift+ArrowRight' : ''];
  return keys.filter(Boolean).join(' ') || undefined;
}

const titleOf = (block: ScheduleGridBlock): string => block.title ?? [block.label, block.note].filter(Boolean).join(' · ');

interface BlockProps {
  block: ScheduleGridBlock;
  row: ScheduleGridRow;
  day: number;
  can: CellAbilities;
  dragApi: GridDragApi;
  onBlockClick?: (blockId: string) => void;
  testId: string;
}

function Grip({ side, onPointerDown, testId }: { side: 'l' | 'r'; onPointerDown: (event: React.PointerEvent) => void; testId: string }) {
  return <Box component="span" aria-hidden sx={gripSx(side)} onPointerDown={onPointerDown} data-sg-grip="" data-testid={testId} />;
}

/** The block's break, kept inside it whatever the host sent. */
function BreakBand({ span, testId }: { span: { start: number; end: number }; testId: string }): React.JSX.Element | null {
  const start = Math.min(1, Math.max(0, span.start));
  const end = Math.min(1, Math.max(0, span.end));
  if (!(end > start)) return null;
  return <Box component="span" aria-hidden sx={breakSx({ start, end })} data-sg-break="" data-testid={testId} />;
}

function BlockButton({ block, row, day, can, dragApi, onBlockClick, testId }: BlockProps): React.JSX.Element {
  const movable = can.move && Boolean(block.movable);
  const copyable = can.copy && Boolean(block.copyable);
  const startCopy = (event: React.PointerEvent): void => dragApi.startCopy(event, block.id, row.id, day, block.label);
  const startMove = (event: React.PointerEvent): void => dragApi.startMove(event, block.id, row.id, day);
  return (
    <Box
      component="button"
      type="button"
      sx={blockSx(block.tone, { selected: Boolean(block.selected), movable })}
      title={titleOf(block)}
      aria-keyshortcuts={shortcutsOf(movable, copyable)}
      aria-current={block.selected ? 'true' : undefined}
      data-sg-focus=""
      data-sg-row={row.id}
      data-sg-day={day}
      data-sg-block={block.id}
      data-tone={block.tone}
      data-testid={`${testId}-block-${block.id}`}
      onPointerDown={movable ? startMove : undefined}
      onClick={() => {
        if (!dragApi.takeClick()) onBlockClick?.(block.id);
      }}
    >
      {block.breakSpan ? <BreakBand span={block.breakSpan} testId={`${testId}-break-${block.id}`} /> : null}
      {copyable ? <Grip side="l" onPointerDown={startCopy} testId={`${testId}-grip-l-${block.id}`} /> : null}
      <span data-sg-line="label">{block.label}</span>
      {block.note ? <span data-sg-line="note">{block.note}</span> : null}
      {copyable ? <Grip side="r" onPointerDown={startCopy} testId={`${testId}-grip-r-${block.id}`} /> : null}
    </Box>
  );
}

/**
 * The empty cell's "+". It stays mounted while a drag shows the ghost in it, so
 * a press and release in place is still its click.
 */
function PlusButton({ props, ghost }: { props: CellProps; ghost: string | null }): React.JSX.Element {
  const { row, day, column, dragApi, onCreate, labels } = props;
  return (
    <Box
      component="button"
      type="button"
      sx={plusButtonSx}
      aria-label={labels.createCell(row.label, column.label)}
      data-ghost={ghost === null ? undefined : ''}
      data-sg-focus=""
      data-sg-row={row.id}
      data-sg-day={day}
      onPointerDown={(event: React.PointerEvent) => dragApi.startCreate(event, row.id, day)}
      onClick={() => {
        if (!dragApi.takeClick()) onCreate?.(row.id, [day]);
      }}
    >
      {ghost === null ? <AddIcon aria-hidden /> : <Ghost text={ghost} />}
    </Box>
  );
}

function Ghost({ text }: { text: string }): React.JSX.Element {
  return (
    <Box component="span" sx={ghostSx} aria-hidden>
      {text}
    </Box>
  );
}

/** What fills a cell after its blocks: the "+" (or the ghost in it), a lone ghost, or a closed day's label. */
function CellFill({ props, ghost }: { props: CellProps; ghost: string | null }): React.JSX.Element | null {
  const { cell, can } = props;
  if (can.create && isOpen(cell)) return <PlusButton props={props} ghost={ghost} />;
  if (ghost !== null) return <Ghost text={ghost} />;
  if (!cell.blocked || cell.blocks.length > 0 || !cell.blockedLabel) return null;
  return (
    <Box component="span" sx={blockedLabelSx} aria-hidden title={cell.blockedLabel}>
      {cell.blockedLabel}
    </Box>
  );
}

/** A gone day's words for a screen reader ("Já passou"): visually hidden, and only when the host gives them. */
function ClosedWords({ cell }: { cell: ScheduleGridCell }): React.JSX.Element | null {
  if (!cell.closed || cell.blocked || !cell.closedLabel) return null;
  return (
    <Box component="span" sx={SR_ONLY_SX}>
      {cell.closedLabel}
    </Box>
  );
}

/** How the cell is drawn right now. */
function lookOf(props: CellProps, ghost: string | null): CellLook {
  const { row, day, column, cell, drag, can } = props;
  return {
    today: Boolean(column.today),
    blocked: Boolean(cell.blocked),
    closed: Boolean(cell.closed),
    target: ghost !== null,
    over: drag?.mode === 'move' && drag.moved && drag.rowId === row.id && drag.day === day,
    interactive: can.create && isOpen(cell),
  };
}

/** One day of one row: its blocks, a "+" when it is empty, the hatch when it is closed. */
export function GridCell(props: CellProps): React.JSX.Element {
  const { row, day, column, cell, can, labels, testId } = props;
  const ghost = ghostFor(props);
  const look = lookOf(props, ghost);
  const blocked = look.blocked;
  const closedName = blocked && cell.blocks.length === 0 ? (cell.blockedLabel ?? labels.blockedCell(row.label, column.label)) : undefined;
  return (
    <Box
      role="cell"
      sx={cellSx(look)}
      data-sg-cell=""
      data-sg-row={row.id}
      data-sg-day={day}
      data-testid={`${testId}-cell-${row.id}-${day}`}
      aria-label={closedName}
    >
      {cell.blocks.map((block) => (
        <BlockButton
          key={block.id}
          block={block}
          row={row}
          day={day}
          can={can}
          dragApi={props.dragApi}
          onBlockClick={props.onBlockClick}
          testId={testId}
        />
      ))}
      <CellFill props={props} ghost={ghost} />
      <ClosedWords cell={cell} />
    </Box>
  );
}

/** The first column: the person, as both views draw it. */
function NameCell({ row }: { row: ScheduleGridRow }): React.JSX.Element {
  const sizes = { name: SCHEDULE_GRID_METRICS.rowName, meta: SCHEDULE_GRID_METRICS.rowMeta, chipsTop: 0.5 };
  return <ScheduleNameCell row={row} role="rowheader" sx={nameCellSx} sizes={sizes} />;
}

interface HeaderProps {
  columns: readonly ScheduleGridColumn[];
  /** Present when the grid has a last column. */
  totalLabel?: string;
  /** Above the names (`ScheduleGridProps.corner`). */
  corner?: React.ReactNode;
  rowSx: RowSx;
  testId: string;
}

/** The days, their counts and the total column's header — pinned while the grid scrolls. */

/** A label wraps between words, never inside "Seg 19/10": the space before a number holds. */
/** A range ("11h–23h") breaks before or after it, never at its dash. */
function keepRangesWhole(node: React.ReactNode): React.ReactNode {
  return typeof node === 'string' ? node.replace(/\s*–\s*/g, (dash) => `\u2060${dash.trim()}\u2060`) : node;
}

function keepDatesWhole(label: string): string {
  return label.replace(/ (?=\d)/g, '\u00a0');
}

export function GridHeader({ columns, totalLabel, corner, rowSx, testId }: HeaderProps): React.JSX.Element {
  return (
    <Box role="row" sx={[rowSx, headerRowSx]} data-testid={`${testId}-header`}>
      {/* Above the names: a cell of the header row, with nothing to head but the host's corner words. */}
      <Box component="span" role="cell" data-sg-corner="" sx={cornerSx} data-testid={`${testId}-corner`}>
        {keepRangesWhole(corner)}
      </Box>
      {columns.map((column, day) => (
        <Box
          role="columnheader"
          key={`${day}-${column.label}`}
          sx={headerCellSx(Boolean(column.today), Boolean(column.past))}
          data-sg-past={column.past ? '' : undefined}
        >
          <span data-sg-col="full" title={column.label}>
            {keepDatesWhole(column.label)}
          </span>
          {column.sublabel ? (
            <Box component="span" sx={headerSublabelSx} data-sg-col="sub">
              {column.sublabel}
            </Box>
          ) : null}
          {column.adornment ? (
            <Box component="span" sx={headerAdornmentSx} data-sg-col="adornment" data-testid={`${testId}-adornment-${day}`}>
              {column.adornment}
            </Box>
          ) : null}
        </Box>
      ))}
      {totalLabel !== undefined ? (
        <Box role="columnheader" sx={totalHeaderSx}>
          {totalLabel}
        </Box>
      ) : null}
    </Box>
  );
}

interface BodyProps {
  grid: ScheduleGridProps;
  rows: readonly ScheduleGridRow[];
  rowSx: RowSx;
  hasTotal: boolean;
  can: CellAbilities;
  dragApi: GridDragApi;
  labels: ScheduleGridLabels;
  testId: string;
}

function SkeletonRows({ grid, rowSx, testId }: Pick<BodyProps, 'grid' | 'rowSx' | 'testId'>): React.JSX.Element {
  return (
    <>
      {Array.from({ length: SCHEDULE_GRID_METRICS.skeletonRows }, (_, index) => (
        <Box key={index} sx={[rowSx, personRowSx]} aria-hidden data-testid={`${testId}-loading`}>
          <Box sx={skeletonCellSx} />
          {grid.columns.map((column, day) => (
            <Box key={`${day}-${column.label}`} sx={skeletonCellSx} />
          ))}
        </Box>
      ))}
    </>
  );
}

function PersonRow({ row, body }: { row: ScheduleGridRow; body: BodyProps }): React.JSX.Element {
  const { grid, rowSx, hasTotal, can, dragApi, labels, testId } = body;
  return (
    <Box role="row" sx={[rowSx, personRowSx]} data-testid={`${testId}-row-${row.id}`}>
      <NameCell row={row} />
      {grid.columns.map((column, day) => (
        <GridCell
          key={`${day}-${column.label}`}
          row={row}
          day={day}
          column={column}
          cell={grid.cell(row.id, day)}
          drag={dragApi.drag}
          dragApi={dragApi}
          can={can}
          createPreview={grid.createPreview}
          onCreate={grid.onCreate}
          onBlockClick={grid.onBlockClick}
          labels={labels}
          testId={testId}
        />
      ))}
      {hasTotal ? (
        <Box role="cell" sx={totalCellSx}>
          {row.total}
        </Box>
      ) : null}
    </Box>
  );
}

/** The host's error or empty node, as the table's one full-width row (a table holds rows only). */
function MessageRow({ children, testId }: { children: React.ReactNode; testId: string }): React.JSX.Element | null {
  if (children === null || children === undefined || children === false) return null;
  return (
    <Box role="row" data-testid={`${testId}-message`}>
      <Box role="cell">{children}</Box>
    </Box>
  );
}

/** The groups and their rows — or the skeleton, the host's error, or the host's empty state. */
export function GridBody(body: BodyProps): React.JSX.Element | null {
  const { grid, rows } = body;
  if (grid.error) return <MessageRow testId={body.testId}>{grid.error}</MessageRow>;
  if (grid.loading) return <SkeletonRows grid={grid} rowSx={body.rowSx} testId={body.testId} />;
  if (rows.length === 0) return <MessageRow testId={body.testId}>{grid.empty}</MessageRow>;
  return (
    <>
      {grid.groups.map((group, index) => (
        <Box role="rowgroup" key={`${index}-${group.title ?? ''}`} aria-label={group.title}>
          {group.title ? (
            <Box component="p" sx={groupTitleSx} aria-hidden data-sg-group-title="">
              {group.title}
            </Box>
          ) : null}
          {group.rows.map((row) => (
            <PersonRow key={row.id} row={row} body={body} />
          ))}
        </Box>
      ))}
    </>
  );
}
