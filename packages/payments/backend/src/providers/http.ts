import { ProviderRequestError } from '../core/errors';
import { isPreSendNetworkError } from '../core/failover';
import type { ProviderName } from '../core/types';

/**
 * Transport bits every live adapter shares, so each provider module can read
 * as pure request/response MAPPING (the split `pagbank-http.ts` established).
 *
 * The one rule this module exists to enforce, carried over from the PagBank
 * client: a charge POST retries ONLY on a pre-send network error, never on an
 * HTTP response. Retrying anything the server actually answered is how you
 * double-charge a buyer.
 */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Retry only failures PROVEN to predate transmission, so a retry can never
 * double-apply a charge.
 *
 * The test used to be `error instanceof TypeError`, which is not sufficient:
 * undici reports a headers/body timeout — where the request DID reach the
 * provider and the response was lost — as the very same `TypeError: fetch
 * failed` as a refused connection. Retrying that is precisely how a buyer
 * gets billed twice, so the decision now keys off the underlying cause code
 * via the shared classifier, and an unrecognized failure is not retried.
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

/** Best-effort JSON parse — a non-JSON error body is simply not structured. */
function parseJsonOrUndefined(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface ProviderHttpInit {
  method: HttpMethod;
  headers: Record<string, string>;
  /** Already-serialized body (JSON string or form encoding). */
  body?: string;
}

/**
 * One authenticated call: retry-on-pre-send-only, non-2xx mapped to a
 * `ProviderRequestError` carrying the HTTP status so adapters can branch on
 * 401/403/404 without parsing messages. 5xx is marked retriable — the caller
 * decides whether retrying is safe for THAT operation.
 */
export async function providerFetch<T>(
  provider: ProviderName,
  label: string,
  url: string,
  init: ProviderHttpInit,
): Promise<T> {
  return withNetworkRetry(async () => {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderRequestError(
        provider,
        `${label} ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
        {
          httpStatus: res.status,
          retriable: res.status >= 500,
          // Parsed when the provider sent JSON, so adapters can branch on a
          // structured error (a decline) instead of matching on the message.
          body: parseJsonOrUndefined(text),
        },
      );
    }
    // 204/empty bodies are legitimate for revoke/disconnect calls.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  });
}

/**
 * `application/x-www-form-urlencoded` with PHP-style bracket nesting —
 * what Stripe's API (and several Brazilian gateways' legacy surfaces) expect
 * for nested objects and arrays.
 */
export function formEncode(value: unknown, prefix = ''): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item, index) => formEncode(item, `${prefix}[${index}]`))
      .filter(Boolean)
      .join('&');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => formEncode(item, prefix ? `${prefix}[${key}]` : key))
      .filter(Boolean)
      .join('&');
  }
  return `${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`;
}

/** HTTP Basic credential header (`user:password` base64). */
export function basicAuth(user: string, password = ''): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}
