"use client";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { DataViewCardSelection } from "./data-views-types";

/**
 * One column of the board — a single value of the grouping field, with the label
 * to print above it.
 *
 * `tone` is an opaque palette hint (e.g. `"success"`, `"error"`) the host picks
 * from its own state machine; the board only uses it to colour the column's
 * header accent, so an unknown tone degrades to the default rather than throwing.
 */
export interface BoardGroup {
  value: string;
  label: string;
  tone?: string;
}

/**
 * The BOARD layout's configuration: the same page the table rendered, laid out
 * as columns of the entity's own card.
 *
 * The board earns its place when a page's buckets are STATES IN A STATE MACHINE
 * rather than arbitrary groupings — payments are exactly that shape. Derive
 * `groups` and the table's `scopes` from ONE state-machine definition: two
 * hand-maintained lists of the same states will drift, and the drift shows up as
 * a column the tabs do not have.
 */
export interface BoardConfig<T extends Record<string, unknown>> {
  /** The row field whose value places a card in a column. */
  groupBy: keyof T & string;
  /** The columns, in DELIBERATE reading order — the board renders this order. */
  groups: BoardGroup[];
  /** Optional numeric row field summed per column (e.g. the amount in cents). */
  sumBy?: keyof T & string;
  /**
   * Formats a column's total. The PAGE's own formatter, so the board prints
   * money in the store's currency instead of inventing a second convention.
   * Omitted ⇒ the raw sum.
   */
  formatSum?: (total: number) => string;
  /** Header for the column collecting rows in states the front end does not declare. */
  extraLabel?: string;
}

/** The default header for the catch-all column (see {@link groupRows}). */
const DEFAULT_EXTRA_LABEL = "Sem etapa";

/** One resolved column: a declared group (or the catch-all) plus its loaded rows. */
interface ResolvedColumn<T> {
  key: string;
  label: string;
  tone?: string;
  rows: T[];
}

