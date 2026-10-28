import type * as React from 'react';

import type { ScheduleGridLabels } from '../../../copy/labels';

/**
 * How a block reads. Each tone is drawn differently AND carries its `note`
 * text, so colour is never the only signal:
 * - `plan` — scheduled ("17:00–23:00", note "↻ toda semana");
 * - `late` — scheduled, started, nobody there ("Atrasado");
 * - `away` — the person said they will not come ("Ausente");
 * - `uncovered` — nobody covers it ("Sem ninguém");
 * - `onduty` — running right now ("Em turno", "desde 08:26").
 */
export type ScheduleBlockTone = 'plan' | 'late' | 'away' | 'uncovered' | 'onduty';

/** One day column of the grid. */
export interface ScheduleGridColumn {
  /** The day ("Ter 20/10", "Hoje · Seg 19/10"). */
  label: string;
  /** Under the label ("3 turnos", "ninguém"). */
  sublabel?: string;
  /** Today's column: its label in the primary colour and its cells framed. */
  today?: boolean;
}

/** A row: one person (or resource) across the days. */
export interface ScheduleGridRow {
  id: string;
  /** The name in the first column. Wraps; never pushes the day columns. */
  label: string;
  /** A line under the name ("Afastamento · licença maternidade", "70h na semana · acima de 40h"). */
  meta?: string;
  /** `warning` draws `meta` in the warning ink (over a limit). Default `default`. */
  metaTone?: 'default' | 'warning';
  /** The last column ("18h", "—"). */
  total?: string;
  /** Makes the name a button (the person's week, an afastamento). */
  onLabelClick?: () => void;
  /** The name button's accessible name, when it says more than `label` ("Ana: horas e afastamento"). */
  labelAccessible?: string;
  /**
   * Beside the name, on its line (a "Freela" tag). It keeps its size; when the
   * name column has no room for both, it moves under the name.
   */
  nameAdornment?: React.ReactNode;
  /** Under the meta line: the host's chips ("2 regras ›"). One line; a chip that does not fit shrinks, its label cut. */
  chips?: React.ReactNode;
}

/** Rows under one heading ("Cozinha"). */
export interface ScheduleGridGroup {
  /** Shown upper-case above the rows; also names the row group. Omit for no heading. */
  title?: string;
  rows: ScheduleGridRow[];
}

/**
 * A stretch inside a block that is not worked (a meal break), drawn hatched
 * across the block's height. Fractions of the block's length, `0 <= start < end <= 1`;
 * the words for it ("pausa 14–15") are the block's `note`.
 */
export interface ScheduleBlockBreak {
  start: number;
  end: number;
}

/** One block inside a cell. */
export interface ScheduleGridBlock {
  /** Stable identity — what `onMove`, `onCopy` and `onBlockClick` report. */
  id: string;
  /** The first line ("17:00–23:00", "Em turno"). One line, ellipsis. */
  label: string;
  /** The second line ("↻ toda semana", "Atrasado"). Wraps when long; never cut. */
  note?: string;
  tone: ScheduleBlockTone;
  /** Its middle can be dragged to another cell (and Alt+←/→ moves it a day). */
  movable?: boolean;
  /** It has edge grips that copy it along its row (and Shift+←/→ copies it a day). */
  copyable?: boolean;
  /** Drawn with a ring (the block whose window is open). */
  selected?: boolean;
  /** The tooltip and the full text. Default: `label` and `note`. */
  title?: string;
  /** A break inside the block, drawn as a hatched gap. */
  breakSpan?: ScheduleBlockBreak;
}

/** What a cell holds. */
export interface ScheduleGridCell {
  blocks: readonly ScheduleGridBlock[];
  /**
   * The day is closed to this row (an afastamento): hatched, refuses a
   * create and a drop. Blocks already there still show.
   */
  blocked?: boolean;
  /** Written in a blocked cell with no blocks ("Afastamento"). */
  blockedLabel?: string;
}

export interface ScheduleGridProps {
  /** The day columns, in order (seven for a week). A day is its index here. */
  columns: readonly ScheduleGridColumn[];
  groups: readonly ScheduleGridGroup[];
  /** What a cell holds. Called for every row and day on each render: keep it cheap. */
  cell: (rowId: string, day: number) => ScheduleGridCell;
  /** The last column's header ("horas"). Without it and without row totals, there is no last column. */
  totalLabel?: string;
  /**
   * No create, copy or move: no "+", no grips, empty cells are not focusable.
   * Block clicks still reach `onBlockClick` (a read-only window).
   */
  readOnly?: boolean;
  /**
   * A click on an empty cell (one day), or a drag across empty cells of one
   * row (every crossed day that is empty and not blocked).
   */
  onCreate?: (rowId: string, days: number[]) => void;
  /** A block's edge grip dragged along its row: the crossed days that are empty and not blocked. */
  onCopy?: (blockId: string, days: number[]) => void;
  /** A block's middle dropped on an empty, open cell of any row. */
  onMove?: (blockId: string, toRowId: string, toDay: number) => void;
  /** A block clicked, tapped or Entered. */
  onBlockClick?: (blockId: string) => void;
  /** The ghost text in the cells a create drag covers — the hours it will get ("08:00–14:00"). */
  createPreview?: (rowId: string) => string;
  /** Skeleton rows instead of the body, `aria-busy`, no interaction. */
  loading?: boolean;
  /** Replaces the body: the host's error (an `ErrorState` with its retry). */
  error?: React.ReactNode;
  /** Shown when there are no rows at all. */
  empty?: React.ReactNode;
  /** The header row sticks this far from the top of the scroll container (a sticky page bar above). Default 0. */
  stickyTop?: number;
  /** The grid's accessible name ("Escala da semana"). */
  'aria-label'?: string;
  /** The component's own words: cell names and the live region's sentences. Default: the English pack. */
  labels?: Partial<ScheduleGridLabels>;
  /**
   * Base test id (default `schedule-grid`). Parts: `-header`, `-row-${rowId}`,
   * `-cell-${rowId}-${day}`, `-block-${blockId}`, `-grip-l-${blockId}`,
   * `-grip-r-${blockId}`, `-break-${blockId}`, `-live`, `-loading`.
   */
  dataTestId?: string;
}
