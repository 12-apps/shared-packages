import type { ProviderCapabilities } from '../core/types';
import type { PagbankOptions } from './pagbank-payloads';
import { PARTIAL_REFUND_METHODS } from './pagbank-refund';

/** What PagBank can do. */
const capabilities: ProviderCapabilities = {
  methods: ['PIX', 'CARD'],
  // Both wallets ride the card charge as `card.wallet` (FUT-471/472).
  // Declared here — the single capability source — so the gateway skips a
  // wallet charge on any provider that never made this claim, and the
  // checkout gates its buttons on the same fact. Apple Pay additionally
  // needs the certificate round-trip (`applePay` below) completed for the
  // merchant account before a charge can authorize.
  wallets: ['GOOGLE_PAY', 'APPLE_PAY'],
  // DEBIT_CARD with PagBank's own 3-D Secure (FUT-3754); `debit` below
  // mints the browser's session.
  debit: true,
  savedCards: true,
  refunds: true,
  // Card refunds in part; Pix waits for a sandbox run (FUT-4571).
  partialRefunds: false,
  partialRefundMethods: PARTIAL_REFUND_METHODS,
  splits: false,
  webhooks: true,
  tokenization: 'PUBLIC_KEY',
  activationCharge: true,
  // Refuses `customer.email` equal to the receiving account's (40002).
  payerEmail: true,
  // `summary.refunded` on every captured charge it reads back (FUT-4951).
  refundReadBack: true,
};
const STUB_SPLIT_CAPABILITIES: ProviderCapabilities = { ...capabilities, splitArrangements: ['PIX_DINAMICO'] };

/**
 * An arrangement is declared only by the build that writes it (FUT-2239):
 * the dynamic QR PagBank mints, under `fiscalSplitFields: 'stub'`.
 */
export function pagbankCapabilities(options: PagbankOptions): ProviderCapabilities {
  return options.fiscalSplitFields === 'stub' ? STUB_SPLIT_CAPABILITIES : capabilities;
}
