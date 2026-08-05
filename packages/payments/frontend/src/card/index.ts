/**
 * The shared card-entry surface: format/validate helpers, the form fields, and
 * the browser tokenizer. Moved here from `@12-apps/spa-shared` with the buyer
 * checkout (FUT-564) — the tokenization helpers follow the screens.
 *
 * Two consumers, on purpose. The storefront checkout takes a shopper's card;
 * the admin's provider activation takes the OWNER's card for a R$0,01 proof
 * charge (FUT-463). They must be the same form — a verification that exercised
 * a different path would prove nothing about the path a shopper takes.
 *
 * The form components render through the checkout's slot contract (`ui.tsx`),
 * so they carry no design system of their own: raw MUI by default, the host's
 * primitives when a `CheckoutComponentsProvider` sits above them.
 */

export {
  cvvLength,
  detectBrand,
  formatCardNumber,
  formatCvv,
  formatExpiry,
  onlyDigits,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardBrand,
} from "./format";

export { formatCpf, validateCpf } from "./cpf";

export { CardPayBar, NewCardForm, SavedCardsPicker } from "./fields";

export {
  tokenizeCard,
  tokenizeForCheckout,
  tokenizerFor,
  type CardTokenizationConfig,
  type CardTokenizer,
} from "./tokenize";

export { NEW_CARD, type CardDetails, type CardFieldErrors, type CardToken, type SavedCard } from "./types";
