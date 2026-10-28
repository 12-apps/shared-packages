/**
 * THE WEEK GRID'S NUMBERS — the approved prototype's (FUT-3823, frame d01 at
 * 1280), in px. The web reads them through `rem`/`sxRem` so a density mode
 * scales them.
 */
export const SCHEDULE_GRID_METRICS = {
  /**
   * The name column: 200px on a wide computer; 140px on a narrow one (a long
   * name or meta still takes two lines, never three); 140px while the days
   * scroll sideways; 120px on a phone-sized pane.
   */
  nameColumn: { wide: 200, medium: 140, scrolled: 140, narrow: 120 },
  /**
   * The narrowest a day column gets. With its edge grips `wide` keeps the
   * hours whole ("20:39–00:00" is 67px; long notes ellipsize, whole in
   * `title`, as the prototype's 1280 frame does); `medium` does the same with
   * the block's text 9px off each edge (`blockPadding.tight`), clear of the
   * grips' bars. While the days scroll,
   * `scrolled` keeps every hours and note line whole beside the grips (the
   * longest note, "↻ a cada 2 semanas", is 113px; 152 − 24 grips − 12 is 116);
   * below the narrow break the grips go and `narrow` does the same. Never
   * slivers, never cut hours.
   */
  dayMin: { wide: 104, medium: 98, scrolled: 152, narrow: 136 },
  /** The total column ("18h"). */
  totalColumn: { wide: 56, narrow: 40 },
  /**
   * Container widths, from wide to narrow:
   * - `medium` (1040): seven 104px days stop fitting beside a 200px name and a
   *   56px total (200 + 728 + 56 + 48 = 1032): the name narrows to 140px, the
   *   total to 40px and the days to 98px (140 + 686 + 40 + 48 = 914);
   * - `scroll` (939, so a 940px container is the first that never scrolls): those stop fitting too, so the days get `dayMin.scrolled`
   *   and scroll sideways under the pinned names — grips kept, so edge copy
   *   works at every computer width;
   * - `narrow` (600): a phone-sized pane, no grips.
   * The grid never scrolls sideways, and its header row sticks to the page,
   * from a 940px container up — a 1280 laptop beside the admin's rail and panel.
   */
  containerBreak: { medium: 1040, scroll: 939, narrow: 600 },
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
