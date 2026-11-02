/** `DayRuler`'s en-US words, and the component's own fallback when `labels` is not given. */
import type { DayRulerLabels } from './DayRuler.labels';

export const EN_US_DAY_RULER_LABELS: DayRulerLabels = {
  createTrack: (row) => `Schedule ${row}`,
  moved: (block, range) => `${block} now ${range}`,
  resized: (block, range) => `${block} now ${range}`,
  refused: "It cannot go further",
  notMovable: "This shift cannot be changed here",
  loading: "Loading the day",
  footerMarked: "short of people",
};
