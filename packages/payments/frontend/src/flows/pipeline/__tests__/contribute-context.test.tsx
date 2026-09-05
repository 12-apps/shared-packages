// @vitest-environment jsdom
/**
 * WHAT A STEP'S `contribute` IS ALLOWED TO KNOW (FUT-1240).
 *
 * `settlement-wire.test.tsx` proves a step MAY name the settlement itself —
 * ADOPTING.md's "when the settlement has a finer name than the tile does". That
 * suite's step returns a constant, so it passed while the step could not
 * actually SEE which settlement it was naming.
 *
 * The walk is re-derived for the chosen method (`engine-actions.ts`, and its own
 * comment says why), but the request used to be built from the un-overridden
 * context. On the immediate-place path — a method with no Review, which is every
 * `raisesCharge: false` settlement — `ctx.method` was therefore still null by the
 * time `contribute` ran, and the escape hatch was documented but unusable. A
 * silently wrong create-order payload, on the money path.
 *
 * So this pins the context, not the constant.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateOrderRequest } from "../../../components/checkout/types";
import type { AnyCheckoutStep } from "../types";

import { NO_CHARGE_METHODS } from "./fixtures";
import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

function requestFrom(calls: readonly (readonly [CreateOrderRequest])[]): CreateOrderRequest {
  const first = calls[0]?.[0];
  if (!first) throw new Error("the create port was never called");
  return first;
}

/** A step that reports the settlement its own context named. */
const REPORTING_STEP: AnyCheckoutStep = {
  id: "reporting",
  phase: "details",
  order: 1,
  applies: () => true,
  complete: () => true,
  contribute: (ctx) => ({ settlementMethod: `saw:${String(ctx.method)}` }),
  render: () => null,
};

describe("a step's contribute sees the settlement the shopper chose", () => {
  it.each(NO_CHARGE_METHODS.map((method) => method.id))(
    "reads %s from its own context on the immediate-place path",
    async (id) => {
      const { flows, createPayable } = buildHost(
        { settlementMethods: NO_CHARGE_METHODS, steps: [REPORTING_STEP] },
        { taxIdOnFile: true },
      );
      render(<flows.Checkout />);

      fireEvent.click(await screen.findByTestId(`checkout-method-${id}`));
      await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
      // `saw:null` is the defect: the walk knew, the request did not.
      expect(requestFrom(createPayable.mock.calls).settlementMethod).toBe(`saw:${id}`);
    },
  );

  it("reads the package's own method too, not just a registered settlement", async () => {
    const { flows, createPayable } = buildHost(
      { settlementMethods: [], steps: [REPORTING_STEP] },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
    expect(requestFrom(createPayable.mock.calls).settlementMethod).toBe("saw:PIX");
  });
});
