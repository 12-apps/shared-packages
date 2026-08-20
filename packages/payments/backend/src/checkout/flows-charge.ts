import { chargeSnapshotMismatch } from '../core/charge-identity';
import type { ChargeSnapshot, PaymentMethodKind } from '../core/types';

import { buyerCheckoutConfig, usesHostedCheckout } from './config';
import { chargeDraftOf } from './draft';
import { classifyFirstCharge, type FirstChargeSettlement } from './first-charge';
import { chargeMismatchRefusal } from './failure';
import { raiseCharge } from './raise';
import type { CheckoutCard } from './reuse';
import {
  attachedChargeOf,
  chargeRefusal,
  failureContext,
  loadPayable,
  notConfigured,
  payableNotFound,
  payableRefOf,
  readJsonBody,
  sendRefusal,
  type CheckoutRuntime,
} from './runtime';
import type { CheckoutChargeDraft, CheckoutRouteIntent, Payable } from './types';

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
 * Record and answer a classified settlement — the half that needs the runtime.
 *
 * WHAT it is (QR vs link) and whether it is this payable's charge at all are
 * `classifyFirstCharge`'s, in `first-charge.ts`, so this module and an adopting
 * host cannot drift about it. What is left here is transport: write the
 * correlation, refresh the view, respond.
 */
async function answerSettlement<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  view: V,
  settled: FirstChargeSettlement,
): Promise<Response> {
  if (settled.kind === 'MISMATCH') {
    const context = failureContext(runtime, payable.ref, payable.method);
    return sendRefusal(runtime, chargeMismatchRefusal(context, settled.charge, settled.reason));
  }

  await runtime.config.correlation.attachPending(payable.ref, settled.charge);
  const fresh = await refreshedView(runtime, payable.ref, view);
  if (settled.kind === 'PIX') return runtime.respond.ok(fresh);

  // Spread, not nest: the view is the host's own body and the handover URL rides
  // beside it, which is the shape the published frontend already reads. The
  // library still never READS a `View` — merging is not interpreting.
  return runtime.respond.ok({ ...fresh, hostedCheckoutUrl: settled.hostedCheckoutUrl });
}

/**
 * The FIRST charge of a freshly created payable, and the answer the buyer gets.
 *
 * Three shapes, decided by the providers' declared capabilities rather than
 * their names (FUT-556), and by the charge that ACTUALLY happened rather than by
 * whichever provider heads the chain (FUT-563):
 *
 *  - HOSTED CARD — no acquirer in the chain can tokenize in the browser, so
 *    there is no card form to show: raise now and answer with the link.
 *  - PIX — raise now and answer with the payload… unless the walk had to fail
 *    over onto a hosted provider, in which case the honest answer is that
 *    provider's link.
 *  - CARD with an in-browser path — the view alone; `chargeInstrument` charges
 *    it next, walking the chain with one instrument per provider.
 *
 * WHICH of the two raised shapes a snapshot is answered as comes from the
 * SNAPSHOT, never from `hostedCard` (FUT-747). `hostedCard` decides only whether
 * a CARD charge has to be raised here at all; it is a statement about turning a
 * PAN into an instrument, and a PIX charge has no PAN. Letting it pick the
 * answer shape sent every PIX charge at a merchant with no in-browser card path
 * — a PIX-only provider honestly declaring `NONE` is exactly that — into
 * `attachHosted`, which threw on the missing link of a charge that was carrying
 * a perfectly good QR.
 */
