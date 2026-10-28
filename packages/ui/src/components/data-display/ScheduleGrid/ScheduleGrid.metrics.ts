/**
 * THE WEEK GRID'S NUMBERS — the approved prototype's (FUT-3823, frame d01 at
 * 1280), in px. The web reads them through `rem`/`sxRem` so a density mode
 * scales them.
 */
export const SCHEDULE_GRID_METRICS = {
  /** The name column on a computer; it narrows with the container (see `nameColumn`). */
  nameColumn: { wide: 200, medium: 140, narrow: 96 },
  /** The total column ("18h"). */
  totalColumn: { wide: 56, narrow: 40 },
  /** Container widths below which the name column narrows. */
  containerBreak: { medium: 900, narrow: 600 },
  /** Between columns and between rows. */
  gap: 6,
  cellMinHeight: 56,
  cellRadius: 8,
  cellPadding: 4,
  /** Between two blocks of one cell (a split shift). */
  blockGap: 4,
  blockRadius: 6,
  /** Inside a block: room for the grips on both sides. */
  blockPadding: { y: 4, start: 10, end: 14 },
  blockFont: 12,
  /** The edge grip's hit area and its bar. */
  grip: { width: 12, barWidth: 3, barHeight: 16, barRadius: 2 },
  /** The selected block's ring, and every focus ring. */
  ring: 2,
  /** How far a block's focus ring stands off it. */
  ringOffset: 1,
  /** The dashed outline of a cell a create or copy will land on. */
  targetBorder: 1.5,
  headerLabel: 13,
  headerSublabel: 13,
  rowName: 14,
  rowMeta: 13,
  groupTitle: 12,
  total: 13,
  plusIcon: 16,
  /** Skeleton rows while loading. */
  skeletonRows: 4,
  /** The hatch of a blocked cell: stripe width. */
  hatch: 6,
  /** The hatch of a break inside a block: stripe width. */
  breakStripe: { ink: 2, gap: 3 },
} as const;

/**
 * THE NAME COLUMN'S NUMBERS, shared by the week grid and the day ruler
 * (`ScheduleNameCell`): the name as a button. In px.
 */
export const SCHEDULE_NAME_METRICS = {
  button: { minHeight: 24, radius: 4, ringOffset: 2 },
  ring: 2,
} as const;
