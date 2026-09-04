import type { StoredCharge } from '../core/ports';

import { latestCharge, reconcilePaid } from './flows-read';
import {
  loadPayable,
  payableRefOf,
  readJsonBody,
  type CheckoutRuntime,
} from './runtime';
import type { CheckoutRouteIntent, Payable } from './types';

/**
 * `POST /release` — THE BUYER SAYS THEY DID NOT PAY (FUT-1146).
 *
 * ## Why this row has to exist
 *
 * A cancelled or refused payment on a provider's OWN page produces no signal
 * anywhere in this system, and that was verified rather than assumed. The
 * hosted provider's payment check publishes `success`, `paid`, amounts and
 * NSUs — no status, no cancel field, no decline code — so its snapshot maps to
 * PAID or PENDING and nothing else. Its webhook verifier believes a delivery
 * only when the provider confirms the payment, so an unpaid delivery fails
 * verification and is never parsed. The settlement poll returns the payable's
 * own status unless the provider says PAID. Every writer of a failed state is
 * therefore unreachable from a hosted cancel.
 *
 * So the screen waited: 2.5 s for two minutes, 10 s for thirteen more, and
 * then told a shopper who had never paid "if you have already paid, do not pay
 * again". Fifteen minutes to reach a sentence addressed to somebody else, with
 * their live basket sitting behind it.
 *
 * The only signal that exists is the buyer's own, and this is where it lands.
 *
 * ## What makes it safe to act on
 *
 * NOTHING here trusts the buyer about the money. The provider is asked first,
 * through the same reconcile the poll uses, and a payable it reports PAID is
 * settled and answered PAID — the buyer keeps the confirmation they were about
 * to walk away from, which is the whole point of asking. Only a payable that
 * still has no payment behind it is let go.
 *
 * The host's `abandon` is what "let go" MEANS, and it is optional. Without it
 * this row still answers the payable's truth — the buyer's own screen recovers
 * either way — and no payable is silently mutated by a port the host never
 * wired.
 */

type Runtime<C, V extends object, D> = CheckoutRuntime<C, V, D>;

/**
 * Void the charge at the provider, where the provider has such a thing.
 *
 * BEST EFFORT, and the failure is expected rather than exceptional: most
 * vendors publish no void at all, so the adapter throws
 * `UnsupportedOperationError` and this logs one line. What it buys where it IS
 * supported is the difference between refusing money and refunding it — a
 * hosted link the buyer walked away from stays payable otherwise.
 */
async function voidCharge<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  charge: StoredCharge,
): Promise<void> {
  try {
    const gateway = await runtime.gateway();
    await gateway.cancelCharge(payable.merchant, charge.provider, charge.providerChargeId);
  } catch (error) {
    runtime.log.warn(
      `[checkout] could not void the released charge for ${payable.ref}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Hand the payable back to the host, or answer its current state.
 *
 * A host with no `abandon` port gets the second, deliberately: a library that
 * invented a terminal state for somebody else's row would be deciding what a
 * released order MEANS — refunded, cancelled, reopened for a second attempt —
 * which is exactly the class of decision every other correlation method leaves
 * to the host.
 */
async function letGo<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
): Promise<string> {
  const abandon = runtime.config.correlation.abandon;
  if (!abandon) return runtime.config.payables.stateToken(payable);
  return abandon(payable.ref);
}

/** `POST /release` — see this module's own doc for why it exists. */
export async function releaseCheckout<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
  intent: CheckoutRouteIntent,
): Promise<Response> {
  const body = await readJsonBody(request);
  const loaded = await loadPayable(
    runtime,
    caller,
    payableRefOf(runtime.payableRefField, body, request.url),
    // Nothing is charged here, so there is no method and no draft — the same
    // shape the status poll loads with.
    { request, intent, method: null, draft: null },
  );
  if ('response' in loaded) return loaded.response;
  const { payable } = loaded;
  // A payable that has already reached an answer keeps it. The buyer is telling
  // us about a payment they did not make; a payable that is settled or closed
  // is not one they can still be waiting on.
  if (payable.state !== 'OPEN') {
    return runtime.respond.ok(runtime.config.payables.stateToken(payable));
  }

  const charge = await latestCharge(runtime, payable);
  // No charge was ever raised, so there is nothing to ask about and nothing to
  // void — only a payable nobody can pay, which is exactly what release means.
  if (!charge) return runtime.respond.ok(await letGo(runtime, payable));

  // THE PROVIDER IS ASKED FIRST, and its answer outranks the buyer's.
  const settled = await reconcilePaid(runtime, payable, charge, request.url);
  if (settled !== null) return runtime.respond.ok(settled);

  await voidCharge(runtime, payable, charge);
  return runtime.respond.ok(await letGo(runtime, payable));
}
