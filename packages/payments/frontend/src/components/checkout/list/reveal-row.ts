/**
 * A row the buyer just chose opens what it asks for (the troco chips, the
 * card's fields) — and on a phone the list's bar is pinned over the bottom of
 * the screen, its height whatever the host's lines, the chosen way's discount
 * and the host's notes make it. The opened row is scrolled clear of the bar
 * as MEASURED, never a guessed height: a control under the bar cannot be
 * tapped, and the bar's own reason would point at it (FUT-4416 UI review).
 */

/** The part of a box this needs — a `DOMRect` fits. */
export interface RowBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The space kept between the opened row and the bar, on the theme's 8px grid. */
export const ROW_TO_BAR_GAP = 8;

/**
 * How much of the bottom of a viewport `viewportHeight` tall the bar hides
 * over `row`, in px: 0 when there is no bar, when it sits beside the row (the
 * computer's "Resumo do pedido" column), or when it is below the screen.
 */
export function barClearance(row: RowBox, bar: RowBox | null, viewportHeight: number): number {
  if (!bar) return 0;
  const beside = bar.right <= row.left || bar.left >= row.right;
  if (beside || bar.top >= viewportHeight) return 0;
  return Math.max(0, viewportHeight - Math.max(bar.top, 0));
}

/** The list's bar: the host's pinned `ActionBar`, or the column's block. */
function barOf(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[data-testid="list-pay-bar"]');
}

/**
 * Scroll `row` into view clear of the bar: its bottom, gap included, above
 * the bar's top — or, for a row taller than the room left, its top in view.
 * Absent where there is no layout (jsdom, a host's own tests): nothing.
 */
export function revealRow(row: HTMLElement | null): void {
  if (!row || typeof row.scrollIntoView !== "function") return;
  const view = row.ownerDocument.defaultView;
  if (!view) return;
  const bar = barOf(row.ownerDocument);
  const clearance = barClearance(row.getBoundingClientRect(), bar?.getBoundingClientRect() ?? null, view.innerHeight);
  const previous = row.style.scrollMarginBottom;
  row.style.scrollMarginBottom = `${clearance + ROW_TO_BAR_GAP}px`;
  row.scrollIntoView({ block: "nearest" });
  row.style.scrollMarginBottom = previous;
}
