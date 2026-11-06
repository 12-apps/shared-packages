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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { CheckoutClientProvider } from "../components/checkout/client-context";
import { CheckoutNavigateProvider } from "../components/checkout/navigate-context";
import { createCheckoutClient, type CheckoutClient } from "../components/checkout/transport";
import type { CheckoutProviderConfig } from "../components/checkout/types";
import { CheckoutCopyProvider } from "../components/checkout/copy-context";
import { CheckoutComponentsProvider } from "../components/checkout/ui";

import type { CheckoutCopyFE } from "./copy";
import type {
  CheckoutAvailability,
  CheckoutConfigState,
  CheckoutConfirmation,
  CheckoutPorts,
  PaymentFlowsConfig,
} from "./types";

/** Supplied by a `Provider`; `null` means "nobody above me fetched it". */
const FetchedConfigContext = createContext<CheckoutConfigState | null>(null);

/** Everything one factory hands the screens it built. */
export interface FlowsRuntime {
  config: PaymentFlowsConfig;
  client: CheckoutClient;
  copy: CheckoutCopyFE;
  /** The host's ports for THIS render — `usePorts`, else the static `ports`. */
  useHostPorts(): CheckoutPorts;
  /** The store slug for THIS render — read from the host's hook, never frozen. */
  useTenantSlug(): string | undefined;
  /** The host's availability vote for THIS render. Defaults to "payable". */
  useAvailability(): CheckoutAvailability;
}

/** The copy for THIS render: the host's `useCopy`, else the `copy` it built the flow with. */
export function useFlowCopy(runtime: FlowsRuntime): CheckoutCopyFE {
  return runtime.config.useCopy?.() ?? runtime.copy;
}

/**
 * The transport for THIS render: the one built with the flow, unless the host
 * answers its copy per render (`useCopy`) — then the failure sentences follow
 * that copy too, so a buyer reading English is not told "Não foi possível
 * conectar…" (FUT-1241). Memoised on the transport copy, so the client keeps
 * its identity while the words do; a `transport` that names its own `copy`
 * still wins, as it does when the flow is built.
 */
export function useFlowClient(runtime: FlowsRuntime): CheckoutClient {
  const transportCopy = useFlowCopy(runtime).views.screens.screens.transport;
  const { transport, useCopy } = runtime.config;
  const follows = useCopy !== undefined && transport?.copy === undefined;
  const built = runtime.copy.views.screens.screens.transport;
  return useMemo(
    () => (follows && transportCopy !== built ? createCheckoutClient({ ...transport, copy: transportCopy }) : runtime.client),
    [follows, transportCopy, built, transport, runtime.client],
  );
}

/** The paid screen's host half for THIS render: `useConfirmation`, else `confirmation`. */
export function useFlowConfirmation(runtime: FlowsRuntime): CheckoutConfirmation | undefined {
  return runtime.config.useConfirmation ? runtime.config.useConfirmation() : runtime.config.confirmation;
}

/** Where a hand-off leaves for: the host's `navigate` port, else a page load. */
function assignLocation(url: string): void {
  window.location.assign(url);
}

/**
 * The host's ports, with identities that hold across renders.
 *
 * Each returned function calls the port the host returned on its LAST render,
 * so a host on `usePorts` hands over functions that close over its current
 * state and the flow's controller still sees one `createOrder` for its whole
 * life — no host-side ref, and no effect restarted by a new identity. An
 * optional port the host left out stays `undefined`, because the flow reads
 * absence as a fact (no Apple Pay without a merchant-validation port).
 */
export function useFlowPorts(runtime: FlowsRuntime): Omit<CheckoutPorts, "useAvailability"> & {
  navigate(url: string): void;
} {
  const current = runtime.useHostPorts();
  const latest = useRef(current);
  // Committed before any effect or handler can call through it.
  useLayoutEffect(() => {
    latest.current = current;
  });
  const hasSave = current.saveBuyerContact !== undefined;
  const hasPaid = current.onPaid !== undefined;
  const hasApple = current.validateApplePayMerchant !== undefined;
  return useMemo(
    () => ({
      createPayable: (input) => latest.current.createPayable(input),
      exitToCatalog: () => latest.current.exitToCatalog(),
      navigate: (url) => (latest.current.navigate ?? assignLocation)(url),
      saveBuyerContact: hasSave ? (contact) => latest.current.saveBuyerContact?.(contact) : undefined,
      onPaid: hasPaid ? () => latest.current.onPaid?.() : undefined,
      validateApplePayMerchant: hasApple
        ? (validationURL) => {
            const validate = latest.current.validateApplePayMerchant;
            return validate ? validate(validationURL) : Promise.reject(new Error("no merchant validation port"));
          }
        : undefined,
    }),
    [hasSave, hasPaid, hasApple],
  );
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
  const client = useFlowClient(runtime);
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

/** Slots, WORDS, transport and the navigate port — what a screen cannot work without. */
export function FlowsShell({
  runtime,
  children,
}: {
  runtime: FlowsRuntime;
  children: ReactNode;
}): JSX.Element {
  const copy = useFlowCopy(runtime);
  const client = useFlowClient(runtime);
  const { navigate } = useFlowPorts(runtime);
  return (
    <CheckoutComponentsProvider components={runtime.config.components}>
      {/* The factory's STANDALONE screens (add-card, manage-cards) render the
          same card fields the checkout does, so they need the same words —
          and they are mounted here rather than under `CheckoutFlow`. */}
      <CheckoutCopyProvider copy={copy.views.screens}>
        <CheckoutClientProvider client={client}>
          <CheckoutNavigateProvider navigate={navigate}>
            {children}
          </CheckoutNavigateProvider>
        </CheckoutClientProvider>
      </CheckoutCopyProvider>
    </CheckoutComponentsProvider>
  );
}

/**
 * The shell plus the fetched `/config`, supplied once for a host that nests
 * individual screens in its own layout.
 *
 * A host that passes its own `config` skips the fetch entirely — that is the
 * seam a story, a harness page or a server-rendered host uses to STATE the
 * protocol rather than round-trip for it. `state` is the same seam with the
 * in-flight flag kept: what `useProviderConfig` answers (FUT-1241).
 */
export function FlowsProvider({
  runtime,
  config,
  state,
  children,
}: {
  runtime: FlowsRuntime;
  config?: CheckoutProviderConfig | null;
  state?: CheckoutConfigState;
  children: ReactNode;
}): JSX.Element {
  const hasState = state !== undefined;
  const fetched = useFetchedConfig(runtime, !hasState && config === undefined);
  // `state` is read through its two fields, so a host returning a fresh object
  // each render does not hand every screen a new context value.
  const statedConfig = state?.config ?? null;
  const statedPending = state?.pending ?? false;
  const value = useMemo<CheckoutConfigState>(() => {
    if (hasState) return { config: statedConfig, pending: statedPending };
    return config === undefined ? fetched : { config, pending: false };
  }, [hasState, statedConfig, statedPending, config, fetched]);
  return (
    <FlowsShell runtime={runtime}>
      <FetchedConfigContext.Provider value={value}>{children}</FetchedConfigContext.Provider>
    </FlowsShell>
  );
}
