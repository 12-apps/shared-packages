// @vitest-environment jsdom
/**
 * THE ENGINE'S HOOK COUNT DOES NOT DEPEND ON WHAT A GATE ANSWERED (FUT-1240).
 *
 * `runtime.useAvailability()` wraps the host's optional `ports.useAvailability`
 * (create-payment-flows.tsx:67), so it IS a hook. Called at its use site it sat
 * after the admission early return, and a gate that answers `pending` on one
 * render and `pass` on the next changed how many hooks the component ran —
 * "Rendered more hooks than during the previous render", on the checkout.
 *
 * Neither lane could see it. `eslint-plugin-react-hooks` reads `X.useFoo()` as a
 * hook only when X is PascalCase, and `runtime` is not. The suite could not
 * either: no pipeline test wired `ports.useAvailability`, and the one gate that
 * answers `pending` never transitions, so the second render never happened.
 *
 * Both halves are needed to reproduce, which is why this suite builds both.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnyCheckoutGate } from "../types";

import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/**
 * A gate that answers `pending` first and `pass` once its effect lands — a
 * store-hours or table lookup that has not come back yet, which is the case
 * the engine's own loading sentence exists for.
 */
function stillAsking(): AnyCheckoutGate {
  return {
    id: "tables",
    useFacts: () => {
      const [heard, setHeard] = useState(false);
      useEffect(() => setHeard(true), []);
      return heard;
    },
    decide: (_ctx, heard) => (heard === true ? { kind: "pass" } : { kind: "pending" }),
  } as AnyCheckoutGate;
}

/**
 * Catches what the render throws, so the assertion can name it. A `window`
 * error listener would read the same failure, but the flakiness lane forbids
 * mutating globals from a test — rightly, since the listener outlives a failed
 * run and reports into the next one.
 */
class Boundary extends Component<{ children: ReactNode }, { caught: Error | null }> {
  public constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { caught: null };
  }

  public static getDerivedStateFromError(caught: Error): { caught: Error } {
    return { caught };
  }

  public override render(): ReactNode {
    const { caught } = this.state;
    if (caught !== null) return <p data-testid="boundary-caught">{caught.message}</p>;
    return this.props.children;
  }
}

describe("the engine's hooks do not move with a gate's verdict", () => {
  it("survives a gate going from pending to pass while the host reads availability", async () => {
    // The host's port is a real hook — the shape that makes the count matter.
    const useAvailability = (): { payable: boolean } => {
      const [payable] = useState(true);
      return { payable };
    };
    // React logs the hook-order error before the boundary sees it; keep the run
    // readable without hiding the assertion, which reads the boundary.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { flows } = buildHost(
        { gates: [stillAsking()] },
        { taxIdOnFile: true, useAvailability },
      );
      render(
        <Boundary>
          <flows.Checkout />
        </Boundary>,
      );

      // Settle on EITHER outcome first, so the assertion below reports React's
      // own sentence rather than a timeout. Waiting only for the walk would
      // still fail, but after fifteen seconds and saying nothing useful.
      await waitFor(() =>
        expect(
          screen.queryByTestId("checkout-method") ?? screen.queryByTestId("boundary-caught"),
        ).not.toBeNull(),
      );
      expect(screen.queryByTestId("boundary-caught")?.textContent ?? null).toBeNull();
      expect(screen.queryByTestId("checkout-method")).not.toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still refuses a store that cannot charge, with the port wired", async () => {
    const { flows } = buildHost(
      {},
      { taxIdOnFile: true, useAvailability: () => ({ payable: false }) },
    );
    render(<flows.Checkout />);

    await waitFor(() =>
      expect(screen.queryByTestId("checkout-payments-disabled")).not.toBeNull(),
    );
  });
});
