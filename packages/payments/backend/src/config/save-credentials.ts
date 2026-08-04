import type { SaveCredentialsInput, StoredProviderConfig } from './types';

/**
 * Writing a merchant's credentials, and deciding what that invalidates.
 *
 * Its own module because the DECISION is the subtle part, not the write.
 */

/** Apply preserve(undefined) / clear('') / replace(value) onto a field set. */
function applyFieldUpdates(
  current: Record<string, string>,
  updates: Record<string, string | undefined>,
): Record<string, string> {
  const next = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === '') delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Two credential sets, compared by key and value. */
function sameFields(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * Write the credentials and settle what survives the write.
 *
 * A save that CHANGES something still invalidates: `status` returns to
 * UNVERIFIED, the provider leaves the failover chain, and the activation proof
 * and the outstanding charge both go — because new keys may name a different
 * account, and neither an old proof nor an old payment link says anything
 * about it. That rule is load-bearing; `setEnabled` refuses without a proof,
 * which is what stops a swapped account being switched on for free.
 *
 * A save that changes NOTHING is exempt, and that exemption is the whole
 * point. Re-saving the same value is an ordinary thing to do — retyping a
 * handle, pressing Salvar twice, saving while looking at the same tab — and it
 * was erasing a R$1,01 the owner had already paid, along with the `slug` of
 * the checkout link that was the only way to confirm it. The screen's
 * remaining offer was to charge them again. It cost two real payments to find.
 *
 * Switching the ACTIVE environment is never a no-op: a different credential
 * set starts serving charges, and it has not proved itself.
 */
export function applySaveCredentials(
  config: StoredProviderConfig,
  input: SaveCredentialsInput,
  allowStubMode: boolean,
): StoredProviderConfig {
  const before = config.environments[input.environment];
  const after = applyFieldUpdates(before, input.fields);
  const unchanged = input.environment === config.environment && sameFields(before, after);

  config.environments[input.environment] = after;
  config.environment = input.environment;

  if (!unchanged) {
    config.status = 'UNVERIFIED';
    config.enabled = false;
    config.chargeVerifiedAt = null;
    config.pendingVerification = null;
  }

  // Stub mode is derived, never caller-supplied: on only when the deployment
  // allows it AND this is a SANDBOX config, so a PRODUCTION merchant can never
  // run fake charges.
  config.stub = allowStubMode && input.environment === 'SANDBOX';
  return config;
}
