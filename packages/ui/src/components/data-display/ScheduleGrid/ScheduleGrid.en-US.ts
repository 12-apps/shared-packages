/** `ScheduleGrid`'s en-US words, and the component's own fallback when `labels` is not given. */
import type { ScheduleGridLabels } from './ScheduleGrid.labels';

export const EN_US_SCHEDULE_GRID_LABELS: ScheduleGridLabels = {
  createCell: (row, column) => `Schedule ${row}, ${column}`,
  blockedCell: (row, column) => `${row}, ${column}: closed`,
  copied: (block, column) => `${block} copied to ${column}`,
  moved: (block, row, column) => `${block} moved to ${row}, ${column}`,
  refused: "Not there: that day is taken or closed",
  notMovable: "This shift cannot be changed here",
  loading: "Loading the schedule",
};
