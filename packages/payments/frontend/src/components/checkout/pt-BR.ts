import { PT_BR_CARD_COPY } from "../../card/pt-BR";
import type { CheckoutCopy } from "./copy-context";
import type { CheckoutViewCopy, PaymentStatusCopy } from "./view-copy";

/**
 * The pt-BR pack — the exact sentences these views compiled in until 6.0.0,
 * now NAMED exports a host passes by hand, never defaults. The filename is
 * what exempts this file from the copy-portability gate: Portuguese may ship,
 * it may not be silent.
 */
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

/**
 * The words the checkout's deeper screens read from context — the card form,
 * its tokenizers, and the buyer-details step's own fields.
 *
 * Same rule as everything else in this file: a NAMED pack a host passes by
 * hand at the mount, never a default the package reaches for.
 */
export const PT_BR_CHECKOUT_COPY: CheckoutCopy = {
  card: PT_BR_CARD_COPY,
  buyer: {
    emailInvalid: "E-mail inválido.",
    emailRequired: "E-mail obrigatório.",
    nameRequired: "Nome obrigatório.",
    phoneRequired: "Telefone obrigatório.",
    fieldsHint: (names) =>
      names.length === 0
        ? "Nome, e-mail e telefone são opcionais — usados apenas para o comprovante."
        : `Informe seu ${names.join(", ")} (${names.length === 1 ? "obrigatório" : "obrigatórios"} ` +
          "para o pagamento). Os demais campos são opcionais — usados apenas para o comprovante.",
  },
};

export const PT_BR_CHECKOUT_VIEW_COPY: CheckoutViewCopy = {
  screens: PT_BR_CHECKOUT_COPY,
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
