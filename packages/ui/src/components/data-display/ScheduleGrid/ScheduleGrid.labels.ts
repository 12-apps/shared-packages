/**
 * `ScheduleGrid`'s words, in both languages. They live with the component
 * rather than in `UiLabels` so they load only with it: `EN_US_UI_LABELS` and
 * `PT_BR_UI_LABELS` are imported by eagerly loaded components (`Avatar`), and
 * every family in them ships to every host that renders any of those (FUT-3831).
 *
 * Each language is a named pack beside the component (`ScheduleGrid.pt-BR.ts`,
 * `ScheduleGrid.en-US.ts`). A pt-BR host passes `SCHEDULE_GRID_LABELS['pt-BR']` to
 * `labels`; the grid falls back to `'en-US'` on its own.
 */
import { EN_US_SCHEDULE_GRID_LABELS } from './ScheduleGrid.en-US';
import { PT_BR_SCHEDULE_GRID_LABELS } from './ScheduleGrid.pt-BR';

/** `ScheduleGrid`'s cell names and the sentences its live region reads after a keyboard copy or move. */
export interface ScheduleGridLabels {
  /** An empty cell's button: schedule this row on this day. */
  createCell(row: string, column: string): string;
  /** A blocked cell with no label of its own. */
  blockedCell(row: string, column: string): string;
  /** After Shift+←/→ copied a block to the next or previous day. */
  copied(block: string, column: string): string;
  /** After Alt+←/→ moved a block to the next or previous day. */
  moved(block: string, row: string, column: string): string;
  /** A keyboard copy or move whose day is taken, closed or outside the grid. */
  refused: string;
  /** Shift/Alt+←/→ on a block that is not `copyable` / `movable`: the block is fixed, not the day. */
  notMovable: string;
  /** The grid's busy state. */
  loading: string;
}

/**
 * Both packs, in the shape `locales.ts`'s `pack(...)` yields. The component
 * itself imports only the en-US file, its fallback.
 */
export const SCHEDULE_GRID_LABELS: { readonly 'pt-BR': ScheduleGridLabels; readonly 'en-US': ScheduleGridLabels } = {
  'pt-BR': PT_BR_SCHEDULE_GRID_LABELS,
  'en-US': EN_US_SCHEDULE_GRID_LABELS,
};
