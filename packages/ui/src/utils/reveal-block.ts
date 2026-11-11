/**
 * Scroll ONLY as much as a block needs to be read whole.
 *
 * When a step opens, or a picked option opens content inside it, the page moves
 * just far enough for that block to be read whole: its end `gap` above the
 * bottom inset (a sticky action bar); a block taller than the view puts its top
 * `gap` under the top inset (sticky chrome) instead; a block already fully in
 * view does not move the page at all. Smoothly, unless the visitor asked for
 * reduced motion.
 *
 * It replaces `scrollIntoView({ block: 'nearest' })`, which brings the block's
 * first line into view and leaves its body, and the action under it, behind a
 * pinned bar.
 *
 * The insets are the CALLER's: this module knows no bar and no CSS variable. A
 * host that publishes its bar's height reads it in a function it passes as
 * `bottomInset`, so every reveal measures the bar as it is now. The scroller is
 * the nearest scrolling ancestor, or the page.
 *
 * All lengths here are device pixels read from `getBoundingClientRect` and
 * written to `scrollBy`, so they are not theme sizes.
 */

/** The breathing room kept between the revealed block and the inset edge, in px. */
export const REVEAL_GAP = 12;

/** How long {@link followBlock} keeps following a block that is still settling, in ms. */
export const REVEAL_SETTLE_MS = 2000;

/** A vertical edge in viewport coordinates. */
export interface RevealBox {
  top: number;
  bottom: number;
}

/** An inset in px: a number, or a function read at every reveal (a bar whose height changes). */
export type RevealInset = number | (() => number);

/** What {@link revealBlock} and {@link followBlock} take. */
export interface RevealOptions {
  /** Px a sticky header covers at the top of the scroller. Default 0. */
  topInset?: RevealInset;
  /** Px a sticky action bar covers at the bottom of the scroller. Default 0. */
  bottomInset?: RevealInset;
  /** Px kept between the block and the inset edge. Default {@link REVEAL_GAP}. */
  gap?: number;
}

/** What {@link followBlock} adds. */
export interface FollowOptions extends RevealOptions {
  /** How long to follow the block while it settles, in ms. Default {@link REVEAL_SETTLE_MS}. */
  settleMs?: number;
  /**
   * Elements whose resize re-runs the reveal, usually the sticky bars the
   * insets measure: a bar that grows with its rows covers more of the block.
   */
  watch?: readonly (Element | null)[];
}

function inset(value: RevealInset | undefined): number {
  const px = typeof value === 'function' ? value() : (value ?? 0);
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/** The nearest ancestor that scrolls vertically, or `null` for the page itself. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/**
 * How far to scroll so `box` reads whole inside `view`: `0` when it already
 * does, the distance that puts its end `gap` above the view's end when it fits,
 * and the distance that puts its top `gap` under the view's top when it is
 * taller than the view. Positive scrolls down. Pure, so the three outcomes are
 * asserted without a browser.
 */
export function revealDelta(box: RevealBox, view: RevealBox, gap: number = REVEAL_GAP): number {
  if (box.top >= view.top && box.bottom <= view.bottom) return 0;
  const fits = box.bottom - box.top + 2 * gap <= view.bottom - view.top;
  return fits ? box.bottom - (view.bottom - gap) : box.top - (view.top + gap);
}

/** Whether the visitor asked the system for less motion. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Scroll the nearest scroller just enough for `el` to read whole. */
export function revealBlock(el: HTMLElement | null, options: RevealOptions = {}): void {
  if (el === null) return;
  const rect = el.getBoundingClientRect();
  // No box (display: none, detached, or a DOM with no layout): there is
  // nothing on screen to reveal, so nothing is measured — the ancestor walk
  // and the insets are a computed-style lookup each.
  if (rect.width === 0 && rect.height === 0) return;
  const own = scroller(el);
  const frame = own?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const view = { top: frame.top + inset(options.topInset), bottom: frame.bottom - inset(options.bottomInset) };
  const delta = revealDelta({ top: rect.top, bottom: rect.bottom }, view, options.gap);
  if (delta === 0) return;
  (own ?? window).scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Reveal `el` now, and again whenever it grows or a watched bar changes size
 * while it settles: a step opens on what it has, then its content arrives, and
 * a reveal measured on the first paint leaves its end under the bar.
 *
 * Stops after `settleMs`, or when the returned function is called; after that
 * the page is the visitor's to scroll.
 */
export function followBlock(el: HTMLElement | null, options: FollowOptions = {}): () => void {
  revealBlock(el, options);
  if (el === null || typeof ResizeObserver === 'undefined') return () => undefined;
  let frame = 0;
  let timer = 0;
  const again = (): void => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => revealBlock(el, options));
  };
  const observer = new ResizeObserver(again);
  observer.observe(el);
  for (const bar of options.watch ?? []) {
    if (bar) observer.observe(bar);
  }
  const stop = (): void => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
  timer = window.setTimeout(stop, options.settleMs ?? REVEAL_SETTLE_MS);
  return stop;
}
