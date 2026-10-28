/**
 * THE WEEK GRID'S NUMBERS — the approved prototype's (FUT-3823, frame d01 at
 * 1280), in px. The web reads them through `rem`/`sxRem` so a density mode
 * scales them.
 */
export const SCHEDULE_GRID_METRICS = {
  /**
   * The name column: 200px on a wide computer; 140px on a narrow one and while
   * the days scroll (a long name or meta still takes two lines, never three);
   * 120px on a phone-sized pane.
   */
  nameColumn: { wide: 200, compact: 140, narrow: 120 },
  /**
   * The narrowest a day column gets, per layout (see `layoutsOf` in the
   * styles, which derives each layout's minimum container from these):
   * - `wide`: with its edge grips, the hours whole ("20:39–00:00" is 67px);
   *   a long note ellipsizes, whole in `title`, as the prototype's 1280 frame;
   * - `compact`: the same, the block's text 9px off each edge
   *   (`blockPadding.tight`), clear of the grips' bars;
   * - `scrolled`: the days scroll sideways under the pinned names, grips kept,
   *   every hours and note line whole (the longest note, "↻ a cada 2
   *   semanas", is 113px; 152 − 24 − 12 is 116);
   * - `narrow`: a phone-sized pane, no grips, the same.
   * Never slivers, never cut hours.
   */
  dayMin: { wide: 104, compact: 98, scrolled: 152, narrow: 136 },
  /** The total column ("18h"). */
  totalColumn: { wide: 56, compact: 40 },
  /** Below this container width the pane is phone-sized: no grips (a phone renders DayRuler per day). */
  narrowBelow: 600,
  /** Between columns and between rows. */
  gap: 6,
  cellMinHeight: 56,
  cellRadius: 8,
  cellPadding: 4,
  /** Between two blocks of one cell (a split shift). */
  blockGap: 4,
  blockRadius: 6,
  /** Inside a block: room for the grips on both sides. */
  blockPadding: { y: 4, start: 10, end: 14, tight: 9 },
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
  button: { minHeight: 24, radius: 4, ringOffset: 2, hitArea: 40 },
  ring: 2,
} as const;
