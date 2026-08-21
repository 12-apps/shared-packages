// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentsUnavailable } from "../payments-unavailable";
import { PT_BR_PAYMENTS_UNAVAILABLE_COPY } from "../pt-BR";

/**
 * A store with no active payment provider used to render the full payment step
 * — PIX and Cartão — and fail only at order creation, telling the shopper
 * "tente novamente em instantes": retry advice for a condition retrying never
 * fixes. These pin the two honest answers instead.
 *
 * Rendered with NO slot provider on purpose: outside a
 * `CheckoutComponentsProvider` the component falls back to the raw-MUI
 * defaults, so this suite also pins that the default slots carry the
 * load-bearing test ids. jest-dom is not a dependency here — DOM properties
 * are asserted directly.
 */

afterEach(cleanup);

describe("checkout — store cannot charge online", () => {
  it("offers the waiter when the shopper has a mesa", async () => {
    const onCallWaiter = vi.fn();
    render(<PaymentsUnavailable copy={PT_BR_PAYMENTS_UNAVAILABLE_COPY} waiterAvailable onCallWaiter={onCallWaiter} />);

    expect(screen.getByTestId("checkout-call-waiter")).toBeTruthy();
    fireEvent.click(screen.getByTestId("checkout-call-waiter-button"));
    expect(onCallWaiter).toHaveBeenCalledTimes(1);

    // Never the dead end: the shopper is not told to retry.
    await waitFor(() => expect(screen.queryByText(/tente novamente/i)).toBeNull());
  });

  it("says plainly that the store does not charge online with no waiter to call", async () => {
    render(<PaymentsUnavailable copy={PT_BR_PAYMENTS_UNAVAILABLE_COPY} waiterAvailable={false} />);

    expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy();
    // No waiter reachable — offering one would be a dead button.
    await waitFor(() => expect(screen.queryByTestId("checkout-call-waiter-button")).toBeNull());
  });

  it("renders no waiter button when the host supplies no handler", async () => {
    render(<PaymentsUnavailable copy={PT_BR_PAYMENTS_UNAVAILABLE_COPY} waiterAvailable />);
    await waitFor(() => expect(screen.queryByTestId("checkout-call-waiter-button")).toBeNull());
  });

  it("disables the waiter button while the request is in flight", () => {
    render(<PaymentsUnavailable copy={PT_BR_PAYMENTS_UNAVAILABLE_COPY} waiterAvailable onCallWaiter={vi.fn()} calling />);
    const button = screen.getByTestId("checkout-call-waiter-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
