/**
 * Which block the canvas has selected, and how it finds one on the page.
 *
 * Split out of `report-editor-canvas` when that file crossed the size gate.
 * The seam is the DOM: everything here is about locating and revealing an
 * element, and none of it knows what a report block contains.
 */
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { BLOCK_ID_ATTR } from "./report-editor-block";

export interface CanvasSelection {
  selectedId: string | null;
  /**
   * Opened by the FIRST selection and never closed again on the wide tiers:
   * deselecting leaves the panel docked showing its empty state, so the canvas
   * does not snap 344px wider and back between two clicks. Before the first
   * selection there is no panel at all, which is what lets the reflow be
   * observable ("I note the width of the canvas … the canvas width is reduced
   * by the width of the panel").
   */
  everOpened: boolean;
  select: (id: string) => void;
  deselect: () => void;
}

export function useCanvasSelection(): CanvasSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [everOpened, setEverOpened] = useState(false);

  return {
    selectedId,
    everOpened,
    select: (id) => {
      setSelectedId(id);
      setEverOpened(true);
    },
    deselect: () => setSelectedId(null),
  };
}

/**
 * Did this click land on the canvas BACKGROUND rather than on a block?
 *
 * Asked of the click's ORIGIN rather than of the wrapper, because the grid's
 * gaps and a block's own padding are both "not a block" and both bubble to the
 * same element. The panel is rendered outside this wrapper, so a click inside
 * the panel never reaches here at all — "clicking inside the panel never
 * deselects" is structural rather than a guard that can be forgotten.
 *
 * The containment test is NOT redundant with that. A block's menu and the
 * remove confirmation render into portals at `document.body`, and React
 * bubbles their clicks along the REACT tree regardless — so "Mover para cima"
 * and "Cancelar" arrive here with a target that is outside every block and
 * outside this element, and without the check each of them silently emptied
 * the panel on its way out. Found in Chromium; jsdom bubbles portals the same
 * way, but only a real menu makes it obvious.
 */
export function isBackgroundClick(event: ReactMouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (!event.currentTarget.contains(target)) return false;
  return target.closest(`[${BLOCK_ID_ATTR}]`) === null;
}

/** Find a block's element again — for focus, and for scrolling to it. */
export function blockElement(id: string | null): HTMLElement | null {
  if (id === null) return null;
  return document.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${id}"]`);
}

/**
 * Bring a just-created block to the author: focus it, and scroll it to the
 * middle of the viewport.
 *
 * Without the scroll, adding to a canvas already a screen tall appends the
 * block below the fold and nothing appears to have happened (`plan.md` entry
 * 18). `scrollIntoView` is called optionally because jsdom does not implement
 * it, and a test environment must not be the reason a feature is left out.
 */
export function revealBlock(id: string): void {
  const element = blockElement(id);
  if (element === null) return;
  element.focus();
  element.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

/** Everything the canvas can DO, so its render function only renders. */
