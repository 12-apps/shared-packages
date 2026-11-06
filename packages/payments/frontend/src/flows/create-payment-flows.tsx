/**
 * `createPaymentFlows` — the buyer checkout, mounted rather than composed
 * (FUT-741).
 *
 * Called ONCE at module scope; the host mounts what comes back. See
 * `./types.ts` for the config vocabulary and why none of it names a vendor.
 *
 * ## Why the scope arrives as HOOKS
 *
 * `useScope`, `useCart`, `useBuyerDefaults`, `useSettlement` and
 * `ports.useAvailability` are hooks, not values, and they are invoked in a
 * component BODY — never read at factory time. The factory runs once, at module
 * evaluation, so a value-shaped config would freeze the first store's slug and
 * one moment's cart total onto every checkout the page ever renders. Naming
 * them `use*` also keeps rules-of-hooks lint able to see them.
 */
import type { JSX, ReactNode } from "react";

import { CheckoutFlow } from "../components/checkout/checkout-flow";
import { createCheckoutClient } from "../components/checkout/transport";
import type { CheckoutProviderConfig, SettlementCheckout } from "../components/checkout/types";
import { useCheckoutController } from "../components/checkout/use-checkout-controller";

import {
  FlowsProvider,
  useFlowConfirmation,
  useFlowCopy,
  useFlowPorts,
  useResolvedConfig,
  type FlowsRuntime,
} from "./runtime";
import { buyerScreens } from "./screens-buyer";
import { hostedScreens } from "./screens-hosted";
import { payScreens, storeCannotCharge } from "./screens-pay";
import { vaultScreens } from "./screens-vault";
import type {
  CheckoutAvailability,
  CheckoutConfirmation,
  CheckoutController,
  CheckoutPorts,
  CheckoutScreens,
  PaymentFlows,
  PaymentFlowsConfig,
} from "./types";

/** A store that is always payable — what a host with no veto to cast means. */
const ALWAYS_PAYABLE: CheckoutAvailability = { payable: true };

/**
 * The host's ports as a hook: `usePorts` when it gave one, else the fixed
 * `ports`. One of the two is required, and saying so at build time beats a
 * checkout that throws on the buyer's first tap.
 */
function hostPortsHook(config: PaymentFlowsConfig): () => CheckoutPorts {
  if (config.usePorts) return config.usePorts;
  const fixed = config.ports;
  if (!fixed) throw new Error("createPaymentFlows: pass `ports` or `usePorts` — the flow has no host to raise a payable through.");
  return () => fixed;
}

/** Build the runtime every screen closes over. */
function buildRuntime(config: PaymentFlowsConfig): FlowsRuntime {
  const useHostPorts = hostPortsHook(config);
  // The transport's own failure sentences come from the SAME copy pack the
  // screens read (FUT-760), so a host answers the question once. A `transport`
  // that names its own `copy` still wins — a second mount may talk to a
  // different surface with a different voice.
  const client = createCheckoutClient({
    copy: config.copy.views.screens.screens.transport,
    ...config.transport,
  });
  return {
    config,
    client,
    copy: config.copy,
    useHostPorts,
    // Both of these are HOOKS. They are called from a component body on every
    // render, so the slug follows the host's router and the availability vote
    // follows whatever the host currently knows.
    useTenantSlug: () => config.useScope?.().tenantSlug,
    useAvailability: () => useHostPorts().useAvailability?.() ?? ALWAYS_PAYABLE,
  };
}

/** The host's confirmation slots, as `CheckoutFlow` takes them. */
function confirmationProps(confirmation: CheckoutConfirmation | undefined) {
  return {
    confirmationExtra: confirmation?.extra,
    confirmationHero: confirmation?.hero,
    confirmationFooter: confirmation?.footer,
    backActionEmphasis: confirmation?.backActionEmphasis,
  };
}

/** The buyer's saved details, as `CheckoutFlow` takes them. */
function buyerProps(defaults: ReturnType<NonNullable<PaymentFlowsConfig["useBuyerDefaults"]>>) {
  return {
    defaultBuyer: defaults.buyer,
    taxIdOnFile: defaults.taxIdOnFile ?? false,
    taxIdKindOnFile: defaults.taxIdKindOnFile ?? null,
  };
}

/**
 * The host's one-list Pagamento (FUT-3591) — a hook, read every render. There
 * is no other Pagamento (FUT-4028), so a host that mounts `Checkout` without
 * one is told so here rather than handed a checkout with nothing to pay with.
 */
function useHostPaymentList(runtime: FlowsRuntime) {
  const usePaymentList = runtime.config.usePaymentList;
  if (!usePaymentList) {
    throw new Error(
      "createPaymentFlows: `Checkout` needs `usePaymentList` — the payment step is the one payment list (FUT-4028).",
    );
  }
  return usePaymentList();
}

