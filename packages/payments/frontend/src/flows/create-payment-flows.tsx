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
import { useCallback, type JSX, type ReactNode } from "react";

import { buyerFieldsFor } from "../components/checkout/buyer-fields";
import { CheckoutFlow } from "../components/checkout/checkout-flow";
import { createCheckoutClient } from "../components/checkout/transport";
import type { CheckoutProviderConfig, SettlementCheckout } from "../components/checkout/types";
import { useCheckoutController } from "../components/checkout/use-checkout-controller";

import { FlowsProvider, useResolvedConfig, type FlowsRuntime } from "./runtime";
import { buyerScreens } from "./screens-buyer";
import { hostedScreens } from "./screens-hosted";
import { payScreens, storeCannotCharge } from "./screens-pay";
import { vaultScreens } from "./screens-vault";
import type {
  CheckoutAvailability,
  CheckoutController,
  CheckoutScreens,
  PaymentFlows,
  PaymentFlowsConfig,
} from "./types";

/** A store that is always payable — what a host with no veto to cast means. */
const ALWAYS_PAYABLE: CheckoutAvailability = { payable: true };

/** Build the runtime every screen closes over. */
function buildRuntime(config: PaymentFlowsConfig): FlowsRuntime {
  // The transport's own failure sentences come from the SAME copy pack the
  // screens read (FUT-760), so a host answers the question once. A `transport`
  // that names its own `copy` still wins — a second mount may talk to a
  // different surface with a different voice.
  const client = createCheckoutClient({
    copy: config.copy.views.screens.screens.transport,
    ...config.transport,
  });
  const navigate =
    config.ports.navigate ??
    ((url: string) => {
      window.location.assign(url);
    });
  return {
    config,
    client,
    copy: config.copy,
    navigate,
    // Both of these are HOOKS. They are called from a component body on every
    // render, so the slug follows the host's router and the availability vote
    // follows whatever the host currently knows.
    useTenantSlug: () => config.useScope?.().tenantSlug,
    useAvailability: () => config.ports.useAvailability?.() ?? ALWAYS_PAYABLE,
  };
}

/** The whole three-step flow, with the config fetched and availability decided. */
function buildCheckout(
  runtime: FlowsRuntime,
  screens: CheckoutScreens,
): PaymentFlows["Checkout"] {
  const { ports } = runtime.config;
  const Unavailable = screens.PaymentsUnavailable;

  function CheckoutBody({ settlement }: { settlement?: SettlementCheckout | null }): JSX.Element {
    const cart = runtime.config.useCart();
    const defaults = runtime.config.useBuyerDefaults?.() ?? {};
    const hostSettlement = runtime.config.useSettlement?.() ?? null;
    const { config, pending } = useResolvedConfig(runtime);
    const availability = runtime.useAvailability();
    const tenantSlug = runtime.useTenantSlug();
    // Adapts the port to the package's older, prop-shaped contract. Memoised so
    // the controller does not see a fresh `createOrder` identity each render.
    const createOrder = useCallback(
      (input: Parameters<typeof ports.createPayable>[0]) => ports.createPayable(input),
      [],
    );

    if (storeCannotCharge(config, pending, availability.payable)) return <Unavailable />;

    return (
      <CheckoutFlow
        copy={runtime.copy.views}
        cart={cart}
        createOrder={createOrder}
        saveBuyerContact={ports.saveBuyerContact}
        onExitToMenu={ports.exitToCatalog}
        onPaid={ports.onPaid}
        defaultBuyer={defaults.buyer}
        taxIdOnFile={defaults.taxIdOnFile ?? false}
        settlement={settlement ?? hostSettlement}
        providerConfig={config}
        tenantSlug={tenantSlug}
        confirmationExtra={runtime.config.confirmation?.extra}
        validateApplePayMerchant={ports.validateApplePayMerchant}
      />
    );
  }

  return function Checkout(props) {
    // Its OWN provider, so the one-line mount really is one line: `/config` is
    // fetched here and every nested screen reads that answer.
    //
    // The design-system slots come from the `FlowsShell` inside it, and the
    // `CheckoutComponentsProvider` that `CheckoutFlow` opens one level down
    // INHERITS them (see `ui.tsx`) rather than resetting to raw MUI — which is
    // why nothing here re-threads `components`.
    return (
      <FlowsProvider runtime={runtime}>
        <CheckoutBody {...props} />
      </FlowsProvider>
    );
  };
}

/** Assemble the thirteen screens from their builders. */
function buildScreens(runtime: FlowsRuntime): CheckoutScreens {
  return {
    MethodChoice: buyerScreens.buildMethodChoice(runtime),
    BuyerDetails: buyerScreens.buildBuyerDetails(runtime),
    CardEntry: payScreens.buildCardEntry(runtime),
    PixPayment: payScreens.buildPixPayment(runtime),
    HostedHandoff: hostedScreens.buildHostedHandoff(runtime),
    HostedReturn: hostedScreens.buildHostedReturn(runtime),
    PaymentStatus: payScreens.buildPaymentStatus(runtime),
    PaymentsUnavailable: payScreens.buildPaymentsUnavailable(runtime),
    PayerSummary: buyerScreens.buildPayerSummary(runtime),
    SavedCards: buyerScreens.buildSavedCards(runtime),
    EmptyCart: buyerScreens.buildEmptyCart(runtime),
    AddCard: vaultScreens.buildAddCard(runtime),
    ManageCards: vaultScreens.buildManageCards(runtime),
  };
}

/** The flow controller, pre-bound to the ports and the chain's declaration. */
function buildUseCheckout(runtime: FlowsRuntime): () => CheckoutController {
  const { ports } = runtime.config;
  return function useCheckout(): CheckoutController {
    const { config } = useResolvedConfig(runtime);
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
      defaults.taxIdOnFile ?? false,
      // Resolved for NO method: the gate runs on the Dados step, before the
      // picker, and FUT-595's rule is to collect the union up front.
      buyerFieldsFor(config?.chain, null),
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
