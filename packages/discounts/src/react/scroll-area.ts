"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import type { RevealOptions } from "@12-apps/ui/utils";

/**
 * The dialog's scroll area, as the step form's sticky bars need it (FUT-4477):
 * where it is, how tall, its padding, its paint, and how much of it the bars
 * cover for a reveal. Measured, because the dialog is the library's to shape.
 */

/** The first ancestor (or the element) that paints a background, as it paints it. */
function surfaceOf(element: HTMLElement): ScrollArea["surface"] {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const painted = style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
    if (painted || style.backgroundImage !== "none") {
      return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
    }
  }
  return null;
}

/** The scroll area an element scrolls in, or null. */
function scrollAreaOf(element: HTMLElement | null): HTMLElement | null {
  let area = element?.parentElement ?? null;
  while (area && !["auto", "scroll"].includes(getComputedStyle(area).overflowY)) area = area.parentElement;
  return area;
}

/**
 * How much of the scroll area the sticky bars cover, from its top and from its
 * bottom: where they actually sit, the area's own padding included — a sticky
 * bar rests inside that padding, so its height alone fell short by it.
 */
export function useInsets(): { chrome: RefObject<HTMLDivElement | null>; bar: RefObject<HTMLDivElement | null>; insets: RevealOptions } {
  const chrome = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const covered = (from: "top" | "bottom"): number => {
    const element = from === "top" ? chrome.current : bar.current;
    const area = scrollAreaOf(element);
    if (!element || !area) return element?.offsetHeight ?? 0;
    const box = element.getBoundingClientRect();
    const frame = area.getBoundingClientRect();
    return from === "top" ? box.bottom - frame.top : frame.bottom - box.top;
  };
  return { chrome, bar, insets: { topInset: () => covered("top"), bottomInset: () => covered("bottom") } };
}

/**
 * The height of the scroll area the form sits in, less every padding between
 * the area's edges and the form: the form fills it, so the submit bar rests on
 * the dialog's bottom edge even when the steps are short (the prototype's
 * footer), and sticks there when they are not — with nothing left to scroll:
 * the chrome and the bar reach across those paddings with negative margins,
 * so they add no height.
 * Measured, because the dialog's own shape is the library's to decide: the
 * sheet pads its scroller, the wide modal pads a box inside it.
 */
interface ScrollArea {
  height: number | null;
  /**
   * The dialog surface's own paint (colour and, in a dark theme, the elevation
   * overlay), read off the first painted ancestor: the sticky bars wear it, so
   * they are the surface rather than a band of another shade over it.
   */
  surface: { backgroundColor: string; backgroundImage: string } | null;
  /** The space between the area's top edge and the form: the chrome reaches across it to the edge. */
  padTop: number;
  /** The space between the form and the area's bottom edge: the bar reaches across it to the edge. */
  padBottom: number;
  /**
   * The area's OWN top and bottom padding: a sticky offset counts from inside
   * it, so a bar that sticks at the very edge sticks at minus this.
   */
  ownTop: number;
  ownBottom: number;
}

const px = (value: string): number => parseFloat(value) || 0;

/** What one box between the form and the scroller adds above and below it. */
function boxGaps(style: CSSStyleDeclaration, own: boolean): { top: number; bottom: number } {
  const top = px(style.paddingTop) + (own ? 0 : px(style.borderTopWidth) + px(style.marginTop));
  const bottom = px(style.paddingBottom) + (own ? 0 : px(style.borderBottomWidth) + px(style.marginBottom));
  return { top, bottom };
}

/** The padding, borders and margins between `from` (exclusive) and the scroller (its padding only). */
function gapsBetween(from: HTMLElement, scroller: HTMLElement): { top: number; bottom: number; ownTop: number; ownBottom: number } {
  let top = 0;
  let bottom = 0;
  for (let node = from.parentElement; node && node !== scroller; node = node.parentElement) {
    const gaps = boxGaps(getComputedStyle(node), false);
    top += gaps.top;
    bottom += gaps.bottom;
  }
  const own = boxGaps(getComputedStyle(scroller), true);
  return { top: top + own.top, bottom: bottom + own.bottom, ownTop: own.top, ownBottom: own.bottom };
}

export function useScrollArea(root: RefObject<HTMLElement | null>): ScrollArea {
  const [area, setArea] = useState<ScrollArea>({ height: null, surface: null, padTop: 0, padBottom: 0, ownTop: 0, ownBottom: 0 });
  useEffect(() => {
    // No ResizeObserver, no layout to follow (a test DOM): nothing is walked.
    if (typeof ResizeObserver === "undefined") return undefined;
    const form = root.current;
    const area = scrollAreaOf(form);
    if (!form || !area) return undefined;
    const scroller = area;
    const measure = (): void => {
      const { top, bottom, ownTop, ownBottom } = gapsBetween(form, scroller);
      const inner = scroller.clientHeight - top - bottom;
      setArea({ height: inner > 0 ? inner : null, surface: surfaceOf(scroller), padTop: top, padBottom: bottom, ownTop, ownBottom });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    measure();
    return () => observer.disconnect();
  }, [root]);
  return area;
}

/** An element's height, kept current: the chrome grows with its pendências panel. */
export function useHeight(element: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const measure = (): void => setHeight(node.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [element]);
  return height;
}

/**
 * The chrome's block: pulled up across the space above the form to the area's
 * top edge, and sticky at that edge — so where it rests is where it sticks, it
 * never moves, and nothing scrolls by above it. A hairline under it.
 */
export function stickyTopSx(area: ScrollArea) {
  return {
    position: "sticky",
    top: -area.ownTop,
    mt: `${-area.padTop}px`,
    pt: 1,
    pb: 1,
    zIndex: 1,
    borderBottom: 1,
    borderColor: "divider",
    ...paintOf(area),
  } as const;
}

/** The dialog surface's paint for a sticky bar, or the paper colour until it is read. */
export function paintOf(area: { surface: ScrollArea["surface"] }): Record<string, string> {
  return area.surface ?? { bgcolor: "background.paper" };
}
