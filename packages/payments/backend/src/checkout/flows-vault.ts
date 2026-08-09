import { CredentialsError, UnsupportedOperationError } from '../core/errors';
import type { MerchantRef } from '../core/types';
import type { VaultBeginInput, VaultCompleteInput, VaultedInstrument, VaultSession } from '../core/vault-types';

import { checkoutRefusalFor } from './failure';
import {
  failureContext,
  notConfigured,
  readJsonBody,
  sendRefusal,
  type CheckoutRuntime,
} from './runtime';
import type { InstrumentScope } from './types';
import type { BuyerVaultSession, VaultedCardDisplay } from './vault-port';

/**
 * VAULT A CARD FROM THE BUYER SURFACE (FUT-478) — `POST /cards/begin` and
 * `POST /cards/complete`, the shopper-facing "add a card" the checkout mount
 * never had. The vault machinery itself predates this file (gateway
 * `beginVault`/`completeVault`, the adapters' `vault` seam); what is new is
 * only the dispatch, on the BUYER table rather than the admin one — the mount
 * split is a privilege boundary (`http/mount.ts`), so the buyer surface gets
 * its own rows instead of a reused admin route.
 *
 * The rules that carry over from the admin surface (`http/vault-handlers.ts`):
 *
 *   - `reference` and `customerRef` are OWNERSHIP facts, answered by the
 *     host's {@link BuyerVaultPort} from the caller + scope, never read from
 *     the request body. The browser contributes exactly two facts — the
 *     session it confirmed (`sessionId`) and, for a sessionless PUBLIC_KEY
 *     provider, the encrypted card blob (`token`).
 *   - an unwired host answers the admin convention's 404 ("Card vaulting is
 *     not enabled") — and it answers it BEFORE any adapter runs, so a host
 *     that cannot store the vaulted instrument never strands a token at the
 *     provider that nothing can ever charge or remove.
 *
 * And the rule that is deliberately NOT carried over: there is no buyer-side
 * FORGET. PagBank publishes no endpoint that deletes a stored card token
 * (`providers/pagbank-vault.ts`), so a buyer-facing "remove my card" could
 * only fake the removal on the provider that most needs it. Taking a card off
 * file stays a merchant/host concern, on the admin surface's named-provider
 * `vault/:provider/forget` row.
 *
 * The provider is the chain HEAD, resolved by the same rule the gateway's
 * `activeVault()` pins (`core/gateway-vault.ts`): no failover, because an
 * instrument minted at provider #2 is garbage input to the provider the
 * merchant actually charges through.
 */

type Runtime<C, V extends object, D> = CheckoutRuntime<C, V, D>;

/**
 * The admin surface's "Card vaulting is not enabled" convention, through the
 * checkout responder. A hardcoded sentence, deliberately NOT a `CheckoutCopy`
 * member: this state is a host wiring gap a buyer can never fix (no UI offers
 * "add a card" on a host that did not wire vaulting), and growing the copy
 * port a required member would break every existing host's implementation.
 */
function vaultNotEnabled<C, V extends object, D>(runtime: Runtime<C, V, D>): Response {
  return runtime.respond.fail(
    { code: 'VAULT_NOT_ENABLED', message: 'Card vaulting is not enabled', field: null },
    404,
  );
}

/**
 * Resolve everything both routes need, refusals first.
 *
 * The wiring gate runs BEFORE anything provider-shaped: a host that wired no
 * `vault` port has no ownership facts to vault under, and a host that wired no
 * `instruments.save` has nowhere to keep what `complete` mints — calling the
 * adapter anyway would strand a provider-side token no charge can ever use.
 */
async function vaultContext<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  merchant: MerchantRef,
): Promise<{ scope: InstrumentScope; ownership: VaultBeginInput } | { response: Response }> {
  if (!runtime.config.vault || !runtime.config.instruments?.save) {
    return { response: vaultNotEnabled(runtime) };
  }
  const provider = await runtime.config.credentials.defaultProvider(merchant);
  // No provider at all is the merchant-cannot-charge state the surface already
  // words (409), not a vault-specific gap.
  if (!provider) return { response: notConfigured(runtime) };
  const scope: InstrumentScope = { merchant, provider };
  return { scope, ownership: await runtime.config.vault(caller, scope) };
}

