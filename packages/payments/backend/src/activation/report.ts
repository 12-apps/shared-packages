import {
  type ProviderFailurePath,
  type ProviderFailureReporter,
  type ProviderFailureSeverity,
  reportProviderFailure,
} from '../core/provider-failure';
import type { MerchantRef, ResolvedCredentials } from '../core/types';

/**
 * Activation's provider failures, reported (FUT-4074).
 *
 * The owner usually IS on the screen when the verification charge fails, and
 * reads the provider's words there — but a refund that silently did not happen,
 * a poll that cannot reach the provider and a nightly reconcile pass have no
 * screen at all. Every one goes through here so the host hears all of them the
 * same way. A decline answered as a RESULT (the card was refused) is NOT
 * reported: it is the owner's own card, shown to them verbatim, and no
 * provider failed.
 */
interface ActivationWhere {
  merchant: MerchantRef;
  provider: string;
  credentials?: Pick<ResolvedCredentials, 'environment'>;
}

export function reportActivationFailure(
  reporter: ProviderFailureReporter | undefined,
  where: ActivationWhere,
  path: ProviderFailurePath,
  detail: { error?: unknown; message?: string; reference?: string | null; severity?: ProviderFailureSeverity },
): void {
  reportProviderFailure(reporter, {
    path,
    merchant: where.merchant,
    provider: where.provider,
    environment: where.credentials?.environment ?? null,
    reference: detail.reference ?? null,
    ...(detail.severity ? { severity: detail.severity } : {}),
    ...(detail.error === undefined ? {} : { error: detail.error }),
    message: detail.message ?? null,
  });
}
