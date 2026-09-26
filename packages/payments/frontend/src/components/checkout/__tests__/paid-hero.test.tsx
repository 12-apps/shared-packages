// @vitest-environment jsdom
/**
 * `paidHero`: the host's own illustration in place of the PAID icon.
 *
 * The storefront puts its mascot there when a buyer pays their first order at
 * a store, or on their birthday. Three things are pinned: the illustration
 * replaces the icon and nothing else (the heading stays the package's), it is
 * ONLY ever on PAID — a mascot celebrating a failed payment would say the
 * opposite of what happened — and a host that passes nothing gets the screen
 * exactly as it was.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStatus } from "../payment-status";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { OrderStatus } from "../types";

afterEach(cleanup);

function renderStatus(status: OrderStatus, paidHero?: boolean): void {
  render(
    <PaymentStatus
      copy={PT_BR_CHECKOUT_VIEW_COPY.status}
      status={status}
      totalLabel="R$ 62,66"
      onBackToMenu={vi.fn()}
      paidHero={paidHero ? <span data-testid="host-mascot">Papi</span> : undefined}
    />,
  );
}

describe("the paid confirmation's hero", () => {
  it("shows the host's illustration in place of the icon, under the package's own heading", () => {
    renderStatus("PAID", true);

    const hero = screen.getByTestId("payment-paid-hero");
    expect(hero.contains(screen.getByTestId("host-mascot"))).toBe(true);
    expect(screen.getByTestId("payment-paid").textContent).toContain(
      PT_BR_CHECKOUT_VIEW_COPY.status.paid.heading,
    );
  });

  it.each(["FAILED", "EXPIRED"] as const)("never shows it on %s", (status) => {
    renderStatus(status, true);

    expect(screen.queryByTestId("host-mascot")).toBeNull();
  });

  it("leaves the screen as it was when the host passes nothing", () => {
    renderStatus("PAID");

    expect(screen.queryByTestId("payment-paid-hero")).toBeNull();
    expect(screen.getByTestId("payment-paid").querySelector("svg")).not.toBeNull();
  });
});
