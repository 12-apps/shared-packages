import type { KeetaAdapterCopy } from "./copy";

/**
 * The Keeta adapter's pt-BR pack: each code in the words of Keeta's own
 * cancellation table ("Significado"). A host passes this pack by hand:
 * choosing the language is a line in the host's diff.
 */
export const KEETA_ADAPTER_COPY_PT_BR = {
  reasonLabels: {
    SYSTEMIC_ISSUES: "Problemas sistêmicos",
    DUPLICATE_APPLICATION: "Pedido duplicado",
    UNAVAILABLE_ITEM: "Item indisponível",
    RESTAURANT_WITHOUT_DELIVERY_PERSON: "Restaurante sem entregador",
    OUTDATED_MENU: "Cardápio desatualizado",
    ORDER_OUTSIDE_THE_DELIVERY_AREA: "Fora da área de entrega",
    BLOCKED_CUSTOMER: "Cliente bloqueado",
    OUTSIDE_DELIVERY_HOURS: "Fora do horário de entrega",
    INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT: "Dificuldades internas",
    RISK_AREA: "Área de risco",
    DELIVERY_PROBLEM: "Problema na entrega",
  },
  missingStreetNumber: "s/n",
} as const satisfies KeetaAdapterCopy;
