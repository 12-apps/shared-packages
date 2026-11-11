/**
 * A HELD sheet, and the level a question asked over it must clear (FUT-4478).
 *
 * A `controlled` sheet stays open when its host refuses a close: the host
 * answers with a question ("leave without saving?") and the form must still be
 * there behind it. That question is a dialog the host renders NEXT to the sheet,
 * not inside it, so it cannot inherit the sheet's level through context, and it
 * opens at `zIndex.modal`. The sheet is often higher: a host's stack puts it at
 * `BASE + depth * STEP`, and a host theme may lift a bottom drawer to
 * `stackedOverlayZIndex` with a selector the sheet's own `zIndex` never sees.
 * Before sheets were held the sheet had slid away by then, so nobody noticed.
 *
 * So a held sheet marks its drawer root while it is open, and the dialog reads
 * the COMPUTED z-index of every marked root when it opens — whatever put the
 * sheet there. Only held sheets are marked: an uncontrolled sheet closes at
 * once, and nothing about its stacking changes.
 */

/** The attribute an open, held sheet carries on its drawer root. */
export const HELD_SHEET_ATTRIBUTE = 'data-held-sheet';

/**
 * The highest z-index of the held sheets open right now, or `null` when there
 * are none (or no DOM to ask, as on a server render).
 */
export function heldSheetCeiling(): number | null {
  if (typeof document === 'undefined') return null;
  let ceiling: number | null = null;
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(`[${HELD_SHEET_ATTRIBUTE}]`))) {
    const level = Number.parseInt(getComputedStyle(root).zIndex, 10);
    if (Number.isFinite(level) && (ceiling === null || level > ceiling)) ceiling = level;
  }
  return ceiling;
}

/**
 * The z-index a dialog opening at `ownLevel` takes so it paints above every
 * held sheet: one above the highest, or `undefined` (its own level stands) when
 * no held sheet reaches it — a dialog already raised past the sheet, say by a
 * theme that moved `zIndex.modal` for the sheet's subtree, is left alone.
 */
export function levelAboveHeldSheets(ownLevel: number): number | undefined {
  const ceiling = heldSheetCeiling();
  return ceiling !== null && ceiling >= ownLevel ? ceiling + 1 : undefined;
}
