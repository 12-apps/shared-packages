/**
 * `DayRuler`'s words, in both languages. They live with the component rather
 * than in `UiLabels` so they load only with it: `EN_US_UI_LABELS` and
 * `PT_BR_UI_LABELS` are imported by eagerly loaded components (`Avatar`), and
 * every family in them ships to every host that renders any of those (FUT-3831).
 *
 * A pt-BR host passes `DAY_RULER_LABELS['pt-BR']` to `labels`; the ruler falls
 * back to `'en-US'` on its own.
 */

/** `DayRuler`'s track names and the sentences its live region reads after a keyboard move or resize. */
export interface DayRulerLabels {
  /** A row's empty track: Enter schedules this row. */
  createTrack(row: string): string;
  /** After Alt+←/→ moved a block; `range` is "20:45–00:45". */
  moved(block: string, range: string): string;
  /** After Shift(+Alt)+←/→ changed a block's end or start. */
  resized(block: string, range: string): string;
  /** A keyboard move or resize past the ruler's ends or under the shortest length. */
  refused: string;
  /** Shift/Alt+←/→ on a block that is not `movable` / `resizable`: the block is fixed. */
  notMovable: string;
  /** The ruler's busy state. */
  loading: string;
}

/** The same shape `locales.ts`'s `pack(...)` yields. */
export const DAY_RULER_LABELS: { readonly 'pt-BR': DayRulerLabels; readonly 'en-US': DayRulerLabels } = {
  'pt-BR': {
    createTrack: (row) => `Agendar ${row}`,
    moved: (block, range) => `${block} agora ${range}`,
    resized: (block, range) => `${block} agora ${range}`,
    refused: "Não dá para ir além",
    notMovable: "Este turno não muda por aqui",
    loading: "Carregando o dia",
  },
  'en-US': {
    createTrack: (row) => `Schedule ${row}`,
    moved: (block, range) => `${block} now ${range}`,
    resized: (block, range) => `${block} now ${range}`,
    refused: "It cannot go further",
    notMovable: "This shift cannot be changed here",
    loading: "Loading the day",
  },
};
