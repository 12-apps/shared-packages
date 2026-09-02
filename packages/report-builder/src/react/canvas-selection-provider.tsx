/**
 * Holds the canvas selection ABOVE the routes, so a route change in the middle
 * of an edit cannot take the author's panel away.
 *
 * Its own file because `report-editor-selection.ts` is JSX-free and the rest of
 * it is DOM lookup helpers; the reason this exists is in the docblock beside
 * `SelectionContext` there.
 */
import { useState } from "react";
import type { JSX, ReactNode } from "react";

import { SelectionContext, type SelectionState } from "./report-editor-selection";

export function CanvasSelectionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<SelectionState>({
    selectedId: null,
    everOpened: false,
    sessionId: null,
  });
  return (
    <SelectionContext.Provider value={{ state, setState }}>{children}</SelectionContext.Provider>
  );
}
