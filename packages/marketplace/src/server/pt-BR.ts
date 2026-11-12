import type { MarketplaceServerCopy } from "./copy";

/** The marketplace routes' pt-BR pack. */
export const MARKETPLACE_SERVER_COPY_PT_BR = {
  invalidInput: "Dados inválidos.",
  nothingSaved: "Nada foi salvo. Corrija os problemas listados e envie tudo de novo.",
  orderNoLongerPending: "Este pedido já foi decidido ou expirou. Atualize a tela.",
  problems: {
    DUPLICATE: "Esta linha repete outra da mesma chamada.",
    NOT_FOUND: "Não encontrado.",
    ALREADY_DECIDED: "Este pedido já foi decidido.",
    EXPIRED: "O prazo para aceitar este pedido passou.",
    CONFLICT: "Outra pessoa decidiu este pedido agora há pouco.",
    INVALID_REASON: "Motivo inválido para este marketplace.",
    ITEMS_REQUIRED: "Este motivo precisa dos itens a que se refere.",
    UNKNOWN_ITEM: "Este item não está no pedido.",
    HOST_REFUSED: "A loja recusou esta decisão.",
    UNKNOWN_PROVIDER: "Marketplace desconhecido.",
    NOTHING_TO_UPDATE: "Nada para atualizar.",
    CATALOG_ITEM_NOT_FOUND: "Produto não encontrado.",
  },
} as const satisfies MarketplaceServerCopy;
