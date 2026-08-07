/**
 * The factory's shared runtime (FUT-741): the fetched store protocol, and the
 * providers that stop every nested screen re-fetching it.
 *
 * Two layers, on purpose:
 *
 *   - {@link FlowsShell} supplies the things a screen cannot work WITHOUT —
 *     the design-system slots, the bound transport, the navigate port. Every
 *     returned screen wraps itself in one, which is what makes "every
 *     `screens.*` member already works standalone" true rather than
 *     aspirational. Re-supplying them under a `Provider` is a no-op.
 *   - {@link FlowsProvider} adds the one thing that is worth NOT repeating: the
 *     fetched `/config`. A screen under it reads that answer; a screen standing
 *     alone fetches its own.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { CheckoutClientProvider } from "../components/checkout/client-context";
import { CheckoutNavigateProvider } from "../components/checkout/navigate-context";
import type { CheckoutClient } from "../components/checkout/transport";
import type { CheckoutProviderConfig } from "../components/checkout/types";
import { CheckoutComponentsProvider } from "../components/checkout/ui";

import type { CheckoutCopyFE } from "./copy";
import type { CheckoutAvailability, CheckoutConfigState, PaymentFlowsConfig } from "./types";

/** Supplied by a `Provider`; `null` means "nobody above me fetched it". */
const FetchedConfigContext = createContext<CheckoutConfigState | null>(null);

/** Everything one factory hands the screens it built. */
export interface FlowsRuntime {
  config: PaymentFlowsConfig;
  client: CheckoutClient;
  copy: CheckoutCopyFE;
  navigate: (url: string) => void;
  /** The store slug for THIS render — read from the host's hook, never frozen. */
  useTenantSlug(): string | undefined;
  /** The host's availability vote for THIS render. Defaults to "payable". */
  useAvailability(): CheckoutAvailability;
}

/**
 * Fetch the store protocol for one slug.
 *
 * A failure is NOT retried into a loop and NOT surfaced as an error state: the
 * config read fails OPEN for the UI (`null` renders both method tiles) and the
 * server still fails the charge CLOSED. Nothing about a blip here may hide a
 * working checkout, and nothing about it may invent permission to mock.
 */
function useFetchedConfig(
  runtime: FlowsRuntime,
  enabled: boolean,
): CheckoutConfigState {
  const { client } = runtime;
  const onWarning = runtime.config.onWarning;
  const tenantSlug = runtime.useTenantSlug();
  const [state, setState] = useState<CheckoutConfigState>({ config: null, pending: enabled });

  useEffect(() => {
    if (!enabled || !tenantSlug) {
      setState({ config: null, pending: false });
      return undefined;
    }
    let active = true;
    setState({ config: null, pending: true });
    void client.getConfig(tenantSlug).then((result) => {
      if (!active) return;
      if (!result.ok) {
        // Reported, never logged: a `console.error` in a buyer's browser tells
        // nobody. Silent by default is the honest alternative.
        onWarning?.("checkout config read failed", { tenantSlug, error: result.error });
        setState({ config: null, pending: false });
        return;
      }
      setState({ config: result.data, pending: false });
    });
    return () => {
      active = false;
    };
  }, [client, tenantSlug, enabled, onWarning]);

  return state;
}

/**
 * The store protocol, from the nearest `Provider` or fetched here.
 *
 * Both branches always run their hooks; the self-fetch is merely disabled when
 * somebody above already has the answer, which keeps the rule of hooks honest.
 */
export function useResolvedConfig(runtime: FlowsRuntime): CheckoutConfigState {
  const provided = useContext(FetchedConfigContext);
  const own = useFetchedConfig(runtime, provided === null);
  return provided ?? own;
}

/** Slots, transport and the navigate port — what a screen cannot work without. */
export function FlowsShell({
  runtime,
  children,
}: {
  runtime: FlowsRuntime;
  children: ReactNode;
}): JSX.Element {
  return (
    <CheckoutComponentsProvider components={runtime.config.components}>
      <CheckoutClientProvider client={runtime.client}>
        <CheckoutNavigateProvider navigate={runtime.navigate}>{children}</CheckoutNavigateProvider>
      </CheckoutClientProvider>
    </CheckoutComponentsProvider>
  );
}

/**
 * The shell plus the fetched `/config`, supplied once for a host that nests
 * individual screens in its own layout.
 *
 * A host that passes its own `config` skips the fetch entirely — that is the
 * seam a story, a harness page or a server-rendered host uses to STATE the
 * protocol rather than round-trip for it.
 */
export function FlowsProvider({
  runtime,
  config,
  children,
}: {
  runtime: FlowsRuntime;
  config?: CheckoutProviderConfig | null;
  children: ReactNode;
}): JSX.Element {
  const fetched = useFetchedConfig(runtime, config === undefined);
  const value = useMemo<CheckoutConfigState>(
    () => (config === undefined ? fetched : { config, pending: false }),
    [config, fetched],
  );
  return (
    <FlowsShell runtime={runtime}>
      <FetchedConfigContext.Provider value={value}>{children}</FetchedConfigContext.Provider>
    </FlowsShell>
  );
}
