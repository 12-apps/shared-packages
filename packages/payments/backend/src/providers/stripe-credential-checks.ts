import type { ProbeCheck, ResolvedCredentials } from '../core/types';
import type { StripeCredentialCopy } from './copy';

/**
 * What "Testar conexão" can actually establish about a Stripe connection,
 * credential by credential (FUT-796).
 *
 * The probe used to be a bare `GET /v1/balance`. That authenticates the SECRET
 * KEY and nothing else, so a store pasting its own keys got a green result that
 * said nothing about the publishable key the browser tokenizes with, nothing
 * about the signing secret that authenticates deliveries, and nothing about
 * whether Stripe will let the account take money at all. Each of those fails
 * later instead — at checkout, at a webhook, or at the first payout — where it
 * looks like a different problem.
 *
 * Three verdicts rather than two, because the credentials genuinely differ in
 * how knowable they are: one is proven by an authenticated call, one can be
 * checked for agreement but not authenticity, and one cannot be checked at all.
 * Collapsing that last case into a pass is the failure this replaces.
 */

/** The Stripe account a key resolves to — what `GET /v1/account` answers. */
export interface StripeAccountFacts {
  id?: unknown;
  charges_enabled?: unknown;
  payouts_enabled?: unknown;
}

/**
 * Which mode a Stripe key is for, read from its own prefix.
 *
 * Every Stripe key states this about itself — `sk_live_`, `pk_test_`, and the
 * restricted `rk_` variants — which is what makes the agreement checks below
 * possible with no extra call. `null` for a key whose prefix we do not
 * recognise: an unknown shape is not evidence of a mismatch.
 */
function liveModeOf(key: string): boolean | null {
  if (/^(sk|pk|rk)_live_/.test(key)) return true;
  if (/^(sk|pk|rk)_test_/.test(key)) return false;
  return null;
}

/** The environment this connection charges in, as a key prefix would state it. */
function expectedLiveMode(credentials: ResolvedCredentials): boolean {
  return credentials.environment === 'PRODUCTION';
}

/**
 * The key charges authenticate as: the OAuth grant's token, or a pasted secret
 * key. `apiKeyOf` resolves them in this order and so must this — a probe that
 * reported on a stale pasted key would describe a credential nothing uses.
 */
function apiKeyFieldOf(credentials: ResolvedCredentials): { key: string; value: string } {
  const accessToken = credentials.fields['accessToken'];
  if (accessToken) return { key: 'secretKey', value: accessToken };
  return { key: 'secretKey', value: credentials.fields['secretKey'] ?? '' };
}

/**
 * The secret key, proven by the account it resolved to — and the account's own
 * answer about whether it can take money.
 *
 * `charges_enabled: false` is a FAIL rather than a note. Stripe requires the
 * business documents before it releases charging, and until it does, every
 * checkout on this connection is refused — so a probe reporting success there
 * is the precise shape of "a success that does not predict a working checkout".
 */
function secretKeyCheck(
  copy: StripeCredentialCopy,
  credentials: ResolvedCredentials,
  account: StripeAccountFacts,
): ProbeCheck {
  const { key, value } = apiKeyFieldOf(credentials);
  const accountId = typeof account.id === 'string' ? account.id : null;
  // The one FACT the sentence turns on, passed as a fact: a grant and a pasted
  // key are the same credential to Stripe and two different nouns to an owner.
  const viaGrant = Boolean(credentials.fields['accessToken']);

  if (account.charges_enabled === false) {
    return { key, status: 'FAIL', message: copy.chargesDisabled(viaGrant, accountId) };
  }

  const mode = liveModeOf(value);
  const wanted = expectedLiveMode(credentials);
  if (mode !== null && mode !== wanted) {
    return {
      key,
      status: 'FAIL',
      message: copy.secretKeyModeMismatch(viaGrant, { key: mode, connection: wanted }),
    };
  }

  return {
    key,
    status: 'PASS',
    message: accountId
      ? copy.secretKeyResolved(viaGrant, accountId)
      : copy.secretKeyAccepted(viaGrant),
  };
}

