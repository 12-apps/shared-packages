// @vitest-environment jsdom
/**
 * WHAT THE HOST IS TOLD IT IS SETTLING (FUT-1240).
 *
 * `CreateOrderRequest.method` is the package's own two, and a host's
 * registered settlement is not one of them. Left at that, every no-charge
 * method the ticket exists for arrives at the create port as the chain's
 * hand-off method — so "pay the courier" and "pay the waiter" are
 * indistinguishable from each other AND from a PIX charge, on the money path,
 * for the one capability (`raisesCharge: false`) this step shipped.
 *
 * The chosen id therefore rides its own optional field. It is absent for PIX
 * and CARD, which is what keeps the wire additive for every host already
 * reading `method`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateOrderRequest } from "../../../components/checkout/types";
import type { AnyCheckoutStep } from "../types";

import { NO_CHARGE_METHODS } from "./fixtures";
import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** The one request the create port was handed. */
function requestFrom(calls: readonly (readonly [CreateOrderRequest])[]): CreateOrderRequest {
  const first = calls[0]?.[0];
  if (!first) throw new Error("the create port was never called");
  return first;
}

describe("a host settlement method names itself on the wire", () => {
  it.each(NO_CHARGE_METHODS.map((method) => method.id))(
    "sends %s as the settlement, beside the method the chain can charge",
    async (id) => {
      const { flows, createPayable } = buildHost(
        { settlementMethods: NO_CHARGE_METHODS },
        { taxIdOnFile: true },
      );
      render(<flows.Checkout />);

      fireEvent.click(await screen.findByTestId(`checkout-method-${id}`));
      await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
      expect(requestFrom(createPayable.mock.calls).settlementMethod).toBe(id);
    },
  );

  it("leaves the field absent for the package's own two", async () => {
    const { flows, createPayable } = buildHost({ settlementMethods: [] }, { taxIdOnFile: true });
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
    const request = requestFrom(createPayable.mock.calls);
    expect(request.method).toBe("PIX");
    // ABSENT, not null: a host that never heard of this field reads exactly
    // the request it read before.
    expect("settlementMethod" in request).toBe(false);
  });

  it("lets a step's own contribute name it instead", async () => {
    // The docblock's escape hatch, made true: `contribute` returns
    // `Partial<CreateOrderRequest>`, so the field has to BE on that type for a
    // step to be able to set it at all.
    const namingStep: AnyCheckoutStep = {
      id: "naming",
      phase: "details",
      order: 1,
      applies: () => true,
      complete: () => true,
      contribute: () => ({ settlementMethod: "ON_DELIVERY_SCHEDULED" }),
      render: () => null,
    };
    const { flows, createPayable } = buildHost(
      { settlementMethods: NO_CHARGE_METHODS, steps: [namingStep] },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-ON_DELIVERY"));
    await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
    expect(requestFrom(createPayable.mock.calls).settlementMethod).toBe("ON_DELIVERY_SCHEDULED");
  });
});
