import { chargeSnapshotMismatch, hostedSnapshotMismatch } from '../core/charge-identity';
import type { ChargeSnapshot, PaymentMethodKind } from '../core/types';

import { buyerCheckoutConfig, usesHostedCheckout } from './config';
import { chargeMismatchRefusal, checkoutRefusalFor, type FailureContext } from './failure';
import { raiseCharge } from './raise';
import type { CheckoutCard } from './reuse';
import {
  attachedChargeOf,
  loadPayable,
  notConfigured,
  payableRefOf,
  readJsonBody,
  sendRefusal,
  type CheckoutRuntime,
} from './runtime';
import type { CheckoutChargeDraft, Payable } from './types';

/**
 * THE TWO MONEY PATHS: create a checkout and raise its first charge, and charge
 * an instrument against an existing payable.
 *
 * The rule that governs both: THE ANSWER FOLLOWS THE SNAPSHOT, never the head
 * of the chain. A walk that fails over lands on a provider that may settle
 * differently from the one the checkout started at — a hosted page instead of a
 * QR — and the buyer is owed whatever the charge that actually exists offers.
 * Deciding up front from the head is what made a PIX request that failed over
 * onto a redirect provider a 500 ("no PIX payload for a PIX charge") on a charge
 * that was perfectly payable.
 */

type Runtime<C, V extends object, D> = CheckoutRuntime<C, V, D>;

function failureContext<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  ref: string,
  method: PaymentMethodKind,
): FailureContext {
  return {
    copy: runtime.copy,
    log: runtime.log,
    ref,
    method,
    mapProviderError: runtime.config.mapProviderError,
  };
}

/** The payable's view after a correlation write, or the one we already had. */
async function refreshedView<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  ref: string,
  view: V,
): Promise<V> {
  const fresh = await runtime.config.payables.view?.(ref);
  return fresh ?? view;
}

/**
 * Guard, record and answer a snapshot that settles on the provider's OWN page.
 *
 * A snapshot with no `hostedCheckoutUrl` is a genuine provider failure and is
 * reported as one: without a link there is nowhere to send the buyer, and
 * returning the bare view would strand them on a payment step with no way to
 * pay and no error.
 */
async function attachHosted<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  view: V,
  snapshot: ChargeSnapshot,
): Promise<Response> {
  // Amount and currency only — see `hostedSnapshotMismatch`. Comparing the
  // METHOD here is what still refused a reused link: it was minted under
  // whichever method the buyer picked first, and they are free to pick another.
  const mismatch = hostedSnapshotMismatch(snapshot, { amount: payable.amount });
  if (mismatch) {
    const context = failureContext(runtime, payable.ref, payable.method);
    return sendRefusal(runtime, chargeMismatchRefusal(context, snapshot, mismatch));
  }
  const hostedCheckoutUrl = snapshot.hostedCheckoutUrl;
  if (!hostedCheckoutUrl) {
    throw new Error('The provider returned no hosted-checkout URL for a redirect charge.');
  }
  await runtime.config.correlation.attachPending(payable.ref, attachedChargeOf(snapshot));
  const fresh = await refreshedView(runtime, payable.ref, view);
  // Spread, not nest: the view is the host's own body and the handover URL rides
  // beside it, which is the shape the published frontend already reads. The
  // library still never READS a `View` — merging is not interpreting.
  return runtime.respond.ok({ ...fresh, hostedCheckoutUrl });
}

/** Guard, record and answer a PIX snapshot. */
async function attachPix<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  view: V,
  snapshot: ChargeSnapshot,
): Promise<Response> {
  // FUT-377/378 — the QR shown must be THIS payable's, for THIS total. A
  // snapshot answered out of the gateway's store under a stale key would
  // otherwise be attached as the current charge, which is precisely the reported
  // symptom: the new total displayed next to the previous QR code.
  const mismatch = chargeSnapshotMismatch(snapshot, {
    method: 'PIX',
    amount: payable.amount,
  });
  if (mismatch) {
    const context = failureContext(runtime, payable.ref, 'PIX');
    return sendRefusal(runtime, chargeMismatchRefusal(context, snapshot, mismatch));
  }
  if (!snapshot.pix) throw new Error('The provider returned no PIX payload for a PIX charge.');
  await runtime.config.correlation.attachPending(payable.ref, attachedChargeOf(snapshot));
  return runtime.respond.ok(await refreshedView(runtime, payable.ref, view));
}

