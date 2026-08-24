import type { ActivationCopy } from './copy';

/**
 * The en-US pack for the activation flow — a NAMED constant a host passes by
 * hand, never a default.
 *
 * `platformApproval` keeps its most important property: it says the block is
 * OURS to clear, not the store's. An owner who reads it as their own problem
 * goes looking for a setting that does not exist, and the sentence exists to
 * stop exactly that.
 */
export const EN_US_ACTIVATION_COPY: ActivationCopy = {
  connectFirst: 'Connect the account before verifying the charge.',
  noPaymentUrl: 'The provider returned no payment URL.',
  stillProcessing:
    'The previous test charge is still processing. Try again in a moment.',
  expired: 'The charge expired. We will generate another at no cost whenever you like.',
  instrumentDeclined:
    'The payment was declined by your payment method. Try another card, or pay by Pix.',
  chargeDeclined: (providerReason) => `The test charge was declined (${providerReason}).`,
  chargeNotApproved: (status) => `The test charge was not approved (${status}).`,
  awaitingPayment: 'Waiting for the payment.',
  unpollable: (providerName) => `Unknown provider: ${providerName}`,
  unreachable: (providerName) =>
    `We could not reach ${providerName} just now. Try again in a moment.`,
  platformApproval:
    'PagBank has not yet cleared this platform for real charges. That is ours to resolve, ' +
    'not your store\'s — our team is already on it and we will let you know as soon as it ' +
    'is cleared.',
};
