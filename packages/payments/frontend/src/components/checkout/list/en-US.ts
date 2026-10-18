import type { PaymentListCopy } from "./types";

/** The one-list Pagamento step's words, en-US (FUT-3591, FUT-3592). */
export const EN_US_PAYMENT_LIST_COPY: PaymentListCopy = {
  title: "How would you like to pay?",
  onlineHeading: "Pay now, in the app",
  doorHeading: "Pay on delivery",
  pix: { label: "Pix", hint: "Get a code to copy and paste" },
  card: {
    label: "Credit card",
    hintSaved: (card) => `${card} or another card`,
    hintNew: "Enter your card details",
  },
  googlePay: { label: "Google Pay", hint: "With the card saved in your Google account" },
  wallets: {
    heading: "Quick payment",
    googlePay: "Pay with Google Pay",
    applePay: "Pay with Apple Pay",
    or: "or choose how to pay",
  },
  handOff: {
    label: "Pix or card",
    hint: (provider) =>
      provider ? `You pay on ${provider}'s page and come back` : "You pay on the payment page and come back",
  },
  savedCard: (brand, last4) => `${brand ?? "Card"} ending ${last4}`,
  otherCard: "Another card",
  buyer: {
    cpf: "CPF",
    phone: "Mobile",
    name: "Name",
    email: "Email",
    why: (provider) => (provider ? `(${provider} asks for it to pay in the app)` : "(needed to pay in the app)"),
    cpfHint: (provider) => (provider ? `${provider} asks for it to pay in the app` : "needed to pay in the app"),
    keepSavedCpf: "Keep the saved CPF",
    cpfIncomplete: "A CPF has 11 digits.",
    phoneIncomplete: "The mobile number needs the area code and 9 digits.",
  },
  reasons: {
    choose: "Choose how to pay.",
    cpf: "Enter your CPF to pay in the app.",
    phone: "Enter your mobile number to pay in the app.",
    details: "Fill in your details to pay in the app.",
    chooseCard: "Choose the card.",
    cardDetails: "Fill in the card details.",
    repricing: "Updating the amount…",
  },
  actions: {
    choose: "Choose how to pay",
    card: "Pay",
    pix: "Create Pix",
    googlePay: "Pay with Google Pay",
    handOff: (provider) => (provider ? `Go to ${provider}` : "Go to payment"),
  },
  payer: (name) => `Paying as ${name} · CPF ✓`,
  payerChange: "Change",
  charging: (total, card) => `Paying ${total} with ${card ?? "the card entered"}…`,
  chargingCovered: "Confirming the order, paid with your balance…",
  amountDue: "Amount due",
  cancel: "Cancel",
  pixFace: {
    title: (total) => `Pay ${total} with Pix`,
    validUntil: (time) =>
      `Valid until ${time}. Copy the code and paste it in your bank app, under Pix copy and paste.`,
    showQr: "Show QR code (pay from another phone)",
    hideQr: "Hide QR code",
    changeMethod: "Change payment method",
    copyCode: "Copy Pix code",
    waiting: "Waiting for the Pix payment…",
  },
  handOffWaiting: (provider) => (provider ? `Waiting for ${provider}…` : "Waiting for the payment…"),
};