/** The whole flow — the one list, then the confirmation — with the config fetched and availability decided. */
function buildCheckout(
  runtime: FlowsRuntime,
  screens: CheckoutScreens,
): PaymentFlows["Checkout"] {
  const Unavailable = screens.PaymentsUnavailable;

  function CheckoutBody({ settlement }: { settlement?: SettlementCheckout | null }): JSX.Element {
    const cart = runtime.config.useCart();
    const defaults = runtime.config.useBuyerDefaults?.() ?? {};
    const hostSettlement = runtime.config.useSettlement?.() ?? null;
    const paymentList = useHostPaymentList(runtime);
    const { config, pending } = useResolvedConfig(runtime);
    const availability = runtime.useAvailability();
    const tenantSlug = runtime.useTenantSlug();
    // Stable across renders (see `useFlowPorts`), so the controller does not
    // see a fresh `createOrder` identity each render.
    const ports = useFlowPorts(runtime);
    const copy = useFlowCopy(runtime);
    const confirmation = useFlowConfirmation(runtime);

    // The host's in-person rows are a way to pay that no provider serves, so an
    // empty chain refuses only a list with nothing else on it (FUT-1241).
    if (storeCannotCharge(config, pending, availability.payable, paymentList.door?.length ?? 0)) {
      return <Unavailable />;
    }

    return (
      <CheckoutFlow
        copy={copy.views}
        cart={cart}
        createOrder={ports.createPayable}
        saveBuyerContact={ports.saveBuyerContact}
        onExitToMenu={ports.exitToCatalog}
        onPaid={ports.onPaid}
        {...buyerProps(defaults)}
        settlement={settlement ?? hostSettlement}
        providerConfig={config}
        tenantSlug={tenantSlug}
        {...confirmationProps(confirmation)}
        validateApplePayMerchant={ports.validateApplePayMerchant}
        paymentList={paymentList}
      />
    );
  }

  return function Checkout(props) {
    // The host's own provider answer, when it holds one: then nothing is
    // fetched here, and the host's answer is the one the list draws.
    const hostConfig = runtime.config.useProviderConfig?.();
    // Its OWN provider, so the one-line mount really is one line: `/config` is
    // fetched here — unless the host answered above — and every nested screen
    // reads that answer.
    //
    // The design-system slots come from the `FlowsShell` inside it, and the
    // `CheckoutComponentsProvider` that `CheckoutFlow` opens one level down
    // INHERITS them (see `ui.tsx`) rather than resetting to raw MUI — which is
    // why nothing here re-threads `components`.
    return (
      <FlowsProvider runtime={runtime} state={hostConfig}>
        <CheckoutBody {...props} />
      </FlowsProvider>
    );
  };
}

/** Assemble the screens from their builders. */
function buildScreens(runtime: FlowsRuntime): CheckoutScreens {
  return {
    CardEntry: payScreens.buildCardEntry(runtime),
    PixPayment: payScreens.buildPixPayment(runtime),
    HostedHandoff: hostedScreens.buildHostedHandoff(runtime),
    HostedReturn: hostedScreens.buildHostedReturn(runtime),
    PaymentStatus: payScreens.buildPaymentStatus(runtime),
    PaymentsUnavailable: payScreens.buildPaymentsUnavailable(runtime),
    SavedCards: buyerScreens.buildSavedCards(runtime),
    EmptyCart: buyerScreens.buildEmptyCart(runtime),
    AddCard: vaultScreens.buildAddCard(runtime),
    ManageCards: vaultScreens.buildManageCards(runtime),
  };
}

/** The flow controller, pre-bound to the ports. */
function buildUseCheckout(runtime: FlowsRuntime): () => CheckoutController {
  return function useCheckout(): CheckoutController {
    const ports = useFlowPorts(runtime);
    const defaults = runtime.config.useBuyerDefaults?.() ?? {};
    const cart = runtime.config.useCart();
    const scope = { tenantSlug: runtime.useTenantSlug() };
    return useCheckoutController(
      {
        createOrder: ports.createPayable,
        saveBuyerContact: ports.saveBuyerContact,
        onExitToMenu: ports.exitToCatalog,
        onPaid: ports.onPaid,
      },
      defaults.buyer,
      scope.tenantSlug,
      // WHICH basket, so a payment raised from another one cannot resume itself
      // over it (FUT-1213). The host answers on its cart view; a host that does
      // not gets the pre-1213 behaviour.
      cart.identity,
    );
  };
}

/**
 * The buyer checkout, pre-bound.
 *
 * ```ts
 * export const components = createPaymentFlows({ useCart, ports: { … } });
 * // …and in the page:  <components.Checkout />
 * ```
 *
 * The flat exports (`CheckoutFlow`, the hooks, the fetch clients) are
 * unchanged and remain the escape hatch for a host that wants its own
 * composition — nothing here replaces them.
 */
export function createPaymentFlows(config: PaymentFlowsConfig): PaymentFlows {
  const runtime = buildRuntime(config);
  const screens = buildScreens(runtime);

  function Provider({
    children,
    config: provided,
  }: {
    children: ReactNode;
    config?: CheckoutProviderConfig | null;
  }): JSX.Element {
    return (
      <FlowsProvider runtime={runtime} config={provided}>
        {children}
      </FlowsProvider>
    );
  }


  return {
    Checkout: buildCheckout(runtime, screens),
    Provider,
    screens,
    useCheckout: buildUseCheckout(runtime),
    useCheckoutConfig: () => useResolvedConfig(runtime),
    client: runtime.client,
  };
}
