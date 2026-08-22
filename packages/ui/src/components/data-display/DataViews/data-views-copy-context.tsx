import { createContext, useContext, type JSX, type ReactNode } from "react";

import type { DataViewsCopy } from "./data-views-copy";

/**
 * The words this component family renders, put in scope once by the host.
 *
 * Context rather than a prop per component for the same reason
 * `data-views-layout-context` uses one: the nineteen files here are a single
 * surface mounted once, and threading words through leaves a host never names
 * is the prop-drilling context exists to avoid.
 */
const DataViewsCopyContext = createContext<DataViewsCopy | null>(null);

export function DataViewsCopyProvider({
  copy,
  children,
}: {
  copy: DataViewsCopy;
  children: ReactNode;
}): JSX.Element {
  return <DataViewsCopyContext.Provider value={copy}>{children}</DataViewsCopyContext.Provider>;
}

/**
 * The copy in scope.
 *
 * THROWS outside a provider rather than falling back. There is no meaningful
 * empty answer: a saved-views dialog with no words is broken, and any default
 * would be the origin host's Portuguese — which is the exact thing this config
 * exists to stop being silent. Failing at the first render names the wiring
 * mistake; blank buttons would hide it.
 */
export function useDataViewsCopy(): DataViewsCopy {
  const copy = useContext(DataViewsCopyContext);
  if (!copy) {
    throw new Error(
      "DataViews components must be rendered inside <DataViewsCopyProvider copy={…}>. " +
        "@12-apps/ui ships no default copy; pass PT_BR_DATA_VIEWS_COPY to keep the pt-BR wording.",
    );
  }
  return copy;
}
