/**
 * The wiring producer half (FUT-889), one `export *` from the root — the
 * activation/platform pattern: the root index is at the size gate, so the
 * explicit list lives here. Countable views over the two mounts (the mounts
 * themselves are unchanged) and the receipt-mailer seam; the manifests under
 * `../manifest` assemble these, and they are exported for hosts that wire by
 * hand.
 */

export {
  createWireMountPayments,
  type PaymentsWireRequest,
  type PaymentsWireRoute,
  type WireMountedPayments,
} from '../http/wire-view';
export {
  createWirePaymentFlows,
  type CheckoutWireRequest,
  type CheckoutWireRoute,
  type WirePaymentFlows,
} from '../checkout/wire-view';
export {
  createReceiptMailer,
  type PaymentsEmailMessage,
  type PaymentsEmailPort,
  type PaymentsReceipt,
  type PaymentsReceiptMailer,
  type ReceiptMailCopy,
  type ReceiptMailerOptions,
} from '../email/receipt';
