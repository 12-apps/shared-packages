import type { PaymentListCopy } from "./types";

/**
 * The article a provider's name takes in a pt-BR sentence — "o PagBank", "a
 * InfinitePay". The names are the chain's own `displayName`s; one this table
 * has never seen reads as a company ("a empresa"), which is the safer default.
 */
const MASCULINE = new Set(["PagBank", "PagSeguro", "Stripe", "Itaú", "Mercado Pago"]);

function the(provider: string): string {
  return `${MASCULINE.has(provider) ? "o" : "a"} ${provider}`;
}

/** "da InfinitePay" / "do PagBank". */
function of(provider: string): string {
  return `${MASCULINE.has(provider) ? "do" : "da"} ${provider}`;
}

/** The one-list Pagamento step's words, pt-BR (FUT-3591, FUT-3592). */
export const PT_BR_PAYMENT_LIST_COPY: PaymentListCopy = {
  title: "Como você quer pagar?",
  onlineHeading: "Pagar agora, pelo app",
  doorHeading: "Pagar na entrega",
  pix: { label: "Pix", hint: "Gera o código para copiar e colar" },
  card: {
    label: "Cartão de crédito",
    hintSaved: (card) => `${card} ou outro cartão`,
    hintNew: "Digite os dados do cartão",
  },
  googlePay: { label: "Google Pay", hint: "Com o cartão salvo no seu Google" },
  wallets: {
    heading: "Pagamento rápido",
    googlePay: "Pagar com Google Pay",
    applePay: "Pagar com Apple Pay",
    or: "ou escolha como pagar",
  },
  handOff: {
    label: "Pix ou cartão",
    hint: (provider) =>
      provider ? `Você paga na página ${of(provider)} e volta` : "Você paga na página de pagamento e volta",
  },
  savedCard: (brand, last4) => `${brand ?? "Cartão"} final ${last4}`,
  otherCard: "Outro cartão",
  buyer: {
    cpf: "CPF",
    phone: "Celular",
    name: "Nome",
    email: "E-mail",
    why: (provider) => (provider ? `(${the(provider)} pede para pagar pelo app)` : "(pedido para pagar pelo app)"),
    cpfHint: (provider) => (provider ? `${the(provider)} pede para pagar pelo app` : "pedido para pagar pelo app"),
    keepSavedCpf: "Manter o CPF salvo",
    cpfIncomplete: "O CPF tem 11 dígitos.",
    phoneIncomplete: "O celular precisa de DDD e 9 dígitos.",
  },
  reasons: {
    choose: "Escolha como pagar.",
    cpf: "Digite seu CPF para pagar pelo app.",
    phone: "Digite seu celular para pagar pelo app.",
    details: "Preencha seus dados para pagar pelo app.",
    chooseCard: "Escolha o cartão.",
    cardDetails: "Preencha os dados do cartão.",
    repricing: "Atualizando o valor…",
  },
  actions: {
    choose: "Escolha como pagar",
    card: "Pagar",
    pix: "Gerar Pix",
    googlePay: "Pagar com Google Pay",
    handOff: (provider) => (provider ? `Ir para ${the(provider)}` : "Ir para o pagamento"),
  },
  payer: (name) => `Pagando como ${name} · CPF ✓`,
  payerChange: "Alterar",
  charging: (total, card) => `Pagando ${total} no ${card ?? "cartão informado"}…`,
  chargingCovered: "Confirmando o pedido, pago com o seu saldo…",
  cancel: "Cancelar",
  pixFace: {
    title: (total) => `Pague ${total} com Pix`,
    validUntil: (time) =>
      `Válido até ${time}. Copie o código e cole no app do seu banco, em Pix copia e cola.`,
    showQr: "Ver QR code (pagar de outro celular)",
    hideQr: "Esconder QR code",
    changeMethod: "Trocar a forma de pagamento",
    copyCode: "Copiar código Pix",
    waiting: "Aguardando o pagamento do Pix…",
  },
  handOffWaiting: (provider) => (provider ? `Aguardando ${the(provider)}…` : "Aguardando o pagamento…"),
};
