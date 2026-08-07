// @vitest-environment jsdom
/**
 * Nested slot providers ADD to what is above them (FUT-741).
 *
 * `CheckoutComponentsProvider` is a published export and the checkout nests it
 * against itself: `createPaymentFlows` fills the slots once at the factory, and
 * the `CheckoutFlow` inside its mount opens a second provider. When the inner
 * one merged over `defaultCheckoutComponents` instead of over the set it
 * inherited, it silently reimposed raw MUI on a host that had already stated
 * its design system — so the factory's `screens.*` wore the host's look and its
 * `Checkout` did not.
 *
 * These assert the merge itself, at the seam, independently of the factory.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CheckoutComponentsProvider, useCheckoutComponents } from "../ui";

afterEach(cleanup);

/** Renders one slot's identity, so a merge result is readable off the DOM. */
function Probe(): JSX.Element {
  const { Button, Alert } = useCheckoutComponents();
  return (
    <div>
      <Button dataTestId="probe-button">ok</Button>
      <Alert variant="info" title="t" data-testid="probe-alert" />
    </div>
  );
}

const hostButton = ({ children, dataTestId }: { children?: ReactNode; dataTestId?: string }) => (
  <button type="button" data-testid={dataTestId} data-slot-owner="host">
    {children}
  </button>
);

const innerAlert = ({ title, ...rest }: { title?: string; "data-testid"?: string }) => (
  <div data-testid={rest["data-testid"]} data-slot-owner="inner">
    {title}
  </div>
);

describe("CheckoutComponentsProvider nesting", () => {
  it("keeps an outer slot that the inner provider did not fill", () => {
    render(
      <CheckoutComponentsProvider components={{ Button: hostButton }}>
        <CheckoutComponentsProvider components={{ Alert: innerAlert }}>
          <Probe />
        </CheckoutComponentsProvider>
      </CheckoutComponentsProvider>,
    );

    // The regression: this was the raw-MUI button, because the inner provider
    // merged over the defaults rather than over the host's set.
    expect(screen.getByTestId("probe-button").getAttribute("data-slot-owner")).toBe("host");
    expect(screen.getByTestId("probe-alert").getAttribute("data-slot-owner")).toBe("inner");
  });

  it("keeps the outer slots when the inner provider fills nothing at all", () => {
    // The exact shape `CheckoutFlow` has inside the factory's mount: a provider
    // opened with no `components` prop of its own.
    render(
      <CheckoutComponentsProvider components={{ Button: hostButton }}>
        <CheckoutComponentsProvider>
          <Probe />
        </CheckoutComponentsProvider>
      </CheckoutComponentsProvider>,
    );

    expect(screen.getByTestId("probe-button").getAttribute("data-slot-owner")).toBe("host");
  });

  it("still falls back to the raw-MUI defaults with no provider above", () => {
    render(
      <CheckoutComponentsProvider components={{ Alert: innerAlert }}>
        <Probe />
      </CheckoutComponentsProvider>,
    );

    expect(screen.getByTestId("probe-button").getAttribute("data-slot-owner")).toBeNull();
    expect(screen.getByTestId("probe-button").textContent).toContain("ok");
  });
});
