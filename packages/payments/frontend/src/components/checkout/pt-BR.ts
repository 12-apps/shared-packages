import type {
  CheckoutViewCopy,
  PaymentsUnavailableCopy,
  PaymentStatusCopy,
} from "./view-copy";

/**
 * The pt-BR pack — the exact sentences these views compiled in until 6.0.0,
 * now NAMED exports a host passes by hand, never defaults. The filename is
 * what exempts this file from the copy-portability gate: Portuguese may ship,
 * it may not be silent.
 */
export const PT_BR_PAYMENTS_UNAVAILABLE_COPY: PaymentsUnavailableCopy = {
  title: "Pagamento online indisponível",
  body: "Esta loja não recebe pagamentos pelo site. Combine o pagamento diretamente com a loja para concluir seu pedido.",
  remedyTitle: "Pagamento com o garçom",
  remedyBody: "Esta loja não recebe pagamentos pelo site. Chame o garçom para fechar a conta na mesa.",
  callAction: "Chamar garçom",
  callingAction: "Chamando...",
};

export const PT_BR_PAYMENT_STATUS_COPY: PaymentStatusCopy = {
  paid: {
    heading: "Pedido confirmado",
    support: "Recebemos seu pagamento e já registramos o pedido.",
  },
  awaiting: {
    heading: "Confirmando seu pagamento",
    support: "Isso costuma levar alguns segundos. Pode deixar esta tela aberta.",
  },
  failed: {
    // Said plainly and first: the fear on this screen is having been charged
    // for an order that failed.
    heading: "Pagamento não concluído",
    support: "Nenhum valor foi cobrado. Você pode tentar novamente.",
  },
  expired: {
    heading: "O código expirou",
    support: "Nenhum valor foi cobrado. Gere um novo código para continuar.",
  },
  awaitingTimedOut: {
    heading: "Ainda não recebemos a confirmação",
    support:
      "Se você já pagou, o pedido é confirmado assim que a operadora avisar — " +
      "não pague de novo. Você pode fechar esta tela.",
  },
  retryAction: "Tentar novamente",
  regenerateAction: "Gerar novo código",
  backAction: "Voltar ao cardápio",
  amountLabel: "Valor pago",
  referenceLabel: "Pedido",
  receiptEmailLabel: "Comprovante enviado para",
};

export const PT_BR_CHECKOUT_VIEW_COPY: CheckoutViewCopy = {
  steps: {
    dados: "Dados",
    payment: "Pagamento",
    status: "Confirmação",
  },
  dados: {
    saveProfile: "Salvar meus dados para a próxima compra",
    cannotContinueTitle: "Não foi possível continuar",
    continueAction: "Continuar",
    secureNotice: "Pagamento seguro",
    keepShopping: "Continuar comprando",
    back: "Voltar",
  },
  emptyCart: {
    title: "Seu carrinho está vazio.",
    action: "Ver cardápio",
  },
  status: PT_BR_PAYMENT_STATUS_COPY,
};