/**
 * Word a thrown vault failure. A provider that cannot vault, or is not
 * connected, is the same "not enabled here" answer as an unwired host — the
 * buyer can fix neither. Everything else runs through the checkout failure
 * pipeline, so a provider 400 (a bad card refused at validation) surfaces
 * with the field-level reason the host's `mapProviderError` gives it.
 * `onChargeError` is NOT fired: no charge was raised, so there is no money
 * bookkeeping to do.
 */
function vaultRefusal<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  reference: string,
  error: unknown,
): Response {
  if (error instanceof UnsupportedOperationError || error instanceof CredentialsError) {
    return vaultNotEnabled(runtime);
  }
  // Vaulting is a CARD fact — the method the wording pipeline names.
  return sendRefusal(runtime, checkoutRefusalFor(failureContext(runtime, reference, 'CARD'), error));
}

/** The browser-safe half of a `VaultSession` — see {@link BuyerVaultSession}. */
function browserSession(session: VaultSession): BuyerVaultSession {
  // Explicit picks, never a spread: `customerRef` is the host's persist-it
  // fact, and a field the session grows later must OPT IN to reaching a buyer.
  return {
    provider: session.provider,
    tokenization: session.tokenization,
    publicKey: session.publicKey ?? null,
    clientSecret: session.clientSecret ?? null,
    sessionId: session.sessionId ?? null,
  };
}

/** The two facts the browser may legitimately contribute to `complete`. */
function browserVaultFacts(body: unknown): Pick<VaultCompleteInput, 'sessionId' | 'token'> {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  return {
    ...(typeof record['sessionId'] === 'string' ? { sessionId: record['sessionId'] } : {}),
    ...(typeof record['token'] === 'string' ? { token: record['token'] } : {}),
  };
}

/** Display metadata ONLY — never `instrumentId`, the vault token itself. */
function displayOf(instrument: VaultedInstrument): VaultedCardDisplay {
  return {
    brand: instrument.brand ?? null,
    last4: instrument.last4 ?? null,
    expMonth: instrument.expMonth ?? null,
    expYear: instrument.expYear ?? null,
  };
}

/** `POST /cards/begin` — equip the buyer's browser to mint the instrument. */
export async function beginVault<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  merchant: MerchantRef,
): Promise<Response> {
  const resolved = await vaultContext(runtime, caller, merchant);
  if ('response' in resolved) return resolved.response;
  try {
    const gateway = await runtime.gateway();
    return runtime.respond.ok(browserSession(await gateway.beginVault(merchant, resolved.ownership)));
  } catch (error) {
    return vaultRefusal(runtime, resolved.ownership.reference, error);
  }
}

/**
 * Persist what the provider minted, and answer the display. The vault token
 * travels ONLY into the host's storage; a save failure is answered as an
 * error because an instrument the host cannot resolve later is not "saved",
 * however happy the provider is — worded like the browser-key refusal, with
 * the message only in the log (a provider error retains the provider's body).
 */
async function persistInstrument<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  merchant: MerchantRef,
  instrument: VaultedInstrument,
  reference: string,
): Promise<Response> {
  const save = runtime.config.instruments?.save;
  if (!save) return vaultNotEnabled(runtime); // proven wired pre-adapter; re-read for the type
  const display = displayOf(instrument);
  try {
    // Scoped to the provider that MINTED it — the instrument names it — which
    // is the same FUT-697 rule `maybeSaveInstrument` applies on the charge path.
    await save(caller, { merchant, provider: instrument.provider }, instrument.instrumentId, display);
  } catch (error) {
    runtime.log.error(
      `[checkout] vault save failed for ${reference}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return runtime.respond.fail(
      { code: 'VAULT_NOT_SAVED', message: runtime.copy.genericProviderRefusal, field: null },
      502,
    );
  }
  return runtime.respond.ok(display);
}

/** `POST /cards/complete` — the provider accepted the card; store and answer. */
export async function completeVault<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
  merchant: MerchantRef,
): Promise<Response> {
  const resolved = await vaultContext(runtime, caller, merchant);
  if ('response' in resolved) return resolved.response;
  const { reference, customerRef } = resolved.ownership;

  let instrument: VaultedInstrument;
  try {
    const gateway = await runtime.gateway();
    instrument = await gateway.completeVault(merchant, {
      // The ownership half comes from the HOST's answer; the browser's two
      // fields ride beside it and can override neither.
      reference,
      customerRef,
      ...browserVaultFacts(await readJsonBody(request)),
    });
  } catch (error) {
    return vaultRefusal(runtime, reference, error);
  }
  return persistInstrument(runtime, caller, merchant, instrument, reference);
}
