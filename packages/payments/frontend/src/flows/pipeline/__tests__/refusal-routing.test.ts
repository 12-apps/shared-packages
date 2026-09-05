/**
 * WHERE A REFUSAL IS RE-RENDERED (FUT-1240).
 *
 * A code belongs to whoever can do something about it. The property worth
 * pinning is that a claimed refusal reaches its claimant and NOBODY else — a
 * step never draws a complaint about a field it does not own — and that a code
 * nobody claimed still reaches the shopper rather than vanishing.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutError } from "../../../components/checkout/types";
import { errorForStep, refusalOwner, refusalStepOverride } from "../refusal-routing";
import type { AnyCheckoutGate, AnyCheckoutStep } from "../types";

const ADDRESS_STEP: AnyCheckoutStep = {
  id: "address",
  phase: "details",
  answersCodes: ["DELIVERY_ADDRESS_REQUIRED", "DELIVERY_PHONE_REQUIRED"],
  applies: () => true,
  complete: () => false,
  render: () => null,
};

const OPEN_GATE: AnyCheckoutGate = {
  id: "store-open",
  answersCodes: ["STORE_CLOSED", "DELIVERY_ADDRESS_REQUIRED"],
  decide: () => ({ kind: "pass" }),
};

const STEPS = [ADDRESS_STEP];
const GATES = [OPEN_GATE];

function errorOf(code: string): CheckoutError {
  return { code, message: "não foi possível", field: null };
}

describe("who answers a refusal code", () => {
  it("routes a claimed code to the step that claimed it", () => {
    expect(refusalOwner("DELIVERY_PHONE_REQUIRED", STEPS, GATES)).toEqual({
      kind: "step",
      id: "address",
    });
  });

  it("routes a gate's own code to the gate", () => {
    expect(refusalOwner("STORE_CLOSED", STEPS, GATES)).toEqual({ kind: "gate", id: "store-open" });
  });

  it("prefers the STEP when both claim the same code", () => {
    // Both claims are legitimate — a gate that refuses an unserviceable
    // address and a step that owns the field — and the screen a shopper can
    // type into is the more useful of the two.
    expect(refusalOwner("DELIVERY_ADDRESS_REQUIRED", STEPS, GATES)).toEqual({
      kind: "step",
      id: "address",
    });
  });

  it("falls back to a plain retry for a code nobody claimed", () => {
    expect(refusalOwner("GATEWAY_UNAVAILABLE", STEPS, GATES)).toEqual({ kind: "retry" });
    expect(refusalOwner(undefined, STEPS, GATES)).toEqual({ kind: "retry" });
  });
});

describe("which step draws the refusal", () => {
  it("shows a claimed refusal to its claimant and to nobody else", () => {
    const error = errorOf("DELIVERY_PHONE_REQUIRED");
    const owner = refusalOwner(error.code, STEPS, GATES);
    expect(errorForStep(error, owner, "address", "method")).toBe(error);
    expect(errorForStep(error, owner, "method", "method")).toBeNull();
  });

  it("shows an unclaimed refusal wherever the shopper is standing", () => {
    const error = errorOf("GATEWAY_UNAVAILABLE");
    const owner = refusalOwner(error.code, STEPS, GATES);
    expect(errorForStep(error, owner, "method", "method")).toBe(error);
    expect(errorForStep(error, owner, "address", "method")).toBeNull();
  });

  it("shows a gate's refusal on the current step, because the gate is passing", () => {
    // The fixture gate above ADMITS everyone, and that is the only shape a
    // gate-claimed code can reach a step in: a gate that would refuse curtains
    // the checkout before anyone can press pay, and its own `Screen` is handed
    // the error there. So this assertion used to pin the swallow — the shopper
    // pressed pay, the server refused, and nothing on the screen changed.
    const error = errorOf("STORE_CLOSED");
    const owner = refusalOwner(error.code, STEPS, GATES);
    expect(owner).toEqual({ kind: "gate", id: "store-open" });
    expect(errorForStep(error, owner, "method", "method")).toBe(error);
    // Still nobody else's: a step the shopper is not on draws no complaint.
    expect(errorForStep(error, owner, "address", "method")).toBeNull();
  });
});

describe("a claimed refusal moves the shopper", () => {
  it("re-opens the claiming step, wherever they were", () => {
    const error = errorOf("DELIVERY_ADDRESS_REQUIRED");
    expect(refusalStepOverride(error, refusalOwner(error.code, STEPS, GATES))).toBe("address");
  });

  it("moves nobody for a gate's code or an unclaimed one", () => {
    const closed = errorOf("STORE_CLOSED");
    const unknown = errorOf("GATEWAY_UNAVAILABLE");
    expect(refusalStepOverride(closed, refusalOwner(closed.code, STEPS, GATES))).toBeNull();
    expect(refusalStepOverride(unknown, refusalOwner(unknown.code, STEPS, GATES))).toBeNull();
    expect(refusalStepOverride(null, { kind: "step", id: "address" })).toBeNull();
  });
});
