/** `DayRuler`'s pt-BR words. A pt-BR host passes `DAY_RULER_LABELS['pt-BR']` (or this) to `labels`. */
import type { DayRulerLabels } from './DayRuler.labels';

export const PT_BR_DAY_RULER_LABELS: DayRulerLabels = {
  createTrack: (row) => `Agendar ${row}`,
  moved: (block, range) => `${block} agora ${range}`,
  resized: (block, range) => `${block} agora ${range}`,
  refused: "Não dá para ir além",
  notMovable: "Este turno não muda por aqui",
  loading: "Carregando o dia",
  footerMarked: "falta gente",
};
