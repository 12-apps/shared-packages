/**
 * The card questions a host may ask outside a charge walk — its own module
 * because `src/index.ts` is at the size gate. The instrument questions
 * (FUT-760) and debit's 3-D Secure session (FUT-3754).
 */
export { attributedCard, chainTokenizesInBrowser, holdsInstrumentFor } from './card-instrument';
export { debitSessionFor } from './debit-session';
export type { CardFunding, DebitCapability, ThreeDSecureSession } from './card-funding';
