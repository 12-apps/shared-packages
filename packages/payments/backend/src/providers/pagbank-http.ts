import { ProviderRequestError, type ProviderRequestSnapshot } from '../core/errors';
import { isPreSendNetworkError } from '../core/failover';
import type { CustomerInfo, CustomerSchema, ResolvedCredentials } from '../core/types';

/**
 * PagBank Orders API transport — the bits every call shares, kept apart from
 * the adapter so the adapter reads as pure request/response MAPPING.
 *
 * The one rule this module exists to enforce: a charge POST retries ONLY on a
 * pre-send network error, never on an HTTP response, and always carries
 * `x-idempotency-key`. Retrying anything the server actually answered is how
 * you double-charge a buyer.
 */

export const NAME = 'pagbank';

/** Sandbox is the safe default: a misconfigured deploy must never hit live. */
const SANDBOX_API_BASE = 'https://sandbox.api.pagseguro.com';
const PRODUCTION_API_BASE = 'https://api.pagseguro.com';

/**
 * Chosen by the RESOLVED ENVIRONMENT only. There is deliberately no
 * credential-field override: that field is tenant-supplied data, and
 * honouring it would let a store admin point an authenticated, token-bearing
 * request at any origin they like.
 */
function apiBaseFor(credentials: ResolvedCredentials): string {
  return credentials.environment === 'PRODUCTION' ? PRODUCTION_API_BASE : SANDBOX_API_BASE;
}

