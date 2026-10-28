import type * as React from 'react';

import type { DayRulerLabels } from '../../../copy/labels';
import type { ScheduleBlockTone } from '../ScheduleGrid/ScheduleGrid.types';

/**
 * Times on the ruler are HOURS from the day's midnight, fractions included:
 * `20.75` is 20:45, and a value past 24 is the next morning (`26` is 02:00).
 */
export type RulerHour = number;

/** A scheduled block on a row's track. */
export interface DayRulerBlock {
  id: string;
  start: RulerHour;
  end: RulerHour;
  /** What the block says ("↻ 20:39–00:00", "Ausente"). One line, cut with an ellipsis. */
  label: string;
  /** What a NARROW block says on a narrow ruler (a phone) instead of a cut label — its start ("20:39"). */
  shortLabel?: string;
  tone: ScheduleBlockTone;
  /** Its middle can be dragged along the row (and Alt+←/→ moves it). */
  movable?: boolean;
  /** Its ends can be dragged (and Shift+←/→ moves its end, Shift+Alt+←/→ its start). */
  resizable?: boolean;
  /** Drawn with a ring (the block whose window is open). */
  selected?: boolean;
  /** Tooltip and full text. Default: `label`. */
  title?: string;
  /**
   * A stretch inside the block that is not worked (a meal break), in ruler
   * hours, drawn as a hatched gap. It travels with the block while it is
   * dragged and is cut to the block's ends. The words for it are the host's
   * (`label`, `title`).
   */
  breakSpan?: { start: RulerHour; end: RulerHour };
}

/** The shift as it really runs: a thin bar under the blocks. */
export interface DayRulerActual {
  start: RulerHour;
  end: RulerHour;
}

/** One person (or resource) on the day. */
export interface DayRulerRow {
  id: string;
  label: string;
  /** Under the name ("em turno desde 08:26 · sem escala", "atrasado · era 20:39"). */
  meta?: string;
  metaTone?: 'default' | 'warning';
  /** Beside the name, on its line (a "Freela" tag); moves under the name when the column has no room for both. */
  nameAdornment?: React.ReactNode;
  /** Under the meta: the host's chips (praça, "Em pausa desde …"). One line; a chip that does not fit shrinks, its label cut. */
  chips?: React.ReactNode;
  /** The row's own buttons ("Encerrar turno", "Iniciar agora"), at the end of the row. */
  actions?: React.ReactNode;
  blocks: readonly DayRulerBlock[];
  actual?: DayRulerActual;
  /** Written on the track at the actual bar's start ("sem escala · desde 08:26"). */
  actualLabel?: string;
  /** The heading of the group this row opens or continues ("Entregas"); a new value starts a new group. */
  group?: string;
  /** Makes the name a button. */
  onLabelClick?: () => void;
  labelAccessible?: string;
}

export interface DayRulerProps {
  rows: readonly DayRulerRow[];
  /** The ruler's first hour (default 6, 06:00). */
  from?: RulerHour;
  /** Its last hour (default 26, 02:00 the next day). */
  to?: RulerHour;
  /** "Agora": a line across every track, when it falls on the ruler. */
  now?: RulerHour;
  /** People per hour, one entry per hour from `from` (index 0 = `from…from+1`). Drawn above the axis. */
  coverage?: readonly number[];
  /** Beside the coverage row ("Na escala, por hora"). */
  coverageLabel?: string;
  /** An axis label every this many hours (default 4). */
  tickHours?: number;
  /** Every gesture snaps to this (default 15 minutes). */
  snapMinutes?: number;
  /** A click alone on a track creates this long (default 4 hours). */
  createHours?: number;
  /** Where Enter on a focused track creates (default: `now` snapped up, else `from`). */
  createStart?: (rowId: string) => RulerHour;
  /** No create, move or resize. Block clicks still reach `onBlockClick`. */
  readOnly?: boolean;
  onCreate?: (rowId: string, start: RulerHour, end: RulerHour) => void;
  onMove?: (blockId: string, start: RulerHour, end: RulerHour) => void;
  onResize?: (blockId: string, start: RulerHour, end: RulerHour) => void;
  onBlockClick?: (blockId: string) => void;
  loading?: boolean;
  error?: React.ReactNode;
  empty?: React.ReactNode;
  'aria-label'?: string;
  /** The component's own words. Default: the English pack. */
  labels?: Partial<DayRulerLabels>;
  /**
   * Base test id (default `day-ruler`). Parts: `-coverage`, `-axis`, `-row-${rowId}`,
   * `-track-${rowId}`, `-block-${blockId}`, `-handle-l-${blockId}`, `-handle-r-${blockId}`, `-break-${blockId}`,
   * `-actual-${rowId}`, `-now`, `-preview`, `-live`, `-loading`.
   */
  dataTestId?: string;
}
