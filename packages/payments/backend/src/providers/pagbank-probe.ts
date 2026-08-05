import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { pagbankRequest } from './pagbank-http';
import { unreachableOutcome } from './probe-shared';

/**
 * "Testar conexão" for PagBank — its own module, mirroring
 * `infinitepay-probe.ts`: reading a refusal is a different job from asking,
 * and `pagbank.ts` sits at its line budget.
 */
export const verifyPagbankCredentials: PaymentProviderAdapter['verifyCredentials'] = async (
  credentials,
) => {
  if (credentials.stub) return { ok: true, message: 'stub mode' };
  if (!credentials.fields['token']) return { ok: false, message: 'Token não configurado.' };
  try {
    // Cheapest authenticated probe: a bogus order id returns 401/403 when the
    // token is wrong and 404 when it is right.
    await pagbankRequest('/orders/verify-credentials-probe', credentials, { method: 'GET' });
    return { ok: true };
  } catch (error) {
    // Transport first: without the UNREACHABLE fault, a network blip during
    // "Testar conexão" persisted FAILED over a good token (FUT-695).
    const unreachable = unreachableOutcome(error, 'o PagBank');
    if (unreachable) return unreachable;
    const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
    if (status === 401 || status === 403) {
      return { ok: false, fault: 'REFUSED', message: 'Token recusado pelo PagBank.' };
    }
    // Any status that came back PAST the auth layer means the token
    // authenticated: the bogus probe id yields 404, and a 400 if PagBank rejects
    // the id's shape instead. Only 401/403 prove a bad token — funnelling a 400
    // into a faultless `{ok: false}` would let `runVerify` stamp FAILED over
    // good credentials, resurrecting FUT-695 through a status we merely forgot
    // to enumerate.
    if (status !== undefined) return { ok: true };
    // No status, and not transport (`unreachableOutcome` already caught that):
    // a fault of OURS, not the provider's. Surface it loudly rather than as a
    // phantom outage or a phantom success.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
