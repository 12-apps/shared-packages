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
  link: {
    problems: {
      UNAVAILABLE: "A conexão pelo aplicativo não está disponível para este marketplace.",
      NO_LINK_IN_PROGRESS: "Nenhuma conexão em andamento. Comece de novo pelo primeiro passo.",
      LINK_EXPIRED: "O código expirou. Gere um código novo e repita os passos.",
      CODE_REFUSED: "O marketplace recusou o código de autorização. Confira o código e cole de novo.",
      MARKETPLACE_REFUSED: "O marketplace recusou o pedido de conexão.",
      NOT_LINKED: "Esta loja não está conectada pelo aplicativo. Conecte de novo.",
      UNKNOWN_MERCHANT: "Esta loja não está entre as autorizadas no marketplace.",
      MERCHANT_TAKEN: "Esta loja do marketplace já está conectada a outra conta.",
    },
    tryAgain: "O marketplace não respondeu. Tente de novo em instantes.",
  },
} as const satisfies MarketplaceServerCopy;
