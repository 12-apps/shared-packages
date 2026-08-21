/**
 * `@12-apps/payments-backend/manifest/server` — the server capabilities.
 *
 * A FUNCTION where most siblings export a constant, for auth's reason: the
 * `email` capability is `createMailer(port) → mailer`, the port is all a
 * host supplies at bind time, and the receipt mailer needs the one thing the
 * port cannot carry — whose WORDS the mail reads in. A constant would bake a
 * language, which is the defaulting this package refuses everywhere else,
 * so the copy is chosen where every other choice is made: at the call, by
 * name.
 *
 * `http.create` is `createWireMountPayments` (`../http/wire-view`):
 * `mountPayments` unchanged underneath, plus the countable row view the
 * aggregate needs. `jobs` is `PAYMENTS_JOBS`, unchanged. The BUYER surface
 * ships as its own manifest below — the mount module's own doc argues why
 * the two tables must never merge, and two manifests is what the contract
 * calls that (the auth-platform split): a host binds each behind its own
 * gate, and a version bump can never widen one mount with the other's rows.
 *
 * Untyped like `./index` — see there for why the wiring contract cannot be
 * imported here and where the producer assertions run instead.
 */

import { createWirePaymentFlows } from '../checkout/wire-view';
import { createReceiptMailer, type PaymentsEmailPort, type ReceiptMailCopy } from '../email/receipt';
import { createWireMountPayments } from '../http/wire-view';
import { PAYMENTS_JOBS } from '../jobs';

export interface PaymentsServerManifestOptions {
  /** Which words the receipt mail reads in — REQUIRED, the host's choice. */
  receiptCopy: ReceiptMailCopy;
}

/** The merchant-admin (library) surface, the sweeps and the receipt mailer. */
export function paymentsBackendServerManifest(options: PaymentsServerManifestOptions): {
  name: string;
  http: { create: typeof createWireMountPayments };
  jobs: typeof PAYMENTS_JOBS;
  email: { createMailer: (port: PaymentsEmailPort) => ReturnType<typeof createReceiptMailer> };
} {
  return {
    name: '@12-apps/payments-backend',
    http: { create: createWireMountPayments },
    jobs: PAYMENTS_JOBS,
    email: {
      createMailer: (port) => createReceiptMailer({ deliver: port, copy: options.receiptCopy }),
    },
  };
}

/** The BUYER surface: every row runs as the buyer, behind the buyer's gate. */
export const paymentsCheckoutServerManifest = {
  name: '@12-apps/payments-checkout',
  http: { create: createWirePaymentFlows },
} as const;
