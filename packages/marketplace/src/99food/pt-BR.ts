import type { NinetyNineFoodAdapterCopy } from "./copy";

/**
 * The 99Food adapter's pt-BR pack: Open Delivery's merchant cancellation codes
 * in the words a store reads. A host passes this pack by hand: choosing the
 * language is a line in the host's diff.
 */
export const NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR = {
  reasonLabels: {
    SYSTEMIC_ISSUES: "Problemas de sistema",
    DUPLICATE_APPLICATION: "Pedido em duplicidade",
    UNAVAILABLE_ITEM: "Item indisponível",
    RESTAURANT_WITHOUT_DELIVERY_PERSON: "Restaurante sem entregador",
    OUTDATED_MENU: "Cardápio desatualizado",
    ORDER_OUTSIDE_THE_DELIVERY_AREA: "Pedido fora da área de entrega",
    BLOCKED_CUSTOMER: "Cliente bloqueado",
    OUTSIDE_DELIVERY_HOURS: "Fora do horário de entrega",
    INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT: "Dificuldades internas do restaurante",
    RISK_AREA: "Área de risco",
    DELIVERY_PROBLEM: "Problema na entrega",
  },
  missingStreetNumber: "s/n",
} as const satisfies NinetyNineFoodAdapterCopy;
