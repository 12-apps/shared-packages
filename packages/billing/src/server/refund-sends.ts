import {
  CredentialsError,
  refundRefusalOf,
  UnsupportedOperationError,
  type RefundSnapshot,
} from "@12-apps/payments-backend";

import type { RefundablePayment, RefundablePaymentStore, SubscriptionRefundDeps } from "./refund-ports";

/**
 * Which refund a charge read saw land, on a payment a person said was never
 * refunded (FUT-4864): the binding records every second send to the host
 * before it is made, and takes the record back when the provider's answer
 * proves nothing moved.
 */

type SendingGateway = Awaited<ReturnType<SubscriptionRefundDeps["payments"]>>["gateway"];

/**
 * The money a charge read sees back on a payment reopened NOT_RETURNED is the
 * refund said never returned — unless a second refund was sent since, when it
 * may be either: then no id is recorded, and that refund's late word is a
 * double return.
 */
export function adoptedRefundId(payment: RefundablePayment | null): string | null {
  return payment?.notReturnedRefundId && !payment.sentAgain ? payment.notReturnedRefundId : null;
}

/**
 * A send whose answer proves no money moved: a FAILED snapshot, an answered
 * refusal, or a refusal before dispatch. A success, PENDING, "not yet" or no
 * verdict (a timeout, a 5xx) may have moved money.
 */
function movedNothing(error: unknown): boolean {
  return error instanceof UnsupportedOperationError || error instanceof CredentialsError || refundRefusalOf(error) === "REFUSED";
}

/**
 * The gateway, telling the host before every refund it sends (`sendingAgain`)
 * and taking it back when the answer proves nothing moved (`sentNothing`).
 */
export function recordingSends(gateway: SendingGateway, store: RefundablePaymentStore, now: () => Date): SendingGateway {
  return {
    refreshCharge: (...args) => gateway.refreshCharge(...args),
    refund: async (merchant, provider, input) => {
      const at = now();
      await store.sendingAgain(provider, input.providerChargeId, at);
      let snapshot: RefundSnapshot;
      try {
        snapshot = await gateway.refund(merchant, provider, input);
      } catch (error) {
        if (movedNothing(error)) await store.sentNothing(provider, input.providerChargeId, at);
        throw error;
      }
      if (snapshot.status === "FAILED") await store.sentNothing(provider, input.providerChargeId, at);
      return snapshot;
    },
  };
}
