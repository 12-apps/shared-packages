// @vitest-environment jsdom
/**
 * ONE ADMISSION ANSWER, offered headless (FUT-1240).
 *
 * The gates run in array order and the first non-`pass` verdict wins. What
 * this suite pins is the ORDER — a gate still waiting for a fact must speak
 * before a gate that would curtain the screen, or a shopper meets "loja
 * fechada" because a query had not landed yet — and that the surfaces which
 * OFFER a checkout get the same answer the checkout will give.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rememberHostedOrder } from "../../../components/checkout/hosted-return";
import { decideAdmission } from "../admission";
import type { AnyCheckoutGate, GateVerdict } from "../types";

import { ctxOf, orderOf } from "./fixtures";
import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** A gate whose verdict is whatever the suite says it is. */
function gateOf(id: string, verdict: GateVerdict, over: Partial<AnyCheckoutGate> = {}): AnyCheckoutGate {
  return { id, decide: () => verdict, ...over };
}

const CLOSED: GateVerdict = {
  kind: "refuse",
  Screen: () => <p data-testid="store-closed" />,
};

/** The headless verdict, rendered so a suite reads it out of the DOM. */
function Verdict({ useAdmission }: { useAdmission(): GateVerdict }): JSX.Element {
  return <p data-testid="verdict">{useAdmission().kind}</p>;
}

describe("the gates decide in order", () => {
  it("passes when every gate does", () => {
    const gates = [gateOf("a", { kind: "pass" }), gateOf("b", { kind: "pass" })];
    expect(decideAdmission({ gates, facts: [], ctx: ctxOf(), resuming: false })).toEqual({
      kind: "pass",
    });
  });

  it("lets a PENDING gate speak before a later one would refuse", () => {
    const gates = [gateOf("cart", { kind: "pending" }), gateOf("open", CLOSED)];
    expect(
      decideAdmission({ gates, facts: [], ctx: ctxOf(), resuming: false }).kind,
    ).toBe("pending");
  });

  it("refuses with the first refusing gate's own screen", () => {
    const other: GateVerdict = { kind: "refuse", Screen: () => <p data-testid="other" /> };
    const gates = [gateOf("open", CLOSED), gateOf("mode", other)];
    const verdict = decideAdmission({ gates, facts: [], ctx: ctxOf(), resuming: false });
    expect(verdict.kind).toBe("refuse");
    if (verdict.kind !== "refuse") return;
    render(<verdict.Screen ctx={ctxOf()} error={null} retry={() => undefined} />);
    expect(screen.getByTestId("store-closed")).toBeTruthy();
  });

  it("hands each gate its OWN facts, in array order", () => {
    const seen: unknown[] = [];
    const gates: AnyCheckoutGate[] = [
      { id: "a", decide: (_ctx, facts) => { seen.push(facts); return { kind: "pass" }; } },
      { id: "b", decide: (_ctx, facts) => { seen.push(facts); return { kind: "pass" }; } },
    ];
    decideAdmission({ gates, facts: ["fact-a", "fact-b"], ctx: ctxOf(), resuming: false });
    expect(seen).toEqual(["fact-a", "fact-b"]);
  });

  it("stands a gate aside for a shopper coming back from a payment", () => {
    // A gate that curtains the one route where money gets confirmed would
    // leave a buyer who PAID looking at "loja fechada" (FUT-1213).
    const gates = [gateOf("open", CLOSED, { standsAsideForResume: true })];
    expect(decideAdmission({ gates, facts: [], ctx: ctxOf(), resuming: true })).toEqual({
      kind: "pass",
    });
    expect(decideAdmission({ gates, facts: [], ctx: ctxOf(), resuming: false }).kind).toBe("refuse");
  });
});

describe("flows.useAdmission is the same list", () => {
  it("refuses through the host's own gate", async () => {
    const { flows } = buildHost({ gates: [gateOf("open", CLOSED)] });
    render(<Verdict useAdmission={flows.useAdmission} />);
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toBe("refuse"));
  });

  it("puts the gate's screen in front of the walk, not a step", async () => {
    const { flows } = buildHost({ gates: [gateOf("open", CLOSED)] }, { taxIdOnFile: true });
    render(<flows.Checkout />);
    expect(await screen.findByTestId("store-closed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("checkout-method")).toBeNull());
  });

  it("stands the gate aside for a parked hand-off, in both places", async () => {
    rememberHostedOrder(orderOf(), { tenantSlug: "loja-1", basket: null, handoff: true });
    const gates = [gateOf("open", CLOSED, { standsAsideForResume: true })];
    const { flows } = buildHost({ gates }, { taxIdOnFile: true });
    render(<Verdict useAdmission={flows.useAdmission} />);
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toBe("pass"));
  });

  it("passes for a host that registered no gates at all", () => {
    const { flows } = buildHost();
    render(<Verdict useAdmission={flows.useAdmission} />);
    expect(screen.getByTestId("verdict").textContent).toBe("pass");
  });
});
