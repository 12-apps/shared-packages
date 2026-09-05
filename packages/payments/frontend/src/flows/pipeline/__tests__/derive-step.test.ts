// @vitest-environment jsdom
/**
 * THE WALK, before any host adopts it (FUT-1240, FUT-1216 risk 2).
 *
 * `deriveStep` replaces a `useState<Step>` on the money path, so the one thing
 * it may not do is behave differently from the nav it replaces. The six cases
 * below are the storefront's own `checkout-skip-dados.test.tsx`, restated
 * against the derivation rather than against a rendered app — which is the
 * point of them landing HERE and landing FIRST: the host adopts the engine in
 * a later step, and by then this has to be settled.
 *
 * The last two are the rule this engine exists to make unbreakable: a
 * settlement method that raises no charge never yields a `pay`-phase step, for
 * ANY registered method, enforced once rather than remembered per lane.
 */
import { describe, expect, it, vi } from "vitest";

import { applyingSteps, deriveNav, deriveStep, raisesCharge } from "../derive-step";
import { CARD_PANE_STEP, PACKAGE_METHODS, PIX_PANE_STEP } from "../methods";
import { buildMethodStep, dadosStep, DADOS_STEP_ID } from "../steps/buyer-steps";
import { cardStep, handoffStep, HANDOFF_STEP_ID, pixStep } from "../steps/pay-steps";
import { statusStep } from "../steps/status-step";
import type { AnyCheckoutStep, AnySettlementMethod, CheckoutContext } from "../types";

import { ctxOf, NO_CHARGE_METHODS, orderOf } from "./fixtures";

/** The package's own walk, minus the resume step (which needs a live runtime). */
function walk(methods: readonly AnySettlementMethod[]): readonly AnyCheckoutStep[] {
  return [dadosStep, buildMethodStep(methods), pixStep, cardStep, handoffStep, statusStep];
}

const CHARGED = PACKAGE_METHODS;
const ALL_METHODS = [...PACKAGE_METHODS, ...NO_CHARGE_METHODS];

/** Which step a shopper in this context is on. */
function stepIdFor(
  ctx: CheckoutContext,
  methods: readonly AnySettlementMethod[] = CHARGED,
  reopened: string | null = null,
): string | null {
  return deriveStep({ steps: walk(methods), ctx, facts: {}, methods, reopened }).step?.id ?? null;
}

/** A buyer-details slice, as the step's own parser would hand it back. */
function dados(opened: boolean, done: boolean): Record<string, unknown> {
  return { [DADOS_STEP_ID]: { opened, done } };
}

describe("the derived step reproduces the skipped-Dados flow (FUT-465)", () => {
  it("opens straight on Pagamento and never asks for the CPF again", () => {
    const ctx = ctxOf({ taxIdOnFile: true });
    expect(stepIdFor(ctx)).toBe("method");
    // The form the buyer would have had to retype is not part of their walk at
    // all — which is the fact the two back cases below turn on.
    const applying = applyingSteps({ steps: walk(CHARGED), ctx, facts: {}, methods: CHARGED });
    expect(applying.map((step) => step.id)).not.toContain(DADOS_STEP_ID);
  });

  it("still shows the form to a buyer who has no CPF saved", () => {
    const ctx = ctxOf({ taxIdOnFile: false });
    expect(stepIdFor(ctx)).toBe(DADOS_STEP_ID);
  });

  it("states who is being charged, and offers to change it", () => {
    const ports = { reopen: vi.fn(), openDados: vi.fn(), exitToCatalog: vi.fn() };
    const skipped = deriveNav({ applying: [], index: 0, taxIdOnFile: true, terminal: false, ports });
    const asked = deriveNav({ applying: [], index: 0, taxIdOnFile: false, terminal: false, ports });
    // The payer block keys off its PRESENCE, so this is the whole of "offers
    // to change it" — and its absence is the whole of "there is nothing to
    // change, you filled the form yourself".
    expect(skipped.editBuyer).toBeDefined();
    expect(asked.editBuyer).toBeUndefined();
    skipped.editBuyer?.();
    expect(ports.openDados).toHaveBeenCalledTimes(1);
  });

  it('"Alterar" reopens Dados so a different CPF can be typed for this purchase', () => {
    // What `openDados` writes: opened, and not done.
    const ctx = ctxOf({ taxIdOnFile: true, slices: dados(true, false) });
    expect(stepIdFor(ctx)).toBe(DADOS_STEP_ID);
  });

  it("carries the typed CPF to Pagamento, and back now returns to Dados", () => {
    const typed = ctxOf({
      taxIdOnFile: true,
      buyer: { taxId: "52998224725" },
      slices: dados(true, true),
    });
    expect(stepIdFor(typed)).toBe("method");
    // The CPF is the CONTEXT's, so every later step reads the one typed for
    // this purchase rather than the one on file.
    expect(typed.buyer.taxId).toBe("52998224725");

    const derived = deriveStep({
      steps: walk(CHARGED),
      ctx: typed,
      facts: {},
      methods: CHARGED,
    });
    const ports = { reopen: vi.fn(), openDados: vi.fn(), exitToCatalog: vi.fn() };
    deriveNav({
      applying: derived.applying,
      index: derived.index,
      taxIdOnFile: true,
      terminal: false,
      ports,
    }).back();
    // Dados IS part of their flow now, so back returns to it, not to the menu.
    expect(ports.reopen).toHaveBeenCalledWith(DADOS_STEP_ID);
    expect(ports.exitToCatalog).not.toHaveBeenCalled();
    expect(stepIdFor(typed, CHARGED, DADOS_STEP_ID)).toBe(DADOS_STEP_ID);
  });

  it("sends a skipped buyer back to the menu, not to a step they never saw", () => {
    const ctx = ctxOf({ taxIdOnFile: true });
    const derived = deriveStep({ steps: walk(CHARGED), ctx, facts: {}, methods: CHARGED });
    const ports = { reopen: vi.fn(), openDados: vi.fn(), exitToCatalog: vi.fn() };
    deriveNav({
      applying: derived.applying,
      index: derived.index,
      taxIdOnFile: true,
      terminal: false,
      ports,
    }).back();
    expect(ports.exitToCatalog).toHaveBeenCalledTimes(1);
    expect(ports.reopen).not.toHaveBeenCalled();
  });

  it.each(["PIX", "CARD"] as const)(
    "sends a shopper who settled with %s to the menu, not back to the pane",
    (method) => {
      // `useCheckoutNav` maps back to Dados only FROM `payment`; every other
      // step goes to the menu. A settled order leaves its pane APPLYING — an
      // order exists and nothing handed over — and merely COMPLETE, so "the
      // previous applying step" behind the confirmation is the payment surface
      // for money that already moved.
      const settled = ctxOf({
        taxIdOnFile: true,
        method,
        order: orderOf({ method }),
        outcome: "PAID",
      });
      const derived = deriveStep({
        steps: walk(CHARGED),
        ctx: settled,
        facts: {},
        methods: CHARGED,
      });
      expect(derived.step?.id).toBe("status");
      // The pane really is behind them — this is not a walk that happens to
      // have nothing to go back to.
      expect(derived.applying.map((step) => step.id)).toContain(method.toLowerCase());

      const ports = { reopen: vi.fn(), openDados: vi.fn(), exitToCatalog: vi.fn() };
      deriveNav({
        applying: derived.applying,
        index: derived.index,
        taxIdOnFile: true,
        terminal: settled.outcome !== null,
        ports,
      }).back();
      expect(ports.exitToCatalog).toHaveBeenCalledTimes(1);
      expect(ports.reopen).not.toHaveBeenCalled();
    },
  );

  it("sends a shopper back to the menu from a REFUSED confirmation too", () => {
    // The rule is the OUTCOME, not the word "paid": a FAILED confirmation
    // carries its own retry, and the pane behind it is no more a destination
    // than it is after a payment that worked.
    const failed = ctxOf({
      taxIdOnFile: true,
      method: "PIX",
      order: orderOf({ method: "PIX" }),
      outcome: "FAILED",
    });
    const derived = deriveStep({ steps: walk(CHARGED), ctx: failed, facts: {}, methods: CHARGED });
    const ports = { reopen: vi.fn(), openDados: vi.fn(), exitToCatalog: vi.fn() };
    deriveNav({
      applying: derived.applying,
      index: derived.index,
      taxIdOnFile: true,
      terminal: true,
      ports,
    }).back();
    expect(ports.exitToCatalog).toHaveBeenCalledTimes(1);
    expect(ports.reopen).not.toHaveBeenCalled();
  });
});

