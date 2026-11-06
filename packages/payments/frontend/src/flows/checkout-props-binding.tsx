/**
 * `createCheckoutPropsBinding` — the factory, bound over the props a host
 * already hands `<CheckoutFlow>` (FUT-1241).
 *
 * A host that composes the flow by hand has ONE object of props per render:
 * the cart, the buyer's defaults, the settlement, the one list, the provider
 * answer, the copy, the confirmation and the ports. Moving such a host onto
 * `createPaymentFlows` one lane at a time means the hand mount and the packaged
 * one must read that same object, or the two lanes drift apart.
 *
 * So this is the adapter, once, here: every per-render hook of
 * {@link PaymentFlowsConfig} answers from the props `mount` was given — the
 * per-render copy, confirmation and ports, the forwarded document kind, and
 * the host's provider answer (no second `/config` read) — and the host keeps
 * the one decision that is its own: which mount takes which lane.
 *
 * ```ts
 * const binding = createCheckoutPropsBinding({ copy, components });
 * // bind `binding.config` (or pass it to createPaymentFlows), then:
 * const Checkout = binding.mount(flows);   // <Checkout {...sameProps} />
 * ```
 */
import { createContext, createElement, useContext, type ComponentType, type JSX } from "react";

import type { CheckoutFlowProps } from "../components/checkout/checkout-flow";

import type { CheckoutCopyFE } from "./copy";
import type { PaymentFlows, PaymentFlowsConfig } from "./types";

/** What the binding is built with: everything the props cannot carry. */
export interface CheckoutPropsBindingBase
  extends Pick<PaymentFlowsConfig, "transport" | "components" | "polling" | "onWarning"> {
  /** The factory's copy, fixed — what the transport's sentences are built from. */
  copy: CheckoutCopyFE;
  /**
   * The factory's own screens' words for THIS render; the `views` always come
   * from the props' `copy`. Omitted ⇒ `copy`'s.
   */
  useCopy?(): Omit<CheckoutCopyFE, "views">;
}

/** The binding: the config to bind, and the mount that feeds it. */
export interface CheckoutPropsBinding {
  config: PaymentFlowsConfig;
  /** `flows.Checkout`, reading every value from the props it is given. */
  mount(flows: PaymentFlows): ComponentType<CheckoutFlowProps>;
}

/** Bind the factory over `<CheckoutFlow>`'s props. */
export function createCheckoutPropsBinding(base: CheckoutPropsBindingBase): CheckoutPropsBinding {
  const Props = createContext<CheckoutFlowProps | null>(null);
  function useProps(): CheckoutFlowProps {
    const props = useContext(Props);
    if (!props) throw new Error("createCheckoutPropsBinding: the bound Checkout mounted outside its `mount`.");
    return props;
  }
  const { useCopy: useRest, ...fixed } = base;
  const config: PaymentFlowsConfig = {
    ...fixed,
    useScope: () => ({ tenantSlug: useProps().tenantSlug }),
    useCart: () => useProps().cart,
    useBuyerDefaults: () => {
      const { defaultBuyer, taxIdOnFile, taxIdKindOnFile } = useProps();
      return { buyer: defaultBuyer, taxIdOnFile, taxIdKindOnFile };
    },
    useSettlement: () => useProps().settlement ?? null,
    usePaymentList: () => useProps().paymentList,
    // `null` is "not answered yet", exactly as the hand mount reads it — and
    // never a fetch of the factory's own.
    useProviderConfig: () => ({ config: useProps().providerConfig ?? null, pending: false }),
    useCopy: () => ({ ...(useRest ? useRest() : base.copy), views: useProps().copy }),
    useConfirmation: () => {
      const p = useProps();
      return { extra: p.confirmationExtra, hero: p.confirmationHero, footer: p.confirmationFooter, backActionEmphasis: p.backActionEmphasis };
    },
    usePorts: () => {
      const p = useProps();
      return {
        createPayable: p.createOrder,
        saveBuyerContact: p.saveBuyerContact,
        exitToCatalog: p.onExitToMenu,
        onPaid: p.onPaid,
        validateApplePayMerchant: p.validateApplePayMerchant,
      };
    },
  };
  return {
    config,
    mount(flows) {
      return function BoundCheckout(props: CheckoutFlowProps): JSX.Element {
        return createElement(Props.Provider, { value: props }, createElement(flows.Checkout, { settlement: props.settlement }));
      };
    },
  };
}
