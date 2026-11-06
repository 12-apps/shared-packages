// @vitest-environment jsdom
/**
 * `createCheckoutPropsBinding` forwards EVERY `<CheckoutFlow>` prop (FUT-1241,
 * review round 2).
 *
 * `CHECKOUT_PROP_ROUTES` only LABELS where each prop goes: a hook of the
 * binding that stopped reading one (`onPaid` out of `usePorts`,
 * `backActionEmphasis` out of `useConfirmation`, `components` off the mount)
 * would leave the table, and every rendered case, green — the bound lane would
 * just lose it. So here the real binding and the real `createPaymentFlows`
 * mount a RECORDER in place of `<CheckoutFlow>`, fed props whose every key is a
 * distinct sentinel, and each key the table names must arrive: by identity,
 * or — for a port the factory wraps to keep its identity stable — as a
 * function that calls the sentinel with the same arguments and hands back its
 * answer. The key list is the table's, so a new prop must be routed AND
 * forwarded.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutFlowProps } from "../../components/checkout/checkout-flow";
import { EN_US_CHECKOUT_VIEW_COPY } from "../../components/checkout/en-US";
import { PT_BR_PAYMENT_LIST_COPY } from "../../components/checkout/list/pt-BR";
import { STORY_CHECKOUT_COPY } from "../../stories/demo-copy";
import { CHECKOUT_PROP_ROUTES, createCheckoutPropsBinding } from "../checkout-props-binding";
import { createPaymentFlows } from "../create-payment-flows";

/** Every props object `<CheckoutFlow>` was rendered with — mutated, never reassigned. */
const recorded = vi.hoisted(() => ({ props: [] as CheckoutFlowProps[] }));

vi.mock("../../components/checkout/checkout-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/checkout/checkout-flow")>();
  return {
    ...actual,
    CheckoutFlow: (props: CheckoutFlowProps) => {
      recorded.props.push(props);
      return null;
    },
  };
});

afterEach(cleanup);
beforeEach(() => {
  recorded.props.length = 0;
});

/** A value no default and no other key can equal: only the prop it was handed as can be it. */
function sentinel<T>(label: string): T {
  return { sentinel: label } as unknown as T;
}

/** The ports the factory wraps (`useFlowPorts`), each a spy answering its own sentinel. */
const portAnswers = {
  createOrder: sentinel<Awaited<ReturnType<CheckoutFlowProps["createOrder"]>>>("createOrder-answer"),
  validateApplePayMerchant: sentinel<unknown>("validateApplePayMerchant-answer"),
};

/** What each wrapped port is called with, and the answer it must hand back. */
const portCalls: { [K in keyof CheckoutFlowProps]?: { args: unknown[]; answer: unknown } } = {
  createOrder: { args: [sentinel("createOrder-input")], answer: Promise.resolve(portAnswers.createOrder) },
  saveBuyerContact: { args: [sentinel("saveBuyerContact-contact")], answer: undefined },
  onExitToMenu: { args: [], answer: undefined },
  onPaid: { args: [], answer: undefined },
  validateApplePayMerchant: { args: ["https://apple.example/validate"], answer: Promise.resolve(portAnswers.validateApplePayMerchant) },
};

/** Every key REQUIRED, so a prop added to `CheckoutFlowProps` must be given a sentinel here to compile. */
function everyProp(): { [K in keyof Required<CheckoutFlowProps>]: CheckoutFlowProps[K] } {
  return {
    // A copy of a real pack, not the pack: the views reach the factory's
    // shell too (its transport words), so they must be real — and distinct.
    copy: { ...EN_US_CHECKOUT_VIEW_COPY },
    cart: sentinel("cart"),
    defaultBuyer: sentinel("defaultBuyer"),
    // Neither is the factory's default (`false`, `null`).
    taxIdOnFile: true,
    taxIdKindOnFile: "CNPJ",
    settlement: sentinel("settlement"),
    tenantSlug: "loja-sentinela",
    providerConfig: sentinel("providerConfig"),
    paymentList: { copy: PT_BR_PAYMENT_LIST_COPY, totalCents: 4321, door: [] },
    confirmationExtra: sentinel("confirmationExtra"),
    confirmationHero: sentinel("confirmationHero"),
    confirmationFooter: sentinel("confirmationFooter"),
    // Not the flow's own default ("primary").
    backActionEmphasis: "secondary",
    createOrder: vi.fn(() => portCalls.createOrder?.answer as ReturnType<CheckoutFlowProps["createOrder"]>),
    saveBuyerContact: vi.fn(),
    onExitToMenu: vi.fn(),
    onPaid: vi.fn(),
    validateApplePayMerchant: vi.fn(() => portCalls.validateApplePayMerchant?.answer as Promise<unknown>),
    components: sentinel("components"),
    // Not the flow's own default (`true`).
    parkHostedOrders: false,
  };
}

describe("the bound mount forwards every <CheckoutFlow> prop (FUT-1241, review round 2)", () => {
  it("hands the hand mount's flow each routed prop: by identity, or as the host's own port", async () => {
    const binding = createCheckoutPropsBinding({ copy: STORY_CHECKOUT_COPY });
    const Bound = binding.mount(createPaymentFlows(binding.config));
    const given = everyProp();
    render(<Bound {...given} />);

    const received = recorded.props.at(-1);
    expect(received).toBeDefined();
    const keys = Object.keys(CHECKOUT_PROP_ROUTES) as (keyof typeof CHECKOUT_PROP_ROUTES)[];
    // The table and the sentinels name the same props, so no key is skipped.
    expect([...keys].sort()).toEqual(Object.keys(given).sort());

    const lost: string[] = [];
    for (const key of keys) {
      const sent = given[key];
      const got = received?.[key];
      if (CHECKOUT_PROP_ROUTES[key] !== "usePorts") {
        if (got !== sent) lost.push(key);
        continue;
      }
      // A port: wrapped, so its identity holds across renders — it must CALL the host's.
      const call = portCalls[key];
      if (typeof got !== "function" || !call) {
        lost.push(key);
        continue;
      }
      const answer: unknown = (got as (...args: unknown[]) => unknown)(...call.args);
      expect(sent, key).toHaveBeenCalledWith(...call.args);
      if (call.answer instanceof Promise) expect(await answer, key).toBe(await call.answer);
    }
    expect(lost).toEqual([]);
  });
});
