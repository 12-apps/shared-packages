/**
 * THE DAY RULER'S NUMBERS — the approved prototype's (FUT-3823, frames d02 at
 * 1280 and the phone rows), in px. The web reads them through `rem`/`sxRem`.
 */
export const DAY_RULER_METRICS = {
  /** The name column on a computer; a row's actions sit in it, under the name (FUT-3831). */
  sideColumn: 220,
  gap: 16,
  /** Between the name (with its meta and chips) and the row's actions under it, on a computer. */
  actionsTop: 8,
  /**
   * Below this container width a row stacks: name and actions on top, the
   * track under them. Measured when the actions had a 220px column of their
   * own (two 220px side columns, their gaps and a track of at least 320px,
   * where the hour labels every 4 hours do not collide: 792, rounded up); kept
   * when they moved under the name (FUT-3831) so the bound every host was
   * checked at did not move.
   */
  compactBelow: 800,
  /**
   * Below this container width the pane is phone-sized: no coverage row and
   * no hour axis. Between it and `compactBelow` the rows stack and the two
   * lines are drawn across the full width, like the tracks.
   */
  phoneBelow: 600,
  rowPaddingY: 8,
  track: { height: 40, compactHeight: 30, radius: 8, compactRadius: 6 },
  /**
   * `hitArea`: on a narrow ruler the invisible hit band round a bar is this
   * tall and at least this wide, centred on the bar and cut at the midpoint to
   * a neighbour (FUT-3831). `font` is the floor: a text that does not fit at
   * it is not drawn, never drawn smaller.
   */
  block: { top: 4, height: 24, compactTop: 3, compactHeight: 20, radius: 6, paddingX: 6, font: 12, hitArea: 40 },
  /** The end handles' hit area. */
  handle: 10,
  actual: { top: 31, height: 6, compactTop: 24, compactHeight: 4, radius: 3 },
  actualLabel: { top: 8, offset: 6, font: 12 },
  now: { width: 2, overhang: 2 },
  coverage: { height: 26, gap: 2, radius: 4, font: 12 },
  axis: { height: 18, font: 12 },
  name: 15,
  meta: 13,
  groupTitle: 12,
  ring: 2,
  /** How far a block's focus ring stands off it. */
  ringOffset: 1,
  /** The loading row's name bar. */
  skeletonNameRadius: 4,
  /** Where a block's text cannot be measured, one shorter than this share of the ruler says only its start. */
  narrowShare: 0.3,
  /** The shortest block a resize leaves, in hours. */
  minHours: 0.5,
  skeletonRows: 4,
  /** The hatch of a break inside a block: stripe width. */
  breakStripe: { ink: 2, gap: 3 },
} as const;
