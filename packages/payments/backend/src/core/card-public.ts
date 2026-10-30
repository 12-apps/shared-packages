/**
 * The card questions a host may ask outside a charge walk — its own module
 * because `src/index.ts` is at the size gate. The instrument questions
 * (FUT-760), debit's 3-D Secure session (FUT-3754), and which link of the
 * chain a card belongs to (FUT-3138).
 */
export { attributedCard, chainTokenizesInBrowser, holdsInstrumentFor } from './card-instrument';
export { debitSessionFor } from './debit-session';
export { cardProviderFor } from './method-head';
export type { CardFunding, DebitCapability, ThreeDSecureSession } from './card-funding';
