import { MIN_SUBTOTAL_TOKEN, type DiscountRejectionCopy } from "./rejection-copy";

/**
 * The pt-BR pack — a NAMED export a host passes by hand
 * (`rejectionCopy: PT_BR_DISCOUNT_REJECTION_COPY`), never a default. The
 * filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent.
 *
 * Deliberately coarser than the reason set: switched off, not started yet and
 * expired all read the same, because the difference only leaks how the
 * merchant schedules promotions and the buyer could not act on it either way.
 *
 * `OUT_OF_SCHEDULE` is the SECOND place it stops, and by the same test.
 * "Inválido ou expirado" sends a buyer away from a shop that will sell them
 * this in an hour; a promotion that runs on Friday afternoons is one they can
 * simply come back for. It stays vague about WHEN on purpose — the hours are on
 * the card, and a rejection message that recited a merchant's whole schedule
 * would be both long and a leak.
 *
 * `COMBO_NOT_MATCHED` is the one place that coarsening stops, and for the same
 * test read the other way: a buyer one soda short of the combo can finish it,
 * so telling them WHICH kind of failure this was is the difference between a
 * dead end and a sale. It does not name the missing item — the evaluator does
 * not report one, because "which item is missing" has no single answer when a
 * slot accepts a whole category.
 */
export const PT_BR_DISCOUNT_REJECTION_COPY: DiscountRejectionCopy = {
  UNKNOWN_CODE: "Cupom inválido ou expirado.",
  INACTIVE: "Cupom inválido ou expirado.",
  NOT_STARTED: "Cupom inválido ou expirado.",
  EXPIRED: "Cupom inválido ou expirado.",
  OUT_OF_SCHEDULE: "Esta promoção não está valendo agora.",
  MIN_SUBTOTAL_NOT_MET: `Este cupom exige um pedido mínimo de ${MIN_SUBTOTAL_TOKEN}.`,
  USAGE_LIMIT_REACHED: "Este cupom já atingiu o limite de uso.",
  BUYER_LIMIT_REACHED: "Você já usou este cupom.",
  NO_ELIGIBLE_ITEMS: "Este cupom não vale para os itens do seu carrinho.",
  COMBO_NOT_MATCHED: "Seu carrinho ainda não tem todos os itens deste combo.",
  ZERO_VALUE: "Este cupom não vale para os itens do seu carrinho.",
  NOT_STACKABLE: "Outra promoção já aplicada é melhor que este cupom.",
  EMPTY_CART: "Seu carrinho está vazio.",
  minSubtotalUnknown: "Este cupom exige um valor mínimo de pedido.",
};
