/**
 * The DataViews family's render, with its words already in scope.
 *
 * `useDataViewsCopy` throws outside a provider — deliberately, so a host that
 * forgets to configure the copy finds out at the first render rather than
 * shipping blank buttons. That makes every test here a host too. Rather than
 * repeat the wrapper in nineteen files, this is React Testing Library's own
 * custom-render pattern: re-export the library and override `render`, so a
 * test file changes its import and nothing else.
 */
import { render as rtlRender, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { JSX, ReactElement, ReactNode } from "react";

import { PT_BR_DATA_VIEWS_COPY } from "../../../../pt-BR";
import { DataViewsCopyProvider } from "../data-views-copy-context";

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <DataViewsCopyProvider copy={PT_BR_DATA_VIEWS_COPY}>{children}</DataViewsCopyProvider>;
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

export * from "@testing-library/react";
