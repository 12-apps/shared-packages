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
import { useEffect, useState } from "react";
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

describe("the engine's hooks do not move with a gate's verdict", () => {
  it("survives a gate going from pending to pass while the host reads availability", async () => {
    // The host's port is a real hook — the shape that makes the count matter.
    const useAvailability = (): { payable: boolean } => {
      const [payable] = useState(true);
      return { payable };
    };
    const thrown: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      thrown.push(event.error);
    };
    window.addEventListener("error", onError);
    // React logs the hook-order error before it throws; keep the run readable.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { flows } = buildHost(
        { gates: [stillAsking()] },
        { taxIdOnFile: true, useAvailability },
      );
      render(<flows.Checkout />);

      // The walk it could not reach while the hook count was unstable.
      await waitFor(() => expect(screen.queryByTestId("checkout-method")).not.toBeNull());
      expect(thrown).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
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
