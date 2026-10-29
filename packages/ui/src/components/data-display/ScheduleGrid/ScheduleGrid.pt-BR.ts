/** `ScheduleGrid`'s pt-BR words. A pt-BR host passes `SCHEDULE_GRID_LABELS['pt-BR']` (or this) to `labels`. */
import type { ScheduleGridLabels } from './ScheduleGrid.labels';

export const PT_BR_SCHEDULE_GRID_LABELS: ScheduleGridLabels = {
  createCell: (row, column) => `Agendar ${row}, ${column}`,
  blockedCell: (row, column) => `${row}, ${column}: fechado`,
  copied: (block, column) => `${block} copiado para ${column}`,
  moved: (block, row, column) => `${block} movido para ${row}, ${column}`,
  refused: "Não dá para pôr aí: o dia está ocupado ou fechado",
  notMovable: "Este turno não muda por aqui",
  loading: "Carregando a escala",
};