describe("a settlement that raises no charge mounts no payment surface", () => {
  // The row itself is no longer a parameter: what it carried was `pane`, and
  // both rows declare it `null`, so the assertion it fed asserted nothing.
  it.each(NO_CHARGE_METHODS.map((method) => method.id))(
    "derives no pay-phase step for %s, at any point in its walk",
    (id) => {
      expect(raisesCharge(id, ALL_METHODS)).toBe(false);
      // Every state the walk can be in AFTER the method is chosen: nothing
      // raised yet, an order in hand, and the order answered.
      const states: Partial<CheckoutContext>[] = [
        { method: id },
        { method: id, order: orderOf({ method: "PIX" }) },
        { method: id, order: orderOf({ method: "PIX" }), outcome: "AWAITING_PAYMENT" },
        {
          method: id,
          order: orderOf({ hostedCheckoutUrl: "https://provider.example/pay" }),
        },
      ];
      for (const over of states) {
        const ctx = ctxOf({ taxIdOnFile: true, slices: dados(false, false), ...over });
        const applying = applyingSteps({
          steps: walk(ALL_METHODS),
          ctx,
          facts: {},
          methods: ALL_METHODS,
        });
        // NOT `method.pane`: both no-charge rows declare `pane: null`, so
        // naming it here only ever asserted "the walk derived SOME step". The
        // panes that could actually be derived are the package's own, and they
        // are asserted FIRST so this reads as the failure it is meant to catch
        // rather than as a consequence of the phase check below.
        const derivedId = stepIdFor(ctx, ALL_METHODS);
        expect(derivedId).not.toBe(PIX_PANE_STEP);
        expect(derivedId).not.toBe(CARD_PANE_STEP);
        expect(derivedId).not.toBe(HANDOFF_STEP_ID);
        expect(applying.map((step) => step.phase)).not.toContain("pay");
      }
    },
  );

  it("still mounts the pane for a method that DOES raise a charge", () => {
    const ctx = ctxOf({
      taxIdOnFile: true,
      method: "PIX",
      order: orderOf({ method: "PIX" }),
    });
    expect(stepIdFor(ctx, ALL_METHODS)).toBe("pix");
  });

  it("takes a no-charge placement straight to the confirmation", () => {
    const ctx = ctxOf({
      taxIdOnFile: true,
      method: "ON_DELIVERY",
      order: orderOf({ method: "PIX" }),
      // Placing IS the settlement, so its own status is already the outcome.
      outcome: "AWAITING_PAYMENT",
    });
    expect(stepIdFor(ctx, ALL_METHODS)).toBe("status");
  });

  it("does not fire the rule for a method nobody registered", () => {
    // An id the engine has never heard of cannot be asserted to raise no
    // charge, and refusing the pay phase on a guess would strand a shopper
    // mid-payment.
    expect(raisesCharge("BOLETO", ALL_METHODS)).toBe(true);
  });
});
