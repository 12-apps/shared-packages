"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The element's own width as it changes; `null` until measured, or where
 * nothing can measure.
 *
 * What the form measures is ITS width, never the window's: it also lives in a
 * dialog narrower than the screen (FUT-4157). The Tipo cards (`./tipo-cards`),
 * the combo reward's toggle-or-select and the side column all read it. The
 * kind's own toggle-or-select that lived here was replaced by the Tipo cards
 * (FUT-4477).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
