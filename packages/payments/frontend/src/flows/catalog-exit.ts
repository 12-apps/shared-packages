/**
 * ONE WAY OUT OF A CHECKOUT (FUT-1240).
 *
 * A checkout has two controls that leave it — the chrome's back link on the
 * first step, and "voltar ao cardápio" on the confirmation — and until this
 * existed they answered differently: back honoured a registered
 * {@link CheckoutExit} while the confirmation went straight to
 * `ports.exitToCatalog`. So a host that registered its router's own catalog
 * route got it from one control and a full page navigation from the other,
 * with the difference visible only to the shopper who pressed the second one.
 *
 * `exit` is a FACTORY-scope constant, so calling its `useCatalog()` here is a
 * hook call whose presence never changes between renders.
 */
import { useCallback } from "react";

import type { FlowsRuntime } from "./runtime";

/**
 * Leave for the host's catalog, through whichever door it registered.
 *
 * `exit` wins when there is one — it is the host's own router, and a router
 * navigation keeps the SPA alive. `ports.exitToCatalog` is the fallback every
 * host already wires, and stays the answer for a host that registered nothing.
 */
export function useCatalogExit(runtime: FlowsRuntime): () => void {
  const exit = runtime.config.exit;
  const catalog = exit?.useCatalog();
  return useCallback(() => {
    if (exit && catalog) exit.navigate(catalog.to);
    else runtime.config.ports.exitToCatalog();
  }, [exit, catalog, runtime]);
}
