import type { MarketplaceServerCopy } from "./copy";

/** The marketplace routes' pt-BR pack. */
export const MARKETPLACE_SERVER_COPY_PT_BR = {
  invalidInput: "Dados inválidos.",
  unknownProvider: "Marketplace desconhecido.",
  orderNoLongerPending: "Este pedido já foi decidido ou expirou. Atualize a tela.",
  invalidReason: "Motivo inválido para este marketplace.",
  catalogItemNotFound: "Produto não encontrado.",
  nothingToUpdate: "Nada para atualizar.",
} as const satisfies MarketplaceServerCopy;
