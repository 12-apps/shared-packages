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
 */
export const PT_BR_DISCOUNT_REJECTION_COPY: DiscountRejectionCopy = {
  UNKNOWN_CODE: "Cupom inválido ou expirado.",
  INACTIVE: "Cupom inválido ou expirado.",
  NOT_STARTED: "Cupom inválido ou expirado.",
  EXPIRED: "Cupom inválido ou expirado.",
  MIN_SUBTOTAL_NOT_MET: `Este cupom exige um pedido mínimo de ${MIN_SUBTOTAL_TOKEN}.`,
  USAGE_LIMIT_REACHED: "Este cupom já atingiu o limite de uso.",
  BUYER_LIMIT_REACHED: "Você já usou este cupom.",
  NO_ELIGIBLE_ITEMS: "Este cupom não vale para os itens do seu carrinho.",
  ZERO_VALUE: "Este cupom não vale para os itens do seu carrinho.",
  NOT_STACKABLE: "Outra promoção já aplicada é melhor que este cupom.",
  EMPTY_CART: "Seu carrinho está vazio.",
  minSubtotalUnknown: "Este cupom exige um valor mínimo de pedido.",
};
