import { ChargeDeclinedError, ProviderRequestError } from './errors';
import { isRequestTimeout, isTransportError } from './failover';
import type { PaymentsGateway } from './gateway';
import {
  type ProviderFailurePath,
  type ProviderFailureReporter,
  type ProviderFailureSeverity,
  isProviderEndpointFailure,
  reportProviderFailure,
} from './provider-failure';
import type { RefreshOptions } from './refresh-options';
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
  /** Opt-in per call: the caller owns the retry and reports a give-up itself. */
  quiet: (...args: A) => boolean = () => false,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await call(...args);
    } catch (error) {
      if (isProviderEndpointFailure(error) && !quiet(...args)) {
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

/**
 * The sweep's re-read (FUT-4268). A failure with NO HTTP answer is the
 * network's, retried five minutes later (every 15 s while young), so reporting
 * each one paged the store ~288 times a day per unreachable charge. The sweep
 * says how: `quiet` is not reported; `final` is reported once, under its own
 * path. An HTTP answer, and any caller that says nothing, keep `REFRESH`.
 */
function refreshGuarded<P extends string>(
  reporter: ProviderFailureReporter,
  call: PaymentsGateway<P>['refreshCharge'],
): PaymentsGateway<P>['refreshCharge'] {
  return async (merchant, provider, id, hints, options?: RefreshOptions) => {
    try {
      return await call(merchant, provider, id, hints, options);
    } catch (error) {
      const noAnswer = isTransportError(error) || isRequestTimeout(error);
      if (options?.transport && noAnswer) {
        if (options.transport === 'final') {
          reportProviderFailure(reporter, {
            path: 'REFRESH_ABANDONED', severity: 'warning', merchant, provider: providerOf(error, provider), reference: id, error,
          });
        }
      } else if (isProviderEndpointFailure(error)) {
        reportProviderFailure(reporter, {
          path: 'REFRESH',
          severity: error instanceof ChargeDeclinedError ? 'info' : 'warning',
          merchant,
          provider: providerOf(error, provider),
          reference: id,
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
    refreshCharge: refreshGuarded(reporter, gateway.refreshCharge),
    cancelCharge: guarded(reporter, 'CANCEL', 'error', gateway.cancelCharge, (merchant, provider, id) => ({
      merchant, provider, reference: id,
    })),
    captureCharge: guarded(reporter, 'CAPTURE', 'error', gateway.captureCharge, (merchant, provider, id) => ({
      merchant, provider, reference: id,
    })),
    refund: guarded(reporter, 'REFUND', 'error', gateway.refund, (merchant, provider, input) => ({
      merchant, provider, reference: input.providerChargeId,
    }), (_merchant, _provider, input) => input.retriedByCaller === true),
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
