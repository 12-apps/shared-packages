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
 * the bar's top (no scroll for a row already there) — or, for a row taller
 * than the room above the bar, its top at the top of the screen.
 * `viewportHeight` defaults to the row's window's. Absent where there is no
 * layout (jsdom, a host's own tests): nothing.
 */
export function revealRow(row: HTMLElement | null, viewportHeight?: number): void {
  if (!row || typeof row.scrollIntoView !== "function") return;
  const height = viewportHeight ?? row.ownerDocument.defaultView?.innerHeight;
  if (height === undefined) return;
  const bar = barOf(row.ownerDocument);
  const box = row.getBoundingClientRect();
  const clearance = barClearance(box, bar?.getBoundingClientRect() ?? null, height);
  // A row taller than the room above the bar: its top at the top of the screen.
  if (box.bottom - box.top + ROW_TO_BAR_GAP > height - clearance) return row.scrollIntoView({ block: "start" });
  const previous = row.style.scrollMarginBottom;
  row.style.scrollMarginBottom = `${clearance + ROW_TO_BAR_GAP}px`;
  row.scrollIntoView({ block: "nearest" });
  row.style.scrollMarginBottom = previous;
}

/** How long after a press the row is kept clear while the bar settles. */
export const SETTLE_MS = 1_000;

/** What `keepRowClear` needs of the browser — faked in its tests. */
export interface SettleDeps {
  /** Call `onResize` whenever one of `targets` changes size; returns the disconnect. */
  observe: (targets: readonly Element[], onResize: () => void) => () => void;
  /** Call `done` once after `ms`; returns the cancel. */
  after: (ms: number, done: () => void) => () => void;
  /** Call `scrolled` on the buyer's own next scroll (wheel, touch, keys); returns the removal. */
  onUserScroll: (scrolled: () => void) => () => void;
}

/**
 * Reveal `row` now, then again each time the bar or the row changes size —
 * the host's nudges and notes reach the bar a render or more after the press —
 * until the buyer scrolls themselves or `SETTLE_MS` passes. Returns the stop.
 */
export function keepRowClear(row: HTMLElement, reveal: () => void, deps: SettleDeps): () => void {
  const bar = barOf(row.ownerDocument);
  const ends: (() => void)[] = [];
  let live = true;
  const stop = (): void => {
    if (!live) return;
    live = false;
    ends.forEach((end) => end());
  };
  reveal();
  ends.push(deps.observe(bar ? [row, bar] : [row], () => (live ? reveal() : undefined)));
  ends.push(deps.after(SETTLE_MS, stop));
  ends.push(deps.onUserScroll(stop));
  return stop;
}

/** The buyer's own scrolling: these, never the `scroll` event the reveal itself causes. */
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown"] as const;

/** `SettleDeps` for a real window; a missing `ResizeObserver` observes nothing. */
export function browserSettleDeps(view: Window): SettleDeps {
  return {
    observe: (targets, onResize) => {
      const Observer = (view as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      if (typeof Observer !== "function") return () => undefined;
      const observer = new Observer(onResize);
      targets.forEach((target) => observer.observe(target));
      return () => observer.disconnect();
    },
    after: (ms, done) => {
      const timer = view.setTimeout(done, ms);
      return () => view.clearTimeout(timer);
    },
    onUserScroll: (scrolled) => {
      USER_SCROLL_EVENTS.forEach((type) => view.addEventListener(type, scrolled, { capture: true, passive: true }));
      return () => USER_SCROLL_EVENTS.forEach((type) => view.removeEventListener(type, scrolled, { capture: true }));
    },
  };
}
