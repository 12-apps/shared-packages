"use client";

/**
 * THE TABLE HEADER THAT FOLLOWS THE PAGE — for `stickyToolbar`.
 *
 * `position: sticky` cannot do this job. A sticky cell sticks inside its
 * nearest scroll container, and the table's is its own wrapper: it scrolls
 * SIDEWAYS (`overflow-x: auto`, so a wide table is never squeezed), which
 * makes it a scroll container on both axes, and it never scrolls vertically —
 * the page does. So the header would stick to a box that never moves. Taking
 * the sideways scroll away to let it stick would trade one defect for another:
 * columns clipped or crushed on every narrow screen.
 *
 * Instead the header cells are TRANSLATED down by however far the page has
 * scrolled the table's top past the sticky toolbar's bottom edge, clamped so
 * the header never leaves its own table. The translation stays inside the
 * table's box, so the wrapper's overflow clips nothing.
 *
 * Driven by the page's scroll (any scroller: a capturing listener on `window`
 * hears every element's scroll event) and by resizes, one frame at a time.
 */
import { useEffect, type RefObject } from "react";

/** The attribute the shell root carries, so the head can find its own toolbar. */
export const SHELL_ATTR = "data-dv-shell";
/** The attribute the sticky toolbar carries. */
export const STICKY_BAR_ATTR = "data-dv-sticky-bar";
/** Spread on the shell root. */
export const SHELL_PROPS = { [SHELL_ATTR]: "" };

/** How far the header must move down to sit under `edge` (px), inside its table. */
export function headShift(tableTop: number, tableHeight: number, headHeight: number, edge: number): number {
  return Math.max(0, Math.min(edge - tableTop, tableHeight - headHeight));
}

/** The top edge the header slides under: the sticky toolbar's bottom, else the viewport's top. */
function stickyEdge(wrapper: HTMLElement): number {
  const bar = wrapper.closest(`[${SHELL_ATTR}]`)?.querySelector<HTMLElement>(`[${STICKY_BAR_ATTR}]`);
  return bar ? bar.getBoundingClientRect().bottom : 0;
}

/** The element whose scrolling moves the page under the bar: the nearest scrolling ancestor. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Stick the toolbar to the VISIBLE top of its scroll area.
 *
 * `top: 0` sticks to the scroll container's content edge, which sits inside
 * its padding: a main pane padded 24px held the bar 24px below the app bar,
 * with rows showing through the gap above it. The bar's `top` is therefore
 * the negative of that padding, read from the live layout (the shell does not
 * know which pane it is in, nor what padding the host gave it).
 */
export function useStickyBarTop(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const shell = ref.current;
    const bar = shell?.querySelector<HTMLElement>(`[${STICKY_BAR_ATTR}]`);
    if (!enabled || !shell || !bar) return undefined;
    const apply = (): void => {
      const parent = scrollParent(bar);
      // The host's own computed length, passed through — never one of ours.
      bar.style.top = parent ? `calc(-1 * ${getComputedStyle(parent).paddingTop})` : "";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [ref, enabled]);
}

/** Translate the header cells of the table inside `ref` so they follow the page. */
export function useStickyTableHead(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const wrapper = ref.current;
    if (!enabled || !wrapper) return undefined;
    let frame = 0;
    const apply = (): void => {
      frame = 0;
      const table = wrapper.querySelector("table");
      const head = table?.querySelector("thead");
      if (!table || !head) return;
      const box = table.getBoundingClientRect();
      const shift = headShift(box.top, box.height, head.getBoundingClientRect().height, stickyEdge(wrapper));
      // A measured offset, so a matrix rather than a design length.
      const transform = shift > 0 ? new DOMMatrixReadOnly().translate(0, shift).toString() : "";
      head.querySelectorAll<HTMLElement>("th").forEach((cell) => {
        cell.style.transform = transform;
        // Above the rows it now covers, below the toolbar (z-index 3).
        cell.style.zIndex = shift > 0 ? "2" : "";
      });
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(wrapper);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
}
