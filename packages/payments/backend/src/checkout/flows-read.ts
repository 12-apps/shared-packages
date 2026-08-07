import type { SettlementHints } from '../core/settlement-hints';
import type { StoredCharge } from '../core/ports';
import type { MerchantRef } from '../core/types';

import { buyerCheckoutConfig } from './config';
import {
  attachedChargeOf,
  loadPayable,
  notConfigured,
  payableRefOf,
  readJsonBody,
  type CheckoutRuntime,
} from './runtime';
import type { CheckoutRouteIntent, Payable } from './types';

/**
 * The READ side of the buyer checkout: the protocol config, the caller's saved
 * instruments, the settlement poll, and re-minting a browser key.
 *
 * `getStatus` is a READ that can SETTLE, which is why it lives on the same
 * money-safety footing as the charge paths and not in a "harmless GET" bucket.
 */

type Runtime<C, V extends object, D> = CheckoutRuntime<C, V, D>;

/** `GET /config` — the merchant's buyer-safe payment protocol. */
export async function getCheckoutConfig<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  merchant: MerchantRef,
): Promise<Response> {
  const config = await buyerCheckoutConfig(
    {
      gateway: await runtime.gateway(),
      credentials: runtime.config.credentials,
      connections: runtime.config.connections,
      browserKey: runtime.config.browserKey,
    },
    merchant,
  );
  return runtime.respond.ok(config);
}

/**
 * `GET /cards` — the caller's instruments USABLE at this merchant (FUT-697).
 *
 * A merchant with no chain answers `[]` rather than the unscoped list: nothing
 * is chargeable there, so no instrument is reusable there, and offering one
 * would only produce a decline that blames the buyer's card.
 */
export async function listInstruments<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  caller: C,
  merchant: MerchantRef | null,
): Promise<Response> {
  const instruments = runtime.config.instruments;
  if (!instruments || !merchant) return runtime.respond.ok([]);
  const provider = await runtime.config.credentials.defaultProvider(merchant);
  if (!provider) return runtime.respond.ok([]);
  return runtime.respond.ok(await instruments.list(caller, { merchant, provider }));
}

/** Drop the absent halves, so an empty query never looks like a hint. */
function definedHints(url: string): SettlementHints | undefined {
  const params = new URL(url).searchParams;
  const present: SettlementHints = {
    ...(params.get('transactionNsu') ? { transactionNsu: params.get('transactionNsu')! } : {}),
    ...(params.get('slug') ? { slug: params.get('slug')! } : {}),
  };
  return Object.keys(present).length > 0 ? present : undefined;
}

/**
 * THE CHARGE decides which provider is asked — never the merchant's current
 * settings. A merchant that disables or swaps its provider must not change what
 * an already-raised charge means: the old vendor's id is meaningless to a new
 * vendor, and a missing connection is emphatically NOT permission to declare a
 * payable settled. No charge at all means nothing was ever raised, so nothing
 * can be confirmed.
 *
 * `latestByReference`, NOT `listPayable`. The two answer different questions and
 * only one of them is a poll's: `listPayable` is PENDING-only by contract,
 * because it exists to decide whether a re-tap may reuse a code, and a code that
 * is no longer pending is not one a buyer can pay. A POLL asks what happened to
 * the charge — so a charge is exactly what it must keep hold of once it stops
 * being pending. Built on the reuse query, this poll lost the charge the moment
 * it moved: a payable whose row had gone AUTHORIZED (its own first poll's
 * doing, since `refreshCharge` persists what it read) answered "unchanged"
 * forever after, and the buyer's screen never settled even though the provider
 * had said PAID.
 */
async function latestCharge<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
): Promise<StoredCharge | null> {
  return runtime.charges.latestByReference(payable.merchant, payable.ref);
}

/**
 * A STUB charge (local dev / CI) has no real provider behind it — polling one
 * answers PENDING forever — so it self-settles on an offline timeline that keeps
 * the whole flow exercisable without credentials. Only a charge that is ITSELF
 * fake takes this path, and only when the host opted in.
 *
 * THE PAYABLE'S OWN AMOUNT is correct here and must NOT become the snapshot's
 * (FUT-373/374): there is no provider behind a stub charge, nothing is ever
 * polled for it, and the stub snapshot hardcodes zero — so reading an amount
 * from it would park every dev/CI payable as a short payment and take the
 * offline timeline out of service. The library decides which of the two, not
 * the host.
 */
