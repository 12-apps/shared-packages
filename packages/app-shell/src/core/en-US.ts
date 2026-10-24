import type { RestResultFallbacks } from './rest-result';

/**
 * The en-US fallbacks for `restResult` — also what it uses when a host passes
 * none. A NAMED export, like `PT_BR_REST_RESULT_FALLBACKS`.
 */
export const EN_US_REST_RESULT_FALLBACKS: RestResultFallbacks = {
  status: (status) => `HTTP ${status}`,
  network: 'network error',
};
