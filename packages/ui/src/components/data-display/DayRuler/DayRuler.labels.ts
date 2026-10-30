/**
 * `DayRuler`'s words, in both languages. They live with the component rather
 * than in `UiLabels` so they load only with it: `EN_US_UI_LABELS` and
 * `PT_BR_UI_LABELS` are imported by eagerly loaded components (`Avatar`), and
 * every family in them ships to every host that renders any of those (FUT-3831).
 *
 * Each language is a named pack beside the component (`DayRuler.pt-BR.ts`,
 * `DayRuler.en-US.ts`). A pt-BR host passes `DAY_RULER_LABELS['pt-BR']` to
 * `labels`; the ruler falls back to `'en-US'` on its own.
 */
import { EN_US_DAY_RULER_LABELS } from './DayRuler.en-US';
import { PT_BR_DAY_RULER_LABELS } from './DayRuler.pt-BR';

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
  /** Said after a group footer's marked hour when the host gives it no `title` (FUT-3882). */
  footerMarked?: string;
}

/**
 * Both packs, in the shape `locales.ts`'s `pack(...)` yields. The component
 * itself imports only the en-US file, its fallback.
 */
export const DAY_RULER_LABELS: { readonly 'pt-BR': DayRulerLabels; readonly 'en-US': DayRulerLabels } = {
  'pt-BR': PT_BR_DAY_RULER_LABELS,
  'en-US': EN_US_DAY_RULER_LABELS,
};
