// @vitest-environment jsdom
/**
 * THE DEV-MODE ASSERTION (FUT-1216 risk 1).
 *
 * Every registered plugin's `useFacts()` runs in array order, so React's hook
 * identity is a function of the array's membership. A host that hands the
 * factory a fresh array per render — a getter, a `filter` in a component body,
 * a config object rebuilt on the fly — breaks that silently: it works until a
 * plugin leaves the middle of the list, and then React pairs one plugin's
 * state with another's, with nothing red anywhere.
 *
 * So the assertion refuses the SHAPE rather than waiting for the symptom, and
 * this suite is the proof that it does — in a development build, and only
 * there. It is asserted through an error BOUNDARY because React 19 reports an
 * uncaught render error rather than rethrowing it from `render`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { Component, type JSX, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStablePluginArray } from "../stable-plugins";
import type { AnyCheckoutStep } from "../types";
import type { PaymentFlowsConfig } from "../../types";

import { buildHost } from "./pipeline-host";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A step that registers a hook — the thing whose ORDER is at stake. */
const A_STEP: AnyCheckoutStep = {
  id: "a",
  phase: "details",
  useFacts: () => null,
  applies: () => false,
  complete: () => true,
  render: () => null,
};

/**
 * What a host sees when a library throws during render.
 *
 * The message is RENDERED rather than pushed into an array the suite holds:
 * a boundary is the only place this error is observable, and reading it out of
 * the DOM keeps every case's evidence inside that case.
 */
class Boundary extends Component<{ children: ReactNode }, { message: string }> {
  override state = { message: "" };

  static getDerivedStateFromError(error: Error): { message: string } {
    return { message: error.message };
  }

  override render(): ReactNode {
    return this.state.message ? (
      <p data-testid="tripped">{this.state.message}</p>
    ) : (
      this.props.children
    );
  }
}

function Probe({ array }: { array: readonly unknown[] | undefined }): JSX.Element {
  useStablePluginArray("steps", array);
  return <p data-testid="probe" />;
}

/** Render a probe twice with the arrays given, and report what the boundary saw. */
function renderTwice(
  first: readonly unknown[] | undefined,
  second: readonly unknown[] | undefined,
): { tripped: boolean; message: string } {
  // React logs an uncaught render error even when a boundary handles it; the
  // spy keeps that out of the suite's output without hiding the assertion. It
  // is restored by `vi.restoreAllMocks()` in `afterEach`.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const view = render(
    <Boundary>
      <Probe array={first} />
    </Boundary>,
  );
  view.rerender(
    <Boundary>
      <Probe array={second} />
    </Boundary>,
  );
  const tripped = screen.queryByTestId("tripped");
  return { tripped: tripped !== null, message: tripped?.textContent ?? "" };
}

describe("a plugin array rebuilt per render trips the assertion", () => {
  it("trips, naming the array and the fix", () => {
    // Same MEMBERSHIP, different array — which is exactly the host mistake: it
    // works today and stops working the day a filter changes its answer.
    const result = renderTwice([A_STEP], [A_STEP]);
    expect(result.tripped).toBe(true);
    expect(result.message).toMatch(/`steps` must be the SAME array on every render/);
    expect(result.message).toMatch(/Hoist it to module scope/);
  });

  it("says nothing when the array is hoisted, which is the fix", () => {
    const steps: readonly unknown[] = [A_STEP];
    expect(renderTwice(steps, steps).tripped).toBe(false);
  });

  it("says nothing when the host registered nothing at all", () => {
    expect(renderTwice(undefined, undefined).tripped).toBe(false);
  });

  it("does nothing at all in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    // A live checkout is never taken down by a wiring complaint: by then the
    // shape has been provable for the host's whole dev and test cycle.
    expect(renderTwice([A_STEP], [A_STEP]).tripped).toBe(false);
  });
});

describe("the engine is what asks", () => {
  it("trips on a config whose `steps` is rebuilt on every read", async () => {
    // The realistic host shape: a config that COMPUTES its plugin list rather
    // than holding one.
    const config: Partial<PaymentFlowsConfig> = {
      get steps(): readonly AnyCheckoutStep[] {
        return [A_STEP];
      },
    };
    const { flows } = buildHost(config);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Boundary>
        <flows.Checkout />
      </Boundary>,
    );
    // The FIRST render has nothing to compare with; the second — the one the
    // resolved `/config` read causes — is where the getter answers differently.
    const tripped = await screen.findByTestId("tripped");
    expect(tripped.textContent).toMatch(/`steps` must be the SAME array on every render/);
  });
});
