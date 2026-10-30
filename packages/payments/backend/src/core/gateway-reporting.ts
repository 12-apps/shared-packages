import { ChargeDeclinedError, ProviderRequestError } from './errors';
import type { PaymentsGateway } from './gateway';
import {
  type ProviderFailurePath,
  type ProviderFailureReporter,
  type ProviderFailureSeverity,
  isProviderEndpointFailure,
  reportProviderFailure,
} from './provider-failure';
import type { MerchantRef } from './types';

/**
 * The gateway's FOLLOW-UP provider calls, reported (FUT-4074).
 *
 * The walk reports its own attempts from inside (`charge-context.ts`). These
 * are the other calls the gateway makes to a provider — re-reading a charge,
 * voiding one, refunding, the vault — whose callers often swallow the error
 * on purpose: the pending-charge sweep and the buyer's status poll retry on
 * the next tick, and voiding a superseded code is best-effort. Best-effort is
 * right for the buyer and wrong for the owner, who never heard the provider
 * was refusing. So the failure is reported HERE, once, whatever the caller
 * then does with it, and rethrown untouched.
 *
 * Only the PROVIDER's failures are reported (see `isProviderEndpointFailure`):
 * "not connected" and "cannot void" are states, not refusals, and a database
 * error is not the provider's.
 */

interface Where {
  merchant: MerchantRef;
  provider: string | null;
  reference: string | null;
}

/** The provider the error names, else the one the call named. */
function providerOf(error: unknown, named: string | null): string {
  if (error instanceof ProviderRequestError || error instanceof ChargeDeclinedError) return error.provider;
  return named ?? 'unknown';
}

function guarded<A extends unknown[], R>(
  reporter: ProviderFailureReporter,
  path: ProviderFailurePath,
  severity: ProviderFailureSeverity,
  call: (...args: A) => Promise<R>,
  where: (...args: A) => Where,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await call(...args);
    } catch (error) {
      if (isProviderEndpointFailure(error)) {
        const { merchant, provider, reference } = where(...args);
        reportProviderFailure(reporter, {
          path,
          // A re-read is retried by its caller on the next tick and the webhook
          // is the primary path: worth knowing, not worth paging anyone.
          severity: error instanceof ChargeDeclinedError ? 'info' : severity,
          merchant,
          provider: providerOf(error, provider),
          reference,
          error,
        });
      }
      throw error;
    }
  };
}

/** Wrap the gateway's follow-up calls; the walk is not touched here. */
export function withProviderFailureReports<P extends string>(
  reporter: ProviderFailureReporter | undefined,
  gateway: PaymentsGateway<P>,
): PaymentsGateway<P> {
  if (!reporter) return gateway;
  return {
    ...gateway,
    refreshCharge: guarded(reporter, 'REFRESH', 'warning', gateway.refreshCharge, (merchant, provider, id) => ({
      merchant, provider, reference: id,
    })),
    cancelCharge: guarded(reporter, 'CANCEL', 'error', gateway.cancelCharge, (merchant, provider, id) => ({
      merchant, provider, reference: id,
    })),
    captureCharge: guarded(reporter, 'CAPTURE', 'error', gateway.captureCharge, (merchant, provider, id) => ({
      merchant, provider, reference: id,
    })),
    refund: guarded(reporter, 'REFUND', 'error', gateway.refund, (merchant, provider, input) => ({
      merchant, provider, reference: input.providerChargeId,
    })),
    beginVault: guarded(reporter, 'VAULT', 'error', gateway.beginVault, (merchant, input, provider) => ({
      merchant, provider: provider ?? null, reference: input.reference,
    })),
    completeVault: guarded(reporter, 'VAULT', 'error', gateway.completeVault, (merchant, input, provider) => ({
      merchant, provider: provider ?? null, reference: input.reference,
    })),
    forgetVault: guarded(reporter, 'VAULT', 'warning', gateway.forgetVault, (merchant, provider) => ({
      merchant, provider, reference: null,
    })),
  };
}