/**
 * The FIRST charge of a freshly created payable, and the answer the buyer gets.
 *
 * Three shapes, decided by the providers' declared capabilities rather than
 * their names (FUT-556), and by the charge that ACTUALLY happened rather than by
 * whichever provider heads the chain (FUT-563):
 *
 *  - HOSTED-ONLY merchant — no provider in the chain can tokenize in the
 *    browser, so BOTH methods take the same path: raise now, answer with the
 *    link. Checked FIRST, because the PIX branch below demands a payload a
 *    redirect provider never returns.
 *  - PIX — raise now and answer with the payload… unless the walk had to fail
 *    over onto a hosted provider, in which case the honest answer is that
 *    provider's link.
 *  - CARD — the view alone; `chargeInstrument` charges it next, walking the
 *    chain with one instrument per provider.
 */
async function firstChargeResponse<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  view: V,
  hostedOnly: boolean,
): Promise<Response> {
  if (!hostedOnly && payable.method !== 'PIX') return runtime.respond.ok(view);

  const deps = { gateway: await runtime.gateway(), charges: runtime.charges, log: runtime.log };
  const snapshot = await raiseCharge(deps, payable, { method: payable.method });
  if (hostedOnly || snapshot.hostedCheckoutUrl) {
    return attachHosted(runtime, payable, view, snapshot);
  }
  return attachPix(runtime, payable, view, snapshot);
}

/**
 * `POST /` — bring a payable into existence and raise its first charge.
 *
 * FAILS CLOSED BEFORE `payables.create`. A merchant with no enabled provider is
 * refused while nothing exists yet, so a payable is never raised into a store
 * that cannot charge — and so a buyer is never charged into the wrong account.
 */
export async function createCheckout<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
  merchantOf: () => Promise<Response | { merchant: Payable['merchant'] }>,
): Promise<Response> {
  const resolved = await merchantOf();
  if (resolved instanceof Response) return resolved;
  const { merchant } = resolved;

  const config = await buyerCheckoutConfig(
    {
      gateway: await runtime.gateway(),
      credentials: runtime.config.credentials,
      connections: runtime.config.connections,
      browserKey: runtime.config.browserKey,
    },
    merchant,
  );
  if (config.chain.length === 0) return notConfigured(runtime);

  const create = runtime.config.payables.create;
  if (!create) {
    throw new Error('createPaymentFlowsBE: payables.create is required to serve createCheckout');
  }
  const body = await readJsonBody(request);
  const created = await create(caller, body, merchant);
  try {
    return await firstChargeResponse(
      runtime,
      created.payable,
      created.view,
      usesHostedCheckout(config),
    );
  } catch (error) {
    const context = failureContext(runtime, created.payable.ref, created.payable.method);
    return sendRefusal(runtime, checkoutRefusalFor(context, error));
  }
}

/** The instrument to charge with, or the refusal to send instead. */
async function resolveInstrument<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  payable: Payable,
  provider: string,
  draft: CheckoutChargeDraft,
): Promise<{ card: CheckoutCard | undefined; vaulted: boolean } | { response: Response }> {
  const instrumentId = draft.card?.savedCardToken;
  if (!instrumentId) return { card: draft.card, vaulted: false };
  const instruments = runtime.config.instruments;
  if (!instruments) return { card: draft.card, vaulted: false };

  const resolved = await instruments.resolve(
    caller,
    { merchant: payable.merchant, provider },
    instrumentId,
  );
  if (resolved.token !== null) return { card: { savedCardToken: resolved.token }, vaulted: true };
  // "Not yours" and "yours but not chargeable here" are answered identically,
  // for the same reason `payables.load` conflates absent and forbidden. What
  // matters is that neither becomes a DECLINE: a scope mismatch (FUT-697) told
  // the buyer their card was refused, when nothing was ever sent.
  return {
    response: runtime.respond.fail(
      {
        code: 'INSTRUMENT_NOT_USABLE',
        message: runtime.copy.instrumentNotUsableHere,
        field: null,
      },
      409,
    ),
  };
}

