import { isAccountAccessError } from '../core/error-readers';
import type { ProviderRequestError } from '../core/errors';
import type { MerchantRef } from '../core/types';

import type { ProviderConfigStore } from './types';

/**
 * Best-effort: mark the merchant's connection FAILED after an account-level
 * rejection on a charge (see `isAccountAccessError`), so the settings screen
 * surfaces the outage instead of a stale VERIFIED — which is exactly how the
 * first production outage stayed invisible (ported from the future-pay host,
 * FUT-761).
 *
 * The FAILED row must belong to the provider that REFUSED — the error names
 * it (FUT-697); a default would mark a bystander's connection FAILED whenever
 * another provider rejected the merchant's account. Only an ENABLED
 * connection is downgraded: it is the one serving charges, and a disabled
 * row's failure says nothing about the merchant (in dev the charge may have
 * used an env fallback). Never throws — bookkeeping must not mask the
 * original charge failure. `logError` because this package binds no logger.
 */
export async function downgradeOnAccountError(
  store: ProviderConfigStore,
  merchant: MerchantRef,
  error: unknown,
  logError: (line: string) => void,
): Promise<void> {
  if (!isAccountAccessError(error)) return;
  const provider = error.provider;
  const detail = accountRejectionDetail(error);
  logError(
    `[payments] account-level provider rejection for ${merchant.kind} ${merchant.id} ` +
      `(HTTP ${error.options.httpStatus ?? '?'}${detail ? `: ${detail}` : ''}) — ` +
      `marking the ${provider} connection FAILED so the settings screen surfaces it.`,
  );
  try {
    const stored = await store.get(merchant, provider);
    if (!stored?.enabled) return;
    await store.save(merchant, { ...stored, status: 'FAILED' });
  } catch (storeError) {
    logError(
      `[payments] could not downgrade the ${provider} connection status: ` +
        `${storeError instanceof Error ? storeError.message : String(storeError)}`,
    );
  }
}

/**
 * Codes + descriptions from the provider's parsed `error_messages` body
 * (PagBank's validation shape), best-effort — read structurally off
 * `options.body`, never regexed out of the message (the host used to parse
 * the message string, which broke on the body cap).
 */
function accountRejectionDetail(error: ProviderRequestError): string {
  const body = error.options.body;
  if (typeof body !== 'object' || body === null) return '';
  const reasons = (body as { error_messages?: unknown }).error_messages;
  if (!Array.isArray(reasons)) return '';
  return reasons
    .map((reason) => {
      const { code, description } = reason as { code?: unknown; description?: unknown };
      return [code, description].filter((part) => typeof part === 'string' && part !== '').join(' ');
    })
    .filter((line) => line !== '')
    .join('; ');
}
