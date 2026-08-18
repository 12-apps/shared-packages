import type { PaymentEnvironment } from '../core/types';

/**
 * PagBank's Orders API hosts — the one place this package spells them.
 *
 * They were written out five times: `pagbank-http.ts` (two consts plus a
 * private `apiBaseFor`), `pagbank-oauth.ts` (a `TOKEN_BASE` record), the
 * platform's `connect-application.ts` (a `DEFAULT_API_BASE` record) and
 * `homologacao-anexo.ts` (the sandbox half alone). Every copy said the same
 * thing in a different shape, so nothing tied them together and none of them
 * could be reused by a host — the first adopting host duplicated them a sixth
 * time rather than import a private const.
 *
 * A vendor's published hostname is exactly the kind of fact a payments package
 * exists to own: it is the same for every deployment, and a host that has to
 * restate it is restating the adapter's job.
 *
 * SANDBOX IS NOT THE DEFAULT HERE. The environment is a required argument, and
 * that is deliberate: a helper that guesses when asked about "no environment"
 * is a helper that can silently route a live charge at a sandbox host, or the
 * reverse. Callers that want a safe fallback resolve the environment first and
 * say so at their own seam — which is what every caller below already does.
 */
export function pagbankApiBase(environment: PaymentEnvironment): string {
  return environment === 'PRODUCTION'
    ? 'https://api.pagseguro.com'
    : 'https://sandbox.api.pagseguro.com';
}
