/**
 * Which block the canvas has selected, and how it finds one on the page.
 *
 * Split out of `report-editor-canvas` when that file crossed the size gate.
 * The seam is the DOM: everything here is about locating and revealing an
 * element, and none of it knows what a report block contains.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";

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

/**
 * The selection, held ABOVE the routes.
 *
 * It has to outlive a route change, because one happens in the middle of an
 * edit and nobody asked for it: autosaving a report that has never been saved
 * CREATES it, and `afterCreate` then navigates `/reports/new` →
 * `/reports/:id/edit` so the URL names the new row. That is a different route,
 * so the editor page unmounts — and with this state inside it, `everOpened`
 * went back to false and the canvas rendered NO panel at all. Not the empty
 * state: nothing. The author's block editor vanished mid-edit, at a moment the
 * autosave timer chose rather than they did.
 *
 * A provider is what survives that, because the remount happens BELOW it. The
 * store is per builder surface, and `useCanvasSelection` scopes it to one
 * report — see the session rule there.
 */
export interface SelectionState {
  selectedId: string | null;
  everOpened: boolean;
  sessionId: string | null;
}

export interface SelectionStore {
  state: SelectionState;
  setState: Dispatch<SetStateAction<SelectionState>>;
}

export const SelectionContext = createContext<SelectionStore | null>(null);

/**
 * `sessionId` is the report being edited — `undefined` while it has never been
 * saved. The rule is deliberately asymmetric:
 *
 *  - `undefined` → an id ADOPTS the session. That is the create above: the same
 *    report the author has been building all along, finally given a row.
 *  - one id → a DIFFERENT id resets. That is opening another report, where
 *    carrying a selection over would point the panel at a block id that merely
 *    happens to collide (`bloco-1` exists in every report).
 */
export function useCanvasSelection(sessionId?: string): CanvasSelection {
  const store = useContext(SelectionContext);
  const local = useState<SelectionState>({
    selectedId: null,
    everOpened: false,
    sessionId: null,
  });
  const state = store ? store.state : local[0];
  const setState = store ? store.setState : local[1];

  const current = sessionId ?? null;
  const stale = state.sessionId !== null && current !== null && state.sessionId !== current;
  const unclaimed = state.sessionId === null && current !== null;

  // Updater form throughout: a `select()` can land between this render and the
  // effect, and writing a value captured at render would throw it away.
  useEffect(() => {
    if (stale) setState({ selectedId: null, everOpened: false, sessionId: current });
    else if (unclaimed) {
      setState((prev) => (prev.sessionId === null ? { ...prev, sessionId: current } : prev));
    }
  }, [stale, unclaimed, current, setState]);

  // Read through the reset in the same render that detects it, so one frame of
  // the previous report's panel cannot be shown against the new one.
  const view = stale ? { selectedId: null, everOpened: false } : state;

  return {
    selectedId: view.selectedId,
    everOpened: view.everOpened,
    select: (id) => setState({ selectedId: id, everOpened: true, sessionId: current }),
    deselect: () =>
      setState({ selectedId: null, everOpened: view.everOpened, sessionId: current }),
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
