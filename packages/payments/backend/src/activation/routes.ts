import type { SettingsService } from '../config/service';
import type { MerchantRef } from '../core/types';
import type { PaymentsRouteExtension, PaymentsRouteExtensionArgs } from '../http/router';

import type { ActivationContext } from './context';
import { healStrandedActivation, type ActivationReconcileContext } from './reconcile';
import { verificationAmountCents } from './reference';
import { getPendingVerification, discardPendingVerification, startRedirectVerification, pollRedirectVerification } from './verify-redirect';
import { verificationCardPublicKey, verifyProviderCharge } from './verify-charge';

/**
 * The verify-charge ROUTE mechanism (FUT-463/FUT-559), packaged.
 *
 * Every activation primitive already lived here — the card and redirect
 * proofs, the pending lifecycle, the stranded-attempt heal — but the HTTP
 * layer that strings them together (read the body by hand, dispatch the
 * phase, apply only a FRESH settlement, answer refusals as 200s) sat in the
 * host as a route extension, re-written from the same parts every adopter
 * would need. That orchestration is a rule of the surface, not of any host,
 * so it moves behind one factory; a host contributes only what the package
 * must never own — its stores, who is paying, and the words its owner reads.
 *
 * The OAuth `prepare` step is deliberately NOT here: it mints a CSRF state
 * into an httpOnly cookie, and cookies are a host concern by this package's
 * own contract (the same reason `completeOAuth` can be excluded from the
 * mount).
 */

/** Who is paying the activation charge — best-effort; absent fields are not sent. */
export interface ActivationPayer {
  name?: string;
  email?: string;
}

/** Everything the verify-charge routes need from a host, built per request. */
export interface ActivationRoutesContext {
  /** The activation flow's ports — the same object the primitives take. */
  activation: ActivationContext;
  /** The stranded-attempt heal's ports — proof store, config, settings. */
  reconcile: ActivationReconcileContext;
  /** The settle switch. A pass activates; a card FAILURE deactivates. */
  settings: Pick<SettingsService, 'applyChargeVerification'>;
}

export interface ActivationRoutesConfig<A> {
  /** Host ports, resolved per request (stores are usually lazy singletons). */
  context: () => ActivationRoutesContext | Promise<ActivationRoutesContext>;
  /**
   * The signed-in owner paying the proof charge, resolved from the request.
   * Best-effort by contract: `{}` charges fine, just anonymously.
   */
  payer: (args: PaymentsRouteExtensionArgs<A>) => ActivationPayer | Promise<ActivationPayer>;
  /**
   * The one sentence this surface can 400 with — a card body missing its
   * token or tax id. REQUIRED, never defaulted: the package ships no
   * language, because a default would hand one product's voice to the next
   * (the same contract as checkout copy).
   */
  copy: {
    missingCardFields: string;
  };
}

/** The redirect flow's verbs — the owner's own `discard` included. */
type RedirectAction = 'start' | 'poll' | 'discard';

/** Narrow the body's `action` to a redirect verb, or null for the card flow. */
function asRedirectAction(value: unknown): RedirectAction | null {
  return value === 'start' || value === 'poll' || value === 'discard' ? value : null;
}

/**
 * The card/redirect body, read by hand rather than declared as a schema: the
 * shapes this endpoint rejects already have ANSWERS the screen renders — an
 * unparseable body and a body with no card fall through to `{ ok, reason }`
 * next to the button, and a validation envelope would change what the owner
 * sees.
 */
interface VerifyChargeBody {
  token?: string;
  taxId?: string;
  holderName?: string;
  email?: string;
  /** Redirect flow: mint the link, ask whether it was paid, or give up. */
  action?: RedirectAction;
  /**
   * What the provider appended to the return URL. A hosted-checkout
   * provider's settle check may require BOTH — dropping either answers the
   * same refusal it gives a reference that never existed.
   */
  transactionNsu?: string;
  slug?: string;
}

/** The settlement halves the caller brought back, absent ones omitted. */
function returnedFrom(body: VerifyChargeBody | null): { transactionNsu?: string; slug?: string } {
  return {
    ...(body?.transactionNsu ? { transactionNsu: body.transactionNsu } : {}),
    ...(body?.slug ? { slug: body.slug } : {}),
  };
}

/**
 * `GET .../providers/:provider/verify-charge` — the public key the
 * verification form encrypts the owner's card with, plus the outstanding
 * attempt so reopening the page RESUMES rather than minting a second charge.
 *
 * ⚠️ NOT A PURE READ. The heal can ACTIVATE a provider (`settleIfProven`):
 * this read is the moment the owner looks at the screen, and showing a pay
 * button for money that has already moved is the exact failure FUT-463
 * exists to end. A host gating writes (impersonation and the like) must gate
 * this path as a write.
 */
