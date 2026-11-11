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
 * The height of the scroll area the form sits in, less its padding: the form
 * fills it, so the submit bar rests on the dialog's bottom edge even when the
 * steps are short (the prototype's footer), and sticks there when they are not.
 * Measured, because the dialog's own height is the library's to decide.
 */
export interface ScrollArea {
  height: number | null;
  /**
   * The dialog surface's own paint (colour and, in a dark theme, the elevation
   * overlay), read off the first painted ancestor: the sticky bars wear it, so
   * they are the surface rather than a band of another shade over it.
   */
  surface: { backgroundColor: string; backgroundImage: string } | null;
  /** The area's own padding: the sticky bars reach across it, so nothing scrolls by in the gap. */
  padTop: number;
  padBottom: number;
}

export function useScrollArea(root: RefObject<HTMLElement | null>): ScrollArea {
  const [area, setArea] = useState<ScrollArea>({ height: null, surface: null, padTop: 0, padBottom: 0 });
  useEffect(() => {
    const area = scrollAreaOf(root.current);
    if (!area || typeof ResizeObserver === "undefined") return undefined;
    const scroller = area;
    const measure = (): void => {
      const style = getComputedStyle(scroller);
      const padTop = parseFloat(style.paddingTop) || 0;
      const padBottom = parseFloat(style.paddingBottom) || 0;
      const inner = scroller.clientHeight - padTop - padBottom;
      setArea({ height: inner > 0 ? inner : null, surface: surfaceOf(scroller), padTop, padBottom });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    measure();
    return () => observer.disconnect();
  }, [root]);
  return area;
}

/** The chrome's block: sticky at the top, reaching across the scroll area's top padding. */
export function stickyTopSx(area: ScrollArea) {
  const { padTop } = area;
  return { position: "sticky", top: -padTop, mt: `${-padTop}px`, pt: `${padTop}px`, pb: 1.5, zIndex: 1, ...paintOf(area) } as const;
}

/** The dialog surface's paint for a sticky bar, or the paper colour until it is read. */
export function paintOf(area: { surface: ScrollArea["surface"] }): Record<string, string> {
  return area.surface ?? { bgcolor: "background.paper" };
}
