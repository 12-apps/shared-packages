import type { ResolvedCredentials } from '../core/types';
import { basicAuth, providerFetch } from './http';

/**
 * Stone transport.
 *
 * Stone's modern online API surface IS Pagar.me v5 (Pagar.me is Stone's
 * payments technology), so that is what this adapter speaks. There is no
 * merchant-authorization OAuth anywhere in Stone's stack — Connect Stone,
 * Stone Online and the Partner Hub all authenticate with a key, and the
 * platform/marketplace model onboards stores as *recebedores* under the
 * platform's own key instead of having them authorize anything. Hence
 * `authMode: 'credentials'`: the store pastes its own secret key.
 *
 * Auth is HTTP Basic with the secret key as the USERNAME and an empty
 * password — not a bearer token, which is the usual first mistake.
 */

export const NAME = 'stone';

/**
 * The ONLY origin this adapter will send the merchant's secret to.
 *
 * Deliberately a constant with no credential-field override: a stored field
 * is tenant-supplied data, and honouring it here would mean a store admin
 * could name any origin and have us attach their Basic credential to a
 * request against it — credential exfiltration and SSRF in one. Pagar.me v5
 * uses this one host for test and live alike (the key prefix selects the
 * mode), so there is nothing an override would legitimately buy.
 */
const API_BASE = 'https://api.pagar.me/core/v5';

/** Pagar.me wants CPF/CNPJ as bare digits. */
export function documentDigits(taxId: string | null | undefined): string | undefined {
  const digits = (taxId ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

/** CPF is 11 digits; anything longer is a company. */
export function customerType(taxId: string | null | undefined): 'individual' | 'company' {
  return (documentDigits(taxId) ?? '').length > 11 ? 'company' : 'individual';
}

export async function stoneRequest<T>(
  path: string,
  credentials: ResolvedCredentials,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown; idempotencyKey?: string },
): Promise<T> {
  return providerFetch<T>(NAME, 'Stone', `${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: basicAuth(credentials.fields['secretKey'] ?? ''),
      // Pagar.me dedupes a retried create on this key.
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
