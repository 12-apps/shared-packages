import type { RappiAdapterCopy } from "./copy";

/**
 * The Rappi adapter's pt-BR pack: Rappi's reject types in the words a store
 * reads. A host passes this pack by hand: choosing the language is a line in
 * the host's diff.
 */
export const RAPPI_ADAPTER_COPY_PT_BR = {
  reasonLabels: {
    ITEM_OUT_OF_STOCK: "Item indisponível",
    ITEM_NOT_FOUND: "Item não encontrado",
    ITEM_WRONG_PRICE: "Preço do item errado",
    ORDER_MISSING_INFORMATION: "Faltam informações no pedido",
    ORDER_MISSING_ADDRESS_INFORMATION: "Faltam informações do endereço",
    ORDER_TOTAL_INCORRECT: "Total do pedido incorreto",
  },
  missingStreetNumber: "s/n",
} as const satisfies RappiAdapterCopy;
