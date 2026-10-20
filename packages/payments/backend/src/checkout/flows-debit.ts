import { debitSessionFor } from '../core/debit-session';

import {
  loadPayable,
  notConfigured,
  payableRefOf,
  readJsonBody,
  type CheckoutRuntime,
} from './runtime';
import type { CheckoutRouteIntent } from './types';

/**
 * `POST /3ds-session` — the 3-D Secure session a debit charge's browser SDK
 * runs on (FUT-3754).
 *
 * Payable-scoped for the reason `/refresh-key` is: the merchant comes from the
 * caller's OWN payable, never from a client-supplied handle, so a signed-in
 * buyer cannot make the platform call a provider with an arbitrary store's
 * token. The answer carries the session — it authorizes nothing but an
 * authentication attempt, and expires in 30 minutes — and the amount the charge
 * will take (`payable.amount`), so the bank authenticates exactly what is then
 * charged and the browser never decides a figure of its own.
 */
export async function threeDSecureSession<C, V extends object, D>(
  runtime: CheckoutRuntime<C, V, D>,
  request: Request,
  caller: C,
  intent: CheckoutRouteIntent,
): Promise<Response> {
  const body = await readJsonBody(request);
  const loaded = await loadPayable(
    runtime,
    caller,
    payableRefOf(runtime.payableRefField, body, request.url),
    { request, intent, method: null, draft: null },
  );
  if ('response' in loaded) return loaded.response;
  const providers = runtime.config.providers;
  if (!providers) return notConfigured(runtime);

  try {
    const minted = await debitSessionFor(
      { providers, credentials: runtime.config.credentials },
      loaded.payable.merchant,
    );
    if (!minted) return notConfigured(runtime);
    return runtime.respond.ok({
      provider: minted.provider,
      ...minted.session,
      amountCents: loaded.payable.amount.amountCents,
    });
  } catch (error) {
    // The MESSAGE only: a provider error retains the provider's parsed body.
    runtime.log.error(
      `[payments] 3DS session failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return runtime.respond.fail(
      { code: 'THREE_DS_UNAVAILABLE', message: runtime.copy.genericProviderRefusal, field: null },
      502,
    );
  }
}