async function firstChargeResponse<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  view: V,
  hostedCard: boolean,
): Promise<Response> {
  if (!hostedCard && payable.method !== 'PIX') return runtime.respond.ok(view);

  const deps = { gateway: await runtime.gateway(), charges: runtime.charges, log: runtime.log };
  const snapshot = await raiseCharge(deps, payable, { method: payable.method });
  return answerSettlement(
    runtime,
    payable,
    view,
    classifyFirstCharge(snapshot, { amount: payable.amount, method: payable.method }),
  );
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
      ...(runtime.config.providers ? { providers: runtime.config.providers } : {}),
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
      usesHostedCheckout(config, created.payable.method),
    );
  } catch (error) {
    return chargeRefusal(runtime, created.payable, error);
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
  // On the published flat wire the ONE `token` field is either kind, so the
  // vault is what tells them apart — see `checkout/draft.ts`.
  const instrumentId =
    draft.card?.savedCardToken ?? (draft.ambiguousInstrument ? draft.card?.token : undefined);
  if (!instrumentId) return { card: draft.card, vaulted: false };
  const instruments = runtime.config.instruments;
  if (!instruments) return { card: draft.card, vaulted: false };

  const resolved = await instruments.resolve(
    caller,
    { merchant: payable.merchant, provider },
    instrumentId,
  );
  if (resolved.token !== null) return { card: { savedCardToken: resolved.token }, vaulted: true };
  // A handle the vault does not OWN, sent on the wire that conflates the two
  // kinds, is a fresh browser-minted token — which is the only reading that
  // leaves a first-time card payable at all. An owned one is a real scope
  // mismatch and falls through to the refusal.
  if (draft.ambiguousInstrument && !resolved.owned) return { card: draft.card, vaulted: false };
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

/**
 * A payable this request is not allowed to charge, or null.
 *
 * THE METHOD IS THE GATE, and it is a money rule rather than a validation nicety
 * (FUT-740). `/charge` raises a CARD charge; a payable whose method is PIX is
 * one the buyer is holding a live QR for. Settling it with a card leaves that QR
 * scannable and still pointing at a chargeable code — two payable codes for one
 * payable, the exact double payment `checkout/reuse.ts` exists to prevent, and
 * one the superseded-code void cannot clean up because it only ever looks at
 * PIX charges priced at some OTHER amount.
 *
 * The replaced host route refused the same case with a 404 and this answers with
 * the same one, so "absent", "not yours" and "not card-payable" stay
 * indistinguishable from outside.
 */
function unchargeableBy<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  method: PaymentMethodKind,
): Response | null {
  if (payable.method === method) return null;
  runtime.log.warn(
    `[checkout] refused a ${method} charge on a ${payable.method} payable (${payable.ref})`,
  );
  return payableNotFound(runtime);
}

/** `POST /charge` — charge an instrument against an existing payable. */
export async function chargeInstrument<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
  intent: CheckoutRouteIntent,
): Promise<Response> {
  const body = await readJsonBody(request);
  // Both wire shapes normalize here, ONCE, and nothing downstream sees the raw
  // body — including the host's `load`, which is handed the parsed draft.
  const draft = chargeDraftOf(body);
  const loaded = await loadPayable(
    runtime,
    caller,
    payableRefOf(runtime.payableRefField, body, request.url),
    { request, intent, method: 'CARD', draft },
  );
  if ('response' in loaded) return loaded.response;
  const { payable } = loaded;
  const unchargeable = unchargeableBy(runtime, payable, 'CARD');
  if (unchargeable) return unchargeable;
  if (payable.state !== 'OPEN') {
    return runtime.respond.ok({ status: runtime.config.payables.stateToken(payable) });
  }

  const provider = await runtime.config.credentials.defaultProvider(payable.merchant);
  if (!provider) return notConfigured(runtime);

  const instrument = await resolveInstrument(runtime, caller, payable, provider, draft);
  if ('response' in instrument) return instrument.response;

  try {
    const deps = { gateway: await runtime.gateway(), charges: runtime.charges, log: runtime.log };
    const snapshot = await raiseCharge(deps, payable, {
      method: 'CARD',
      card: instrument.card,
      // The CPF the card form asked for reaches the provider's required-field
      // gate from HERE — the host's payable row has nowhere to keep it.
      customer: draft.customer,
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
    // `payable.method` IS 'CARD' here — `unchargeableBy` refused anything else
    // before the try, so the wording names the method that was actually charged.
    return chargeRefusal(runtime, payable, error);
  }
}