/**
 * A card charge the provider left IN FLIGHT (FUT-698): `PENDING`, optionally
 * with a page the buyer must finish on — a redirect-based 3-D Secure — or a
 * processing intent with nothing to act on.
 *
 * A PENDING card charge is NOT a decline. Recording either through the
 * approved/declined pair would flip a LIVE charge's payable to failed. It is
 * bookkept exactly like a hosted charge because it IS one from here on: the
 * payable stays OPEN, the correlation is written so the webhook and the poll can
 * settle it, and the instrument is never vaulted — nothing authorized yet.
 */
async function pendingCardResponse<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  snapshot: ChargeSnapshot,
): Promise<Response | null> {
  if (snapshot.status !== 'PENDING') return null;
  await runtime.config.correlation.attachPending(payable.ref, attachedChargeOf(snapshot));
  return runtime.respond.ok({
    status: runtime.config.payables.stateToken(payable),
    ...(snapshot.hostedCheckoutUrl ? { hostedCheckoutUrl: snapshot.hostedCheckoutUrl } : {}),
  });
}

/** Vault the instrument, if it authorized as a fresh one and the buyer opted in. */
async function maybeSaveInstrument<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  payable: Payable,
  snapshot: ChargeSnapshot,
  draft: CheckoutChargeDraft,
  alreadyVaulted: boolean,
): Promise<void> {
  const approved = snapshot.status === 'PAID' || snapshot.status === 'AUTHORIZED';
  const save = runtime.config.instruments?.save;
  if (!approved || !draft.saveInstrument || alreadyVaulted || !save) return;
  // The REUSABLE vault token the adapter normalized, never the one-time blob —
  // providers reject that on a second charge. Scoped to the provider that MINTED
  // it (the snapshot names it) and the merchant whose charge did (FUT-697).
  const vaultToken = snapshot.card?.vaultToken;
  if (!vaultToken) return;
  await save(
    caller,
    { merchant: payable.merchant, provider: snapshot.provider },
    vaultToken,
    draft.instrumentDisplay,
  );
}

/** `POST /charge` — charge an instrument against an existing payable. */
export async function chargeInstrument<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
): Promise<Response> {
  const body = await readJsonBody(request);
  const loaded = await loadPayable(
    runtime,
    caller,
    payableRefOf(runtime.payableRefField, body, request.url),
  );
  if ('response' in loaded) return loaded.response;
  const { payable } = loaded;
  if (payable.state !== 'OPEN') {
    return runtime.respond.ok({ status: runtime.config.payables.stateToken(payable) });
  }

  const provider = await runtime.config.credentials.defaultProvider(payable.merchant);
  if (!provider) return notConfigured(runtime);

  const draft = (body ?? {}) as CheckoutChargeDraft;
  const instrument = await resolveInstrument(runtime, caller, payable, provider, draft);
  if ('response' in instrument) return instrument.response;

  try {
    const deps = { gateway: await runtime.gateway(), charges: runtime.charges, log: runtime.log };
    const snapshot = await raiseCharge(deps, payable, {
      method: 'CARD',
      card: instrument.card,
    });
    // FUT-378 — NEVER record bookkeeping from an unrecognized snapshot. A charge
    // answered out of the gateway's store rather than raised now can be another
    // attempt's: a PIX charge read as a card decline would fail this payable and
    // burn the live QR's charge id onto a declined payment row, after which
    // paying that QR settles nothing.
    const mismatch = chargeSnapshotMismatch(snapshot, { method: 'CARD', amount: payable.amount });
    if (mismatch) {
      const context = failureContext(runtime, payable.ref, 'CARD');
      return sendRefusal(runtime, chargeMismatchRefusal(context, snapshot, mismatch));
    }

    const pending = await pendingCardResponse(runtime, payable, snapshot);
    if (pending) return pending;

    const status = await runtime.config.correlation.recordCardOutcome({
      ref: payable.ref,
      charge: attachedChargeOf(snapshot),
      // A decline is a business OUTCOME the provider reports, not an error.
      approved: snapshot.status === 'PAID' || snapshot.status === 'AUTHORIZED',
      amount: payable.amount,
    });
    await maybeSaveInstrument(runtime, caller, payable, snapshot, draft, instrument.vaulted);
    return runtime.respond.ok({ status });
  } catch (error) {
    const context = failureContext(runtime, payable.ref, 'CARD');
    return sendRefusal(runtime, checkoutRefusalFor(context, error));
  }
}