async function verifyChargeRead(
  ctx: ActivationRoutesContext,
  merchant: MerchantRef,
  provider: string,
): Promise<Response> {
  const publicKey = await verificationCardPublicKey(ctx.activation, merchant, provider);
  // The outstanding charge, if there is one. The attempt used to live only in
  // the browser and the redirect flow destroys that state by design, so a
  // reload offered to mint ANOTHER real charge — hence server-side pending.
  const pending = await getPendingVerification(ctx.activation, merchant, provider);
  const proven = pending
    ? await healStrandedActivation(ctx.reconcile, merchant, provider, pending.reference)
    : false;
  return Response.json({
    publicKey,
    // The amount travels with the key so the screen can NAME what it is about
    // to charge — a hosted-checkout provider may refuse a one-cent total, so
    // it is not always 1.
    amountCents: verificationAmountCents(ctx.activation.providers, provider),
    // Healed means settled: handing the attempt back would resume a
    // confirmation loop for a payment already applied.
    pending: proven ? null : pending,
    proven,
  });
}

/**
 * The redirect flow's phases: `start` mints a REAL link through this
 * merchant's own connection, `poll` asks whether it was paid, `discard`
 * abandons the attempt (the owner's own verb — nothing else may clear it).
 * Only a SETTLED answer moves the switch.
 */
async function runRedirectPhase(
  ctx: ActivationRoutesContext,
  merchant: MerchantRef,
  provider: string,
  action: RedirectAction,
  returned: { transactionNsu?: string; slug?: string },
  payer: ActivationPayer,
): Promise<unknown> {
  if (action === 'discard') {
    await discardPendingVerification(ctx.activation, merchant, provider);
    return { ok: true };
  }
  if (action === 'start') return startRedirectVerification(ctx.activation, merchant, provider, payer);

  const polled = await pollRedirectVerification(ctx.activation, merchant, provider, returned);
  // Apply only a FRESH settlement: `pending` settled nothing yet,
  // `alreadyProven` was settled earlier (re-applying would switch a
  // paused-but-proven provider back on uninvited), and `retryable` is a
  // charge that is STILL PAYABLE — settling it would clear the pending row
  // while the first charge sits live at the provider.
  if (!polled.pending && !polled.alreadyProven && !polled.retryable) {
    await ctx.settings.applyChargeVerification(merchant, provider, polled.ok);
  }
  return polled;
}

/**
 * The card flow, settled BOTH ways: a pass activates, a FAILURE deactivates.
 * The failure answers 200, not 4xx — a refused verification is the ANSWER
 * this endpoint exists to produce; only a malformed request is a client error.
 */
async function runCardPhase(
  ctx: ActivationRoutesContext,
  merchant: MerchantRef,
  provider: string,
  input: { token: string; taxId: string; holderName: string; email: string },
): Promise<unknown> {
  const result = await verifyProviderCharge(ctx.activation, merchant, provider, input);
  await ctx.settings.applyChargeVerification(merchant, provider, result.ok);
  return result.ok
    ? { ok: true, refunded: result.refunded }
    : { ok: false, reason: result.reason, providerMessage: result.providerMessage };
}

/**
 * The two verify-charge route extensions, ready for `mountPayments`'s
 * `extensions` list. Patterns match the canonical route table's own layout
 * (`settings/providers/:provider/…`), which is a rule of this surface — a
 * host that mounts elsewhere passes the same `prefix` it already gives the
 * mount.
 */
export function createActivationRouteExtensions<A>(
  config: ActivationRoutesConfig<A>,
): readonly PaymentsRouteExtension<A>[] {
  return [
    {
      kind: 'getVerifyCharge',
      method: 'GET',
      pattern: ['settings', 'providers', ':provider', 'verify-charge'],
      handler: async (args) =>
        verifyChargeRead(await config.context(), args.merchant, args.intent.provider ?? ''),
    },
    {
      kind: 'runVerifyCharge',
      method: 'POST',
      pattern: ['settings', 'providers', ':provider', 'verify-charge'],
      handler: async (args) => {
        const ctx = await config.context();
        const merchant = args.merchant;
        const provider = args.intent.provider ?? '';
        const body = (await args.request.json().catch(() => null)) as VerifyChargeBody | null;

        // A provider whose buyer pays on ITS page proves itself the same way,
        // just not through a card form here. A webhook never decides this: an
        // unsigned delivery with a public handle proves nothing.
        const redirectAction = asRedirectAction(body?.action);
        if (redirectAction) {
          return Response.json(
            await runRedirectPhase(
              ctx,
              merchant,
              provider,
              redirectAction,
              returnedFrom(body),
              await config.payer(args),
            ),
          );
        }

        if (!body?.token || !body.taxId) {
          return Response.json({ ok: false, reason: config.copy.missingCardFields }, { status: 400 });
        }

        return Response.json(
          await runCardPhase(ctx, merchant, provider, {
            token: body.token,
            taxId: body.taxId,
            holderName: body.holderName ?? '',
            email: body.email ?? '',
          }),
        );
      },
    },
  ];
}
