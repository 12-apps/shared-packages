import { PT_BR_CARD_COPY } from "../../card/pt-BR";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "./screens-pt-BR";
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
  awaitingUnreachable: {
    heading: "Não conseguimos falar com o pagamento agora",
    support:
      "Continuamos tentando por aqui. Se você já pagou, não pague de novo — " +
      "o pedido é confirmado assim que a operadora avisar.",
  },
  /**
   * One refusal at a time, in the cardholder's own terms (FUT-1145).
   *
   * `UNKNOWN` is deliberately absent: with no recognised reason there is
   * nothing specific to say, and `failed` above is already that sentence.
   */
  declined: {
    INSUFFICIENT_FUNDS: {
      heading: "Não havia saldo ou limite",
      support: "Nenhum valor foi cobrado. Tente outro cartão.",
    },
    CARD_DECLINED: {
      heading: "Seu banco não autorizou o pagamento",
      support: "Nenhum valor foi cobrado. Tente outro cartão ou fale com o seu banco.",
    },
    INVALID_CARD: {
      heading: "Os dados do cartão não foram aceitos",
      support: "Nenhum valor foi cobrado. Confira o número, a validade e o CVV, ou use outro cartão.",
    },
    EXPIRED_CARD: {
      heading: "O cartão está vencido",
      support: "Nenhum valor foi cobrado. Use um cartão com a validade em dia.",
    },
    FRAUD_SUSPECTED: {
      heading: "O banco bloqueou esta compra por segurança",
      support: "Nenhum valor foi cobrado. Fale com o seu banco ou use outro cartão.",
    },
    PROVIDER_ERROR: {
      heading: "Não foi possível processar o pagamento agora",
      support: "Nenhum valor foi cobrado. Tente de novo em alguns instantes.",
    },
  },
  retryAction: "Tentar novamente",
  regenerateAction: "Gerar novo código",
  checkAgainAction: "Verificar de novo",
  notPaidAction: "Não consegui pagar",
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
  screens: PT_BR_CHECKOUT_SCREENS_COPY,
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
  pipeline: {
    loading: "Carregando…",
    // Keyed by the settlement method's id. The package registers PIX and CARD;
    // a host that registers another charged method adds its own line here.
    awaitingHandover: {
      PIX: "Abrindo o Pix…",
      CARD: "Abrindo o pagamento com cartão…",
    },
  },
};
