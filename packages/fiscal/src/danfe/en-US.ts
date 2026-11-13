/**
 * The DANFE NFC-e's words in English — a named pack, for a host that shows the
 * paper to English readers (a preview, a support screen, a test). The paper a
 * Brazilian consumer receives is printed with `./pt-BR`: the Manual do DANFE
 * NFC-e fixes its legal phrases in Portuguese.
 */

import type { DanfeNfceLabels } from "./labels";

export const DANFE_NFCE_EN_US: DanfeNfceLabels = {
  cnpj: "CNPJ",
  stateRegistration: "IE",
  title: "Auxiliary Document of the Electronic Consumer Invoice",
  itemsHeader: "CODE DESCRIPTION QTY UN UNIT PRICE TOTAL",
  itemCount: "Total items",
  totalValue: "Total BRL",
  discounts: "Discounts BRL",
  amountDue: "Amount due BRL",
  paymentHeader: "PAYMENT METHOD / AMOUNT PAID BRL",
  change: "Change BRL",
  paymentMethods: {
    "01": "Cash",
    "02": "Check",
    "03": "Credit card",
    "04": "Debit card",
    "05": "Store credit",
    "10": "Food voucher",
    "11": "Meal voucher",
    "12": "Gift voucher",
    "13": "Fuel voucher",
    "15": "Bank slip",
    "16": "Bank deposit",
    "17": "Dynamic Pix",
    "18": "Bank transfer",
    "19": "Loyalty program",
    "20": "Static Pix",
    "90": "No payment",
    "99": "Other",
  },
  lookupByKey: "Look the access key up at",
  homologation: "ISSUED IN THE TEST ENVIRONMENT - NO FISCAL VALUE",
  contingency: "ISSUED IN CONTINGENCY",
  pendingAuthorization: "Pending authorisation",
  consumer: "CONSUMER",
  unidentifiedConsumer: "UNIDENTIFIED CONSUMER",
  number: "NFC-e no.",
  series: "Series",
  protocol: "Authorisation protocol:",
  authorizedAt: "Authorised at:",
  qrCaption: "Look it up with a QR code reader",
  approximateTaxes: "Total taxes (Federal Law 12.741/2012) BRL",
};
