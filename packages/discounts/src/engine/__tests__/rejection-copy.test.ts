import { describe, expect, it } from "vitest";

import { DISCOUNT_REJECTION_REASONS, type DiscountRejectionReason } from "../kinds";
import { PT_BR_DISCOUNT_REJECTION_COPY } from "../pt-BR";
import {
  discountRejectionMessage,
  missingRejectionCopy,
  MIN_SUBTOTAL_TOKEN,
  type DiscountRejectionCopy,
} from "../rejection-copy";
import type { DiscountRejection } from "../types";

/**
 * Unit (FUT-235): the copy seam a buyer's `couponError` is rendered from.
 *
 * Two things the type checker cannot cover. The copy is what the buyer reads,
 * so a raw `{minimum}` token leaking through is a user-visible bug; and the
 * shipped pt-BR pack is deliberately COARSER than the reason set, so the test
 * pins which internal reasons are allowed to read the same rather than letting
 * that collapse happen silently.
 */

/** A currency formatter, fixed here so the copy is the subject. */
function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function rejection(
  reason: DiscountRejectionReason,
  overrides: Partial<DiscountRejection> = {},
): DiscountRejection {
  return { discountId: "d1", code: "CUPOM", reason, ...overrides };
}

describe("missingRejectionCopy", () => {
  it("names every key when the host passed nothing at all", () => {
    expect(missingRejectionCopy(undefined)).toEqual([
      ...DISCOUNT_REJECTION_REASONS,
      "minSubtotalUnknown",
    ]);
  });

  it("names a blank sentence — a present-but-empty key is not answered copy", () => {
    const copy = { ...PT_BR_DISCOUNT_REJECTION_COPY, EMPTY_CART: "  " };
    expect(missingRejectionCopy(copy)).toEqual(["EMPTY_CART"]);
  });

  it("passes the shipped pack, which is what a host is invited to hand over", () => {
    expect(missingRejectionCopy(PT_BR_DISCOUNT_REJECTION_COPY)).toEqual([]);
  });
});

describe("discountRejectionMessage", () => {
  it("answers every reason the evaluator can emit, token-free", () => {
    for (const reason of DISCOUNT_REJECTION_REASONS) {
      const message = discountRejectionMessage(
        rejection(reason),
        PT_BR_DISCOUNT_REJECTION_COPY,
        formatCents,
      );
      expect(message.length).toBeGreaterThan(0);
      expect(message.endsWith(".")).toBe(true);
      expect(message).not.toContain("{");
    }
  });

  it("fills the threshold into the minimum-subtotal sentence", () => {
    const message = discountRejectionMessage(
      rejection("MIN_SUBTOTAL_NOT_MET", { minSubtotalCents: 5_000 }),
      PT_BR_DISCOUNT_REJECTION_COPY,
      formatCents,
    );
    expect(message).toBe("Este cupom exige um pedido mínimo de R$ 50,00.");
  });

  it("falls back to a threshold-free sentence rather than printing the token", () => {
    const message = discountRejectionMessage(
      rejection("MIN_SUBTOTAL_NOT_MET"),
      PT_BR_DISCOUNT_REJECTION_COPY,
      formatCents,
    );
    expect(message).toBe("Este cupom exige um valor mínimo de pedido.");
  });

  it("leaves a host sentence that never asks for the threshold alone", () => {
    // A host that would rather not quote the number simply omits the token,
    // and then the formatter is never consulted at all.
    const copy: DiscountRejectionCopy = {
      ...PT_BR_DISCOUNT_REJECTION_COPY,
      MIN_SUBTOTAL_NOT_MET: "Your basket is too small.",
    };
    const message = discountRejectionMessage(
      rejection("MIN_SUBTOTAL_NOT_MET", { minSubtotalCents: 5_000 }),
      copy,
      () => {
        throw new Error("formatter must not be consulted");
      },
    );
    expect(message).toBe("Your basket is too small.");
    expect(copy.MIN_SUBTOTAL_NOT_MET).not.toContain(MIN_SUBTOTAL_TOKEN);
  });
});

describe("the shipped pt-BR pack", () => {
  it("tells a switched-off, unstarted, expired or unknown coupon apart from nothing", () => {
    // Deliberate: how the merchant schedules a promo is not the buyer's
    // business, and there is nothing they could do differently in any of them.
    const vague = "Cupom inválido ou expirado.";
    expect(PT_BR_DISCOUNT_REJECTION_COPY.UNKNOWN_CODE).toBe(vague);
    expect(PT_BR_DISCOUNT_REJECTION_COPY.INACTIVE).toBe(vague);
    expect(PT_BR_DISCOUNT_REJECTION_COPY.NOT_STARTED).toBe(vague);
    expect(PT_BR_DISCOUNT_REJECTION_COPY.EXPIRED).toBe(vague);
  });

  it("says something actionable for the reasons the buyer can act on", () => {
    expect(PT_BR_DISCOUNT_REJECTION_COPY.USAGE_LIMIT_REACHED).toBe(
      "Este cupom já atingiu o limite de uso.",
    );
    expect(PT_BR_DISCOUNT_REJECTION_COPY.BUYER_LIMIT_REACHED).toBe("Você já usou este cupom.");
    expect(PT_BR_DISCOUNT_REJECTION_COPY.NO_ELIGIBLE_ITEMS).toBe(
      "Este cupom não vale para os itens do seu carrinho.",
    );
    expect(PT_BR_DISCOUNT_REJECTION_COPY.NOT_STACKABLE).toBe(
      "Outra promoção já aplicada é melhor que este cupom.",
    );
    expect(PT_BR_DISCOUNT_REJECTION_COPY.EMPTY_CART).toBe("Seu carrinho está vazio.");
  });
});
