import type { CheckoutLogger, CheckoutResponder } from '../checkout/types';
import type { MerchantRef } from '../core/types';

import type { ApplePayIdentityPort, ApplePayValidationRefusalCode } from './types';
import {
  ApplePayValidationError,
  validateApplePayMerchant,
  type ApplePayValidationDeps,
} from './validate';

/**
 * Apple Pay merchant validation, MOUNTED (FUT-3686) — one route, no host logic.
 *
 * ```ts
 * // e.g. app/api/checkout/apple-pay/merchant-session/route.ts
 * export const { POST } = createApplePayMerchantValidation({
 *   identity: applePayIdentities,               // the credentials port
 *   resolveMerchant: (request) => storeMerchantOf(request),
 * });
 * ```
 *
 * The page posts `{ validationURL }` (the one Safari handed it). The domain
 * Apple is asked about is the page's own, read off the browser-set `Origin`
 * header; a `domain` in the body is used only when no `Origin` came, and must
 * agree with it when both did.
 *
 * | outcome | status | body |
 * | --- | --- | --- |
 * | validated | 200 | `{ data: <merchant session> }` — opaque, pass it to `completeMerchantValidation` |
 * | `BAD_REQUEST` (incl. a body over 4 KB) / `INVALID_VALIDATION_URL` / `INVALID_DOMAIN` | 400 | `{ error, code }` |
 * | `APPLE_PAY_NOT_CONFIGURED` | 409 | `{ error, code }` |
 * | `IDENTITY_UNAVAILABLE` / `IDENTITY_UNUSABLE` | 503 | `{ error, code }` |
 * | `UNREACHABLE` / `UPSTREAM_REFUSED` / `INVALID_RESPONSE` | 502 | `{ error, code }` |
 * | `TIMEOUT` | 504 | `{ error, code }` |
 *
 * A refusal carries its CODE and no sentence: nothing here is read by a buyer
 * (Safari closes the sheet), so `error` repeats the code rather than inventing
 * copy, and Apple's own answer never reaches the browser. The operator detail
 * goes to `logger.warn`, which never receives secret material.
 */

export interface ApplePayMerchantValidationOptions extends Omit<ApplePayValidationDeps, 'identity'> {
  /** The credentials port — see {@link ApplePayIdentityPort}. */
  identity: ApplePayIdentityPort;
  /**
   * Which merchant this request validates for — the host's attribution, as in
   * `mountPayments`. Return a `Response` to refuse (no such store, not allowed).
   */
  resolveMerchant: (request: Request) => Promise<MerchantRef | Response> | MerchantRef | Response;
  /** The response envelope; defaults to `{ data }` / `{ error, code }` like the checkout mount. */
  respond?: CheckoutResponder;
  /** Where a failed validation is written down. Silent by default. */
  logger?: Pick<CheckoutLogger, 'warn'>;
}

export interface ApplePayMerchantValidationRoute {
  POST(request: Request): Promise<Response>;
}

const STATUS: Record<ApplePayValidationRefusalCode, number> = {
  BAD_REQUEST: 400,
  INVALID_VALIDATION_URL: 400,
  INVALID_DOMAIN: 400,
  APPLE_PAY_NOT_CONFIGURED: 409,
  IDENTITY_UNAVAILABLE: 503,
  IDENTITY_UNUSABLE: 503,
  UNREACHABLE: 502,
  UPSTREAM_REFUSED: 502,
  INVALID_RESPONSE: 502,
  TIMEOUT: 504,
};

const defaultResponder: CheckoutResponder = {
  ok: (data, status = 200) => Response.json({ data }, { status }),
  fail: (body, status) => Response.json({ error: body.message, code: body.code }, { status }),
};

interface ValidationBody {
  validationURL: unknown;
  domain: unknown;
}

/**
 * The body's ceiling. `{ validationURL, domain }` is a few hundred bytes; the
 * route is public, so nothing larger is ever read into memory, let alone parsed.
 */
const MAX_BODY_BYTES = 4096;

/** The body as text, or `null` once it passes {@link MAX_BODY_BYTES} — read no further than that. */
async function cappedText(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function bodyOf(request: Request): Promise<ValidationBody | null> {
  const text = await cappedText(request);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return { validationURL: record.validationURL, domain: record.domain };
}

/**
 * The page's domain: the `Origin` header's host when the browser sent one —
 * page script cannot set it — else the body's `domain`. `null` when the two
 * disagree, so a page cannot ask for a session on someone else's domain.
 */
function domainOf(request: Request, claimed: unknown): unknown {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return claimed;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (claimed !== undefined && (typeof claimed !== 'string' || claimed.toLowerCase() !== host)) return null;
  return host;
}

/** Build the one-route mount. Call it once, at module scope. */
export function createApplePayMerchantValidation(
  options: ApplePayMerchantValidationOptions,
): ApplePayMerchantValidationRoute {
  const respond = options.respond ?? defaultResponder;
  const refuse = (code: ApplePayValidationRefusalCode): Response =>
    respond.fail({ code, message: code, field: null }, STATUS[code]);

  return {
    async POST(request) {
      const merchant = await options.resolveMerchant(request);
      if (merchant instanceof Response) return merchant;
      const body = await bodyOf(request);
      if (!body || typeof body.validationURL !== 'string') return refuse('BAD_REQUEST');
      const domain = domainOf(request, body.domain);
      if (typeof domain !== 'string') return refuse('INVALID_DOMAIN');
      try {
        const result = await validateApplePayMerchant({ validationURL: body.validationURL, domain, merchant }, options);
        if (result.status === 'NOT_CONFIGURED') return refuse('APPLE_PAY_NOT_CONFIGURED');
        return respond.ok(result.session);
      } catch (error) {
        if (!(error instanceof ApplePayValidationError)) throw error;
        options.logger?.warn(`apple-pay merchant validation failed: ${error.code}: ${error.message}`);
        return refuse(error.code);
      }
    },
  };
}
