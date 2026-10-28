/**
 * THE DAY RULER'S NUMBERS — the approved prototype's (FUT-3823, frames d02 at
 * 1280 and the phone rows), in px. The web reads them through `rem`/`sxRem`.
 */
export const DAY_RULER_METRICS = {
  /** The name and the actions columns on a computer. */
  sideColumn: 220,
  gap: 16,
  /**
   * Below this container width a row stacks: name and actions on top, the
   * track under them. Two 220px side columns, their gaps and a track of at
   * least 320px (where the hour labels every 4 hours do not collide): 792,
   * rounded up.
   */
  compactBelow: 800,
  rowPaddingY: 8,
  track: { height: 40, compactHeight: 30, radius: 8, compactRadius: 6 },
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
  /** A block shorter than this share of the ruler says only its start on a narrow ruler. */
  narrowShare: 0.3,
  /** The shortest block a resize leaves, in hours. */
  minHours: 0.5,
  skeletonRows: 4,
  /** The hatch of a break inside a block: stripe width. */
  breakStripe: { ink: 2, gap: 3 },
} as const;