/** PagBank wants the CPF/CNPJ as bare digits. */
function taxIdDigits(taxId: string | null | undefined): string | undefined {
  const digits = (taxId ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

/** One entry of the order's `customer.phones` array. */
interface PagBankPhone {
  country: string;
  area: string;
  number: string;
}

/**
 * Split a free-text phone into PagBank's `{country, area, number}` (FUT-488).
 *
 * `customer.phones` is OPTIONAL — contrary to the ticket, `reference/criar-pedido`
 * marks only `customer.tax_id` required. What IS mandatory is conditional: the
 * schema's item requires `["country","area","number"]`, so a partial entry is
 * worse than no entry. Hence all-or-nothing — anything we cannot split into all
 * three parts yields `undefined` and the array is omitted entirely.
 *
 * `type` is deliberately not sent. It appears in PagBank's request EXAMPLES but
 * not in the request schema's item properties, and we would be guessing it from
 * digit count; sending only the three documented fields asserts nothing we
 * cannot support.
 *
 * Brazil-only by construction, which the rest of this checkout already is (CPF,
 * PIX). Length is what disambiguates, and it does so cleanly: a local number is
 * at most 9 digits and a DDD is exactly 2, so 10–11 digits cannot carry a
 * country code and 12–13 must. That keeps DDD 55 (Santa Maria/RS) working
 * rather than being eaten as a duplicate DDI.
 */
function customerPhones(phone: string | null | undefined): PagBankPhone[] | undefined {
  const trimmed = (phone ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  // A leading `+` is an EXPLICIT country code and has to be honoured, not
  // stripped: `+1 415 555 0100` is eleven digits, exactly like a Brazilian
  // mobile, so dropping the `+` first turns a US number into DDD 14.
  const prefixed = trimmed.startsWith('+') || digits.length === 12 || digits.length === 13;
  if (prefixed && !digits.startsWith('55')) return undefined;
  const local = prefixed ? digits.slice(2) : digits;
  // 2-digit DDD + an 8-digit landline or 9-digit mobile. Anything else is not
  // a Brazilian phone we can split into all three parts, so nothing is sent.
  if (local.length < 10 || local.length > 11) return undefined;
  return [{ country: '55', area: local.slice(0, 2), number: local.slice(2) }];
}

/**
 * The order's `customer` block, identical for PIX and card.
 *
 * Built in one place because it is one thing: both payloads previously spelled
 * out the same three fields, so `phones` would have had to be added — and kept
 * in step — twice.
 */
export function customerPayload(customer: CustomerInfo) {
  return {
    name: customer.name || undefined,
    email: customer.email || undefined,
    tax_id: taxIdDigits(customer.taxId),
    phones: customerPhones(customer.phone),
  };
}

/**
 * What PagBank asks of the buyer (FUT-595), straight from the
 * `reference/criar-pedido` schema: `customer.tax_id` is the ONLY required
 * customer field. `phones` is optional — and conditional when present (all
 * three parts or nothing, see {@link customerPhones}) — and name/e-mail are
 * optional pre-fill, not demands. Declaring name/e-mail required here is
 * exactly the bug this schema replaces: buyers were asked for fields no
 * provider needs while the CPF PagBank refuses without stayed "optional".
 * Lives beside {@link customerPayload}, whose wire behaviour it describes.
 */
export const customerSchema: CustomerSchema = [
  { key: 'name', type: 'NAME', required: false },
  { key: 'email', type: 'EMAIL', required: false },
  { key: 'taxId', type: 'CPF', required: true },
  { key: 'phone', type: 'PHONE', required: false },
];

/**
 * PagBank caps `notification_urls` at 150 chars, so no shared secret goes in
 * the URL — authenticity is verified from the `x-authenticity-token` header
 * instead (see `webhook.verify`).
 */
export function notificationUrls(credentials: ResolvedCredentials): string[] | undefined {
  const url = credentials.fields['notificationUrl'];
  return url ? [url] : undefined;
}

/**
 * Retry only failures PROVEN to predate transmission.
 *
 * The old test here was `error instanceof TypeError`, which is not enough:
 * undici reports a headers/body timeout — where the request DID reach PagBank
 * and only the response was lost — as the same `TypeError: fetch failed` as a
 * refused connection. Retrying that is how a buyer gets billed twice, so the
 * decision keys off the underlying cause code via the shared classifier.
 */
async function withNetworkRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isPreSendNetworkError(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * What replaces a secret in a captured request. The same literal the (now
 * removed) homologação anexo used, so a pair pasted into a support ticket
 * reads the way PagBank has already seen one from us.
 */
const REDACTED = '***REDACTED***';

/**
 * Keys whose VALUE is the payment instrument itself. `encrypted` is the
 * browser-encrypted PAN blob and `id` under a `card` object is the vault
 * token — either one is enough to charge with, so neither may be written
 * anywhere, redacted in place so the pair still shows the field was sent.
 */
function redactCard(value: unknown, insideCard = false): unknown {
  if (Array.isArray(value)) return value.map((item) => redactCard(item, insideCard));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (key === 'encrypted' || (insideCard && key === 'id')) return [key, REDACTED];
      return [key, redactCard(child, key === 'card')];
    }),
  );
}

/**
 * The request as evidence — redacted, and built ONLY on the failure path.
 * A successful charge's body is noise and a standing PII surface; a refused
 * one is the thing support asks for.
 */
function snapshotOf(
  url: string,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): ProviderRequestSnapshot {
  return {
    method: init.method,
    url,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // Never the real token. It is not captured and then hidden — it is
      // never read into the snapshot at all.
      Authorization: `Bearer ${REDACTED}`,
      ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : redactCard(init.body),
  };
}

export async function pagbankRequest<T>(
  path: string,
  credentials: ResolvedCredentials,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<T> {
  const url = `${apiBaseFor(credentials)}${path}`;
  return withNetworkRetry(async () => {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.fields['token'] ?? ''}`,
        ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderRequestError(
        NAME,
        // The 300-char cap stays on the MESSAGE, which is matched on and shown
        // to people. The untruncated body goes to `body` below — truncation is
        // what made the original HTTP 502 undiagnosable, and the pair is worth
        // nothing if the half that explains it is cut off.
        `PagBank ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
        {
          httpStatus: res.status,
          retriable: res.status >= 500,
          body: parseJson(text),
          request: snapshotOf(url, init),
        },
      );
    }
    return (await res.json()) as T;
  });
}

/** The response as PagBank meant it, falling back to the raw text. */
function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

