/**
 * `ScheduleGrid`'s words, in both languages. They live with the component
 * rather than in `UiLabels` so they load only with it: `EN_US_UI_LABELS` and
 * `PT_BR_UI_LABELS` are imported by eagerly loaded components (`Avatar`), and
 * every family in them ships to every host that renders any of those (FUT-3831).
 *
 * A pt-BR host passes `SCHEDULE_GRID_LABELS['pt-BR']` to `labels`; the grid
 * falls back to `'en-US'` on its own.
 */

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

/** The same shape `locales.ts`'s `pack(...)` yields. */
export const SCHEDULE_GRID_LABELS: { readonly 'pt-BR': ScheduleGridLabels; readonly 'en-US': ScheduleGridLabels } = {
  'pt-BR': {
    createCell: (row, column) => `Agendar ${row}, ${column}`,
    blockedCell: (row, column) => `${row}, ${column}: fechado`,
    copied: (block, column) => `${block} copiado para ${column}`,
    moved: (block, row, column) => `${block} movido para ${row}, ${column}`,
    refused: "Não dá para pôr aí: o dia está ocupado ou fechado",
    notMovable: "Este turno não muda por aqui",
    loading: "Carregando a escala",
  },
  'en-US': {
    createCell: (row, column) => `Schedule ${row}, ${column}`,
    blockedCell: (row, column) => `${row}, ${column}: closed`,
    copied: (block, column) => `${block} copied to ${column}`,
    moved: (block, row, column) => `${block} moved to ${row}, ${column}`,
    refused: "Not there: that day is taken or closed",
    notMovable: "This shift cannot be changed here",
    loading: "Loading the schedule",
  },
};