async function offlineSettle<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  charge: StoredCharge,
): Promise<string | null> {
  const offline = runtime.config.offlineSettlement;
  if (!offline || !charge.providerChargeId.startsWith('stub_')) return null;
  if (Date.now() - charge.createdAt.getTime() < offline.afterMs) {
    return runtime.config.payables.stateToken(payable);
  }
  return runtime.config.correlation.settle({
    ref: payable.ref,
    charge: attachedChargeOf(charge.snapshot),
    capturedAmount: payable.amount,
    method: charge.snapshot.method,
  });
}

/** Ask the provider what really happened, and apply it if it says PAID. */
async function reconcile<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  charge: StoredCharge,
  url: string,
): Promise<string> {
  const unchanged = runtime.config.payables.stateToken(payable);
  let snapshot;
  try {
    const gateway = await runtime.gateway();
    snapshot = await gateway.refreshCharge(
      payable.merchant,
      charge.provider,
      charge.providerChargeId,
      definedHints(url),
    );
  } catch (error) {
    // A provider outage must not break the buyer's polling screen — the webhook
    // is still the primary path, and the next poll retries.
    runtime.log.error(
      `[checkout] status reconcile failed for ${payable.ref}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return unchanged;
  }
  if (snapshot.status !== 'PAID') return unchanged;
  // FUT-373 — forward what the provider ACTUALLY captured, never the payable's
  // total. Echoing our own total back would settle any capture however small,
  // and would make the host's shortfall guard compare a number with itself.
  return runtime.config.correlation.settle({
    ref: payable.ref,
    charge: attachedChargeOf(snapshot),
    capturedAmount: snapshot.amount,
    method: snapshot.method,
  });
}

/**
 * Whether this payable's live charge has lapsed. Read from the CHARGE's own
 * `expiresAt` rather than from a host column: the provider granted that window,
 * so it is the only honest answer, and it keeps the library from needing a
 * deadline field on `Payable`.
 */
function lapsed(charge: StoredCharge): boolean {
  const expiresAt = charge.snapshot.pix?.expiresAt;
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  return !Number.isNaN(deadline) && deadline <= Date.now();
}

/** `GET /status` — poll a payable, settling it when the provider says so. */
export async function getStatus<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  request: Request,
  caller: C,
  intent: CheckoutRouteIntent,
): Promise<Response> {
  const loaded = await loadPayable(
    runtime,
    caller,
    payableRefOf(runtime.payableRefField, null, request.url),
    // A pure READ: nothing is being charged, so there is no method and no draft.
    { request, intent, method: null, draft: null },
  );
  if ('response' in loaded) return loaded.response;
  const { payable } = loaded;
  const unchanged = runtime.config.payables.stateToken(payable);
  if (payable.state !== 'OPEN') return runtime.respond.ok(unchanged);

  const charge = await latestCharge(runtime, payable);
  if (!charge) return runtime.respond.ok(unchanged);

  const expire = runtime.config.correlation.expire;
  if (expire && lapsed(charge)) return runtime.respond.ok(await expire(payable.ref));

  const offline = await offlineSettle(runtime, payable, charge);
  if (offline !== null) return runtime.respond.ok(offline);
  return runtime.respond.ok(await reconcile(runtime, payable, charge, request.url));
}

/**
 * `POST /refresh-key` — re-mint the merchant's PUBLIC browser key.
 *
 * The merchant is derived from the caller's OWN payable, never from a
 * client-supplied merchant handle: otherwise any signed-in buyer could trigger a
 * provider call plus a credential-row write against an arbitrary merchant. The
 * response carries the PUBLIC key only — it merely encrypts, and is already a
 * checkout page prop.
 */
export async function refreshBrowserKey<C, V extends object, D>(
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
    { request, intent, method: null, draft: null },
  );
  if ('response' in loaded) return loaded.response;
  const { payable } = loaded;

  const mint = runtime.config.browserKey;
  const provider = await runtime.config.credentials.defaultProvider(payable.merchant);
  if (!mint || !provider) return notConfigured(runtime);
  const credentials = await runtime.config.credentials.getCredentials(payable.merchant, provider);
  if (!credentials) return notConfigured(runtime);

  try {
    return runtime.respond.ok({ publicKey: await mint(payable.merchant, provider, credentials) });
  } catch (error) {
    // The MESSAGE only, never the error object: a provider error retains the
    // provider's parsed body, buyer tax id and all.
    runtime.log.error(
      `[payments] browser-key refresh failed for ${provider}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return runtime.respond.fail(
      {
        code: 'BROWSER_KEY_UNAVAILABLE',
        message: runtime.copy.genericProviderRefusal,
        field: null,
      },
      502,
    );
  }
}
