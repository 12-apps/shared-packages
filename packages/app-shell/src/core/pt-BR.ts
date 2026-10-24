import type { RestResultFallbacks } from './rest-result';

/**
 * The pt-BR fallbacks for `restResult` — a NAMED export a host passes by hand,
 * never a default: `restResult(path, method, body, PT_BR_REST_RESULT_FALLBACKS)`.
 */
export const PT_BR_REST_RESULT_FALLBACKS: RestResultFallbacks = {
  status: (status) => `Erro ${status}`,
  network: 'Falha de conexão',
};