/** Read the grouping value off a row as a string (`null`/`undefined` ⇒ ""). */
function groupValueOf<T extends Record<string, unknown>>(row: T, groupBy: string): string {
  const value = row[groupBy];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Place every loaded row into a column, in the DECLARED order, and collect the
 * leftovers into one extra column at the end.
 *
 * Nothing is ever dropped, and that is the point: a state added to the back end
 * before the front end knows about it must not make rows disappear. On a
 * payments board, a silently dropped row is money nobody can see. The extra
 * column only exists when something landed in it — once every row is placed it
 * is gone, so the common case shows exactly the declared columns.
 *
 * A declared group with no rows KEEPS its position: the order is a reading
 * order chosen by the host, not a ranking derived from the data.
 */
export function groupRows<T extends Record<string, unknown>>(
  rows: T[],
  board: BoardConfig<T>,
): ResolvedColumn<T>[] {
  const declared = new Map<string, T[]>(board.groups.map((group) => [group.value, []]));
  const extra: T[] = [];
  for (const row of rows) {
    const bucket = declared.get(groupValueOf(row, board.groupBy));
    if (bucket) bucket.push(row);
    else extra.push(row);
  }
  const columns: ResolvedColumn<T>[] = board.groups.map((group) => ({
    key: group.value,
    label: group.label,
    tone: group.tone,
    rows: declared.get(group.value) ?? [],
  }));
  if (extra.length > 0) {
    columns.push({ key: "__extra__", label: board.extraLabel ?? DEFAULT_EXTRA_LABEL, rows: extra });
  }
  return columns;
}

/** A column's total over the rows ON THIS PAGE, or null when nothing is summed. */
function sumOf<T extends Record<string, unknown>>(rows: T[], sumBy: string | undefined): number | null {
  if (!sumBy) return null;
  return rows.reduce((total, row) => {
    const value = row[sumBy];
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
}

/** Map a `tone` hint onto a theme colour, defaulting for anything unrecognised. */
function toneColor(tone: string | undefined): string {
  const known = ["primary", "secondary", "success", "warning", "error", "info"];
  return tone && known.includes(tone) ? `${tone}.main` : "divider";
}

/**
 * A column's heading: the label, the page count and the optional sum.
 *
 * The count is labelled "nesta página" EVERYWHERE it appears, including in its
 * accessible name. The scope tabs above the board show whole-query totals from
 * the server; an unlabelled column count would contradict them the moment there
 * is a second page, and the reader has no way to tell which number to believe.
 */
function BoardColumnHeader({
  label,
  count,
  sum,
  testId,
}: {
  label: string;
  count: number;
  /** The formatted total, or null when the board sums nothing. */
  sum: string | null;
  testId: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
        <Text variant="caption" as="span">
          <Box component="span" sx={{ fontWeight: 600 }}>
            {label}
          </Box>
        </Text>
        <Text variant="caption" as="span">
          <Box
            component="span"
            data-testid={`${testId}-count`}
            aria-label={copy.board.countOnPage(label, count)}
            sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
          >
            {copy.board.onThisPage(count)}
          </Box>
        </Text>
      </Box>
      {sum !== null && (
        <Text variant="caption" as="span">
          <Box
            component="span"
            data-testid={`${testId}-sum`}
            aria-label={copy.board.pageSum(sum)}
            sx={{ color: "text.secondary" }}
          >
            {sum}
          </Box>
        </Text>
      )}
    </Box>
  );
}

interface BoardColumnProps<T extends Record<string, unknown>> {
  column: ResolvedColumn<T>;
  board: BoardConfig<T>;
  getRowId: (row: T) => string | number;
  renderCard: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  selectedIds: Set<string | number>;
  onToggleId: (id: string | number) => void;
  cardScale: number;
  width: number;
  testId: string;
}

/** One column: its header over a vertical stack of the entity's own cards. */
function BoardColumn<T extends Record<string, unknown>>({
  column,
  board,
  getRowId,
  renderCard,
  selectedIds,
  onToggleId,
  cardScale,
  width,
  testId,
}: BoardColumnProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const total = sumOf(column.rows, board.sumBy);
  return (
    <Box
      data-testid={testId}
      sx={{
        flex: `0 0 ${width}px`,
        minWidth: width,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderTop: 3,
        borderStyle: "solid",
        borderColor: toneColor(column.tone),
        borderRadius: 1,
        bgcolor: "action.hover",
        p: 1,
      }}
    >
      <BoardColumnHeader
        label={column.label}
        count={column.rows.length}
        sum={total === null ? null : String(board.formatSum ? board.formatSum(total) : total)}
        testId={testId}
      />
      {column.rows.length === 0 ? (
        <Text variant="caption" as="p">
          <Box component="span" data-testid={`${testId}-empty`} sx={{ color: "text.disabled" }}>
            {copy.board.emptyColumn}
          </Box>
        </Text>
      ) : (
        column.rows.map((row) => {
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
        })
      )}
    </Box>
  );
}

interface DataViewsBoardProps<T extends Record<string, unknown>> {
  /** The LOADED page, verbatim. The board never filters, sorts or paginates. */
  rows: T[];
  board: BoardConfig<T>;
  getRowId: (row: T) => string | number;
  renderCard: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  selectedIds: Set<string | number>;
  onToggleId: (id: string | number) => void;
  /** Card size multiplier from the toolbar zoom slider — the same knob as cards. */
  cardScale: number;
  dataTestId?: string;
}

/** The board's column width at scale 1; the zoom slider multiplies it. */
const BASE_COLUMN_WIDTH = 240;
/** Never narrower than this, however far the zoom is wound down (touch targets). */
const MIN_COLUMN_WIDTH = 220;

/**
 * The BOARD layout: the loaded page distributed into columns of the entity's own
 * card. A rendering, not a second source of truth — switching to it emits no
 * query, and it shows exactly the rows the table showed.
 *
 * The board scrolls HORIZONTALLY inside its own box rather than letting the page
 * scroll sideways, and its columns keep a usable width at every zoom, so a phone
 * gets a real board instead of six unreadable slivers.
 *
 * Cards are not draggable between columns. Dragging a payment from Recusado to
 * Pago is a domain transition with side effects, not a re-render: it needs the
 * allowed-transition set from the state machine plus a confirmation, and
 * `RowAction.isVisible` is the existing per-row guard to reuse when that lands.
 */
export function DataViewsBoard<T extends Record<string, unknown>>({
  rows,
  board,
  getRowId,
  renderCard,
  selectedIds,
  onToggleId,
  cardScale,
  dataTestId,
}: DataViewsBoardProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const columns = groupRows(rows, board);
  const width = Math.max(MIN_COLUMN_WIDTH, Math.round(BASE_COLUMN_WIDTH * cardScale));
  const testId = dataTestId ? `${dataTestId}-board` : "data-views-board";
  return (
    <Box sx={{ mt: 1.5 }}>
      <Text variant="caption" as="p">
        <Box component="span" data-testid={`${testId}-scale-note`} sx={{ color: "text.secondary" }}>
          {copy.board.pageScopeNote}
        </Box>
      </Text>
      <Box
        data-testid={testId}
        sx={{
          mt: 1,
          display: "flex",
          alignItems: "flex-start",
          gap: 1.5,
          // The BOARD scrolls, not the page: without `maxWidth` the flex row
          // widens its parent and the whole document scrolls sideways.
          maxWidth: "100%",
          overflowX: "auto",
          pb: 1,
        }}
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            board={board}
            getRowId={getRowId}
            renderCard={renderCard}
            selectedIds={selectedIds}
            onToggleId={onToggleId}
            cardScale={cardScale}
            width={width}
            testId={`${testId}-column-${column.key}`}
          />
        ))}
      </Box>
    </Box>
  );
}
