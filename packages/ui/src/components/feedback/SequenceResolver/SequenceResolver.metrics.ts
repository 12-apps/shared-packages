/**
 * THE RESOLVER'S NUMBERS — the approved prototype's, in px. The web reads
 * them through `rem`/`sxRem` so a density mode scales them (FUT-3671).
 */
export const SEQUENCE_METRICS = {
  /** Below this width the dialog is the inset bottom sheet, and targets are 44px+. */
  sheetBreakpoint: 'sm',
  /** The sheet never grows past this share of the viewport; the paper scrolls inside it. */
  sheetMaxHeightPercent: 95,
  /** The smallest a control may be below the sheet breakpoint. */
  touchTarget: 44,
  /** Header icon button: 40px on a pointer, 44px on a phone. */
  closeSize: { pointer: 40, touch: 44 },
  /** The drag handle — decoration only, the sheet does not drag. */
  handle: { width: 40, height: 4 },
  title: 22,
  stepLabel: 13,
  categoryDescription: 13,
  categoryMinHeight: 56,
  countBadge: 32,
  listRadius: 12,
  doneIcon: 44,
  doneTitle: 20,
} as const;