/**
 * The publishable key, which no endpoint will validate — but which CAN be
 * checked for the two disagreements that actually happen: a key that is not a
 * publishable key at all, and a test key beside a live secret key.
 *
 * That second one is the classic, and it is invisible until a buyer types a
 * card: the browser mints a token in the wrong mode and Stripe refuses the
 * charge with an error about the token, not about the key.
 */
function publishableKeyCheck(
  copy: StripeCredentialCopy,
  credentials: ResolvedCredentials,
): ProbeCheck {
  const key = 'publishableKey';
  const value = credentials.fields[key];
  if (!value) return { key, status: 'FAIL', message: copy.publishableKeyMissing };
  if (!value.startsWith('pk_')) {
    return { key, status: 'FAIL', message: copy.publishableKeyShape };
  }
  const mode = liveModeOf(value);
  const wanted = expectedLiveMode(credentials);
  if (mode !== null && mode !== wanted) {
    return {
      key,
      status: 'FAIL',
      message: copy.publishableKeyModeMismatch({ key: mode, connection: wanted }),
    };
  }
  return { key, status: 'PASS', message: copy.publishableKeyOk(wanted) };
}

/**
 * The webhook signing secret: shape only, and said so.
 *
 * Stripe publishes no way to ask whether a signing secret is the right one —
 * you learn that when a delivery fails to verify. `UNCHECKED` is the honest
 * verdict, and it is more useful than a green tick: it tells the owner which
 * part of a passing probe they may NOT rely on.
 */
function webhookSecretCheck(
  copy: StripeCredentialCopy,
  credentials: ResolvedCredentials,
): ProbeCheck {
  const key = 'webhookSecret';
  const value = credentials.fields[key] || credentials.fields['platformWebhookSecret'];
  if (!value) {
    const viaGrant = Boolean(credentials.fields['accessToken']);
    return {
      key,
      status: viaGrant ? 'UNCHECKED' : 'FAIL',
      message: viaGrant ? copy.webhookSecretViaGrant : copy.webhookSecretMissing,
    };
  }
  if (!value.startsWith('whsec_')) {
    return { key, status: 'FAIL', message: copy.webhookSecretShape };
  }
  return { key, status: 'UNCHECKED', message: copy.webhookSecretShapeOnly };
}

/**
 * The connected account id, when the owner filled it in: it must be the account
 * the key actually resolves to.
 *
 * A mismatch here is not cosmetic — it is the field that decides which account
 * a platform-key charge is made on behalf of, and it is also what binds inbound
 * webhooks to this store.
 */
function connectedAccountCheck(
  copy: StripeCredentialCopy,
  credentials: ResolvedCredentials,
  account: StripeAccountFacts,
): ProbeCheck | null {
  const key = 'connectedAccountId';
  const declared = credentials.fields[key];
  if (!declared) return null;
  const resolved = typeof account.id === 'string' ? account.id : null;
  if (resolved && declared !== resolved) {
    return { key, status: 'FAIL', message: copy.connectedAccountMismatch(resolved, declared) };
  }
  return { key, status: 'PASS', message: copy.connectedAccountOk(declared) };
}

/** Every verdict this adapter can produce, for one resolved connection. */
export function stripeCredentialChecks(
  copy: StripeCredentialCopy,
  credentials: ResolvedCredentials,
  account: StripeAccountFacts,
): ProbeCheck[] {
  const connected = connectedAccountCheck(copy, credentials, account);
  return [
    secretKeyCheck(copy, credentials, account),
    publishableKeyCheck(copy, credentials),
    webhookSecretCheck(copy, credentials),
    ...(connected ? [connected] : []),
  ];
}

/**
 * The one sentence the screen leads with, composed from the findings.
 *
 * Named after the FIELDS that failed rather than summarised, because "confira
 * as credenciais" is advice an owner can follow all afternoon: with four
 * credentials on the form, which one is wrong IS the answer.
 */
export function stripeChecksSummary(
  copy: Pick<StripeCredentialCopy, 'severalFailed'>,
  checks: readonly ProbeCheck[],
): string | undefined {
  const failed = checks.filter((check) => check.status === 'FAIL');
  if (failed.length === 0) return undefined;
  // One failure speaks for itself; several need naming, and the first one's
  // sentence is still the most actionable thing to lead with.
  return failed.length === 1
    ? failed[0]!.message
    : copy.severalFailed(failed.length, failed[0]!.message);
}
