import type { ProviderConfigStore } from '../config/types';
import { providerCorrelationId } from '../core/client-view';
import type { PaymentsGateway } from '../core/gateway';
import type { ChargeQueryStore, ChargeStore, CredentialStore } from '../core/ports';
import type { ProviderRegistry } from '../core/registry';
import type { ChargeSnapshot, MerchantRef, PaymentMethodKind } from '../core/types';

import type { CheckoutCopy } from './copy';
import { checkoutRefusalFor, type CheckoutRefusal, type FailureContext } from './failure';
import type {
  AttachedCharge,
  BrowserKeyPort,
  ChargeCorrelationPort,
  CheckoutErrorBody,
  CheckoutIntentKind,
  CheckoutLogger,
  CheckoutResponder,
  CheckoutRouteIntent,
  Payable,
  PayableLoadContext,
  PayablePort,
  SavedInstrumentPort,
} from './types';
import type { BuyerVaultPort } from './vault-port';

/**
 * The mount's configuration, and the resolved runtime the flows actually run
 * against. Kept apart from `factory.ts` so the flow modules can depend on the
 * runtime without depending on the factory that builds it.
 */
export interface PaymentFlowsBEConfig<Caller, View extends object, Display = unknown> {
  /** The built gateway, or a lazy getter for hosts that build once per process. */
  gateway: PaymentsGateway | (() => PaymentsGateway | Promise<PaymentsGateway>);
  charges: ChargeStore & ChargeQueryStore;
  credentials: CredentialStore;
  /**
   * The stub flag on a stored connection, and the row a lazily-minted browser
   * key is cached onto — the only write.
   */
  connections: Pick<ProviderConfigStore, 'get' | 'save'>;
  /**
   * The adapters this deployment routes to. Supplied, a key-less connection
   * backfills its browser key from the adapter's own `browserKey` capability;
   * omitted, only an explicit `browserKey` port can do it.
   */
  providers?: ProviderRegistry;

  /**
   * Host auth, run BEFORE anything else with the parsed intent — and ONLY for
   * rows whose `principal` is `BUYER`. Return a `Response` to refuse; a throw
   * propagates to the host's own error mapping.
   *
   * A `PUBLIC` row never reaches it, so a host cannot accidentally make a
   * settling route anonymous by mis-branching a `switch (intent.kind)`. The
   * worst a host mistake can do is OVER-authenticate the public config read,
   * which degrades a page load rather than a settlement.
   */
  requireAuth(
    request: Request,
    intent: CheckoutRouteIntent,
  ): Promise<Caller | Response> | Caller | Response;

  /**
   * Merchant attribution for the rows that carry NO payable. Everything else
   * takes its merchant from `payable.merchant`, which is the only attribution a
   * client-supplied handle can never forge. `null` fails closed.
   */
  resolveMerchant(input: {
    request: Request;
    intent: CheckoutRouteIntent;
    caller: Caller | null;
  }): Promise<MerchantRef | null> | MerchantRef | null;

  payables: PayablePort<Caller, View>;
  correlation: ChargeCorrelationPort;
  instruments?: SavedInstrumentPort<Caller, Display>;
  /**
   * The ownership facts for vaulting a card OUTSIDE a purchase (FUT-478):
   * `reference`/`customerRef` derived from the CALLER and scope, never from a
   * request body. Optional — without it (or without `instruments.save`) the
   * `/cards/begin` + `/cards/complete` rows answer the admin surface's 404
   * BEFORE any adapter runs, so no provider-side token is ever orphaned.
   */
  vault?: BuyerVaultPort<Caller>;
  browserKey?: BrowserKeyPort;

  copy: CheckoutCopy;
  /** One vendor's error vocabulary. See `FailureContext.mapProviderError`. */
  mapProviderError?: (error: unknown) => CheckoutErrorBody | null;
  /**
   * See a THROWN charge failure raw, before it is worded (FUT-490) — the
   * account-bookkeeping seam. An adopting host flips the merchant's connection
   * to FAILED on an account-level rejection (401/403), so its settings screen
   * surfaces the outage instead of a stale VERIFIED. Fired from both money
   * paths' catch; a guard refusal (an identity mismatch) is an outcome, not an
   * error, and never reaches it. Awaited, and CONTAINED: a hook that throws is
   * logged and cannot mask the refusal the buyer is owed.
   */
  onChargeError?: (merchant: MerchantRef, error: unknown) => Promise<void> | void;
  respond?: CheckoutResponder;
  logger?: CheckoutLogger;

  /**
   * The wire field naming the payable, on both a body and a query string.
   *
   * Defaults to `orderId`, which is what the published frontend sends. That
   * default is the ugliest thing in this design and it is deliberate: renaming
   * it would break `@12-apps/payments-frontend`'s client in the same release
   * that introduces the mount. The library never interprets its CONTENTS, only
   * its position.
   */
  payableRefField?: string;

  /**
   * Dev/CI only: when a charge is the STUB adapters' own (`stub_` prefix), let
   * a poll self-settle it after this long. Omit in production.
   */
  offlineSettlement?: { afterMs: number };

  /** Rows to exclude from this mount. */
  exclude?: readonly CheckoutIntentKind[];
  prefix?: readonly string[];
  segmentsParam?: string;
  notFound?(): Response;
  methodNotAllowed?(allow: readonly string[]): Response;
}

/**
 * The default envelope. Deliberately the shape `@12-apps/payments-frontend`'s
 * client already parses, so the default is the PUBLISHED contract rather than
 * one host's house style — a host with a different envelope passes `respond`.
 */
const defaultResponder: CheckoutResponder = {
  ok: (data, status = 200) => Response.json({ data }, { status }),
  fail: (body, status) =>
    Response.json({ error: body.message, code: body.code, field: body.field }, { status }),
};

/**
 * The fallback logger writes NOTHING. Silence is the honest default: a library
 * that reaches for `console.error` is invisible to a host whose server-side
 * error reporting hangs off its own logger — so the line is written nowhere
 * anyone reads it. A host that wants these lines passes `logger`.
 */
const silentLogger: CheckoutLogger = {
  warn: () => undefined,
  error: () => undefined,
  providerFailure: () => undefined,
};

export interface CheckoutRuntime<Caller, View extends object, Display = unknown> {
  config: PaymentFlowsBEConfig<Caller, View, Display>;
  gateway(): Promise<PaymentsGateway>;
  charges: ChargeStore & ChargeQueryStore;
  copy: CheckoutCopy;
  respond: CheckoutResponder;
  log: CheckoutLogger;
  payableRefField: string;
}

export function createRuntime<Caller, View extends object, Display>(
  config: PaymentFlowsBEConfig<Caller, View, Display>,
): CheckoutRuntime<Caller, View, Display> {
  return {
    config,
    gateway: async () =>
      typeof config.gateway === 'function' ? config.gateway() : config.gateway,
    charges: config.charges,
    copy: config.copy,
    respond: config.respond ?? defaultResponder,
    log: config.logger ?? silentLogger,
    payableRefField: config.payableRefField ?? 'orderId',
  };
}

/** Send a refusal through the host's responder. */
export function sendRefusal(
  runtime: { respond: CheckoutResponder },
  refusal: CheckoutRefusal,
): Response {
  return runtime.respond.fail(refusal.body, refusal.status);
}

/** The wording pipeline's inputs, assembled from the runtime once per failure. */
export function failureContext<Caller, View extends object, Display>(
  runtime: CheckoutRuntime<Caller, View, Display>,
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

/**
 * Word a THROWN charge failure and answer it — after the host's bookkeeping
 * hook has seen the raw error. Both money paths' catch blocks end here, so
 * `onChargeError` cannot be skipped on one of them.
 */
export async function chargeRefusal<Caller, View extends object, Display>(
  runtime: CheckoutRuntime<Caller, View, Display>,
  payable: Payable,
  error: unknown,
): Promise<Response> {
  try {
    await runtime.config.onChargeError?.(payable.merchant, error);
  } catch (hookError) {
    // Contained: host bookkeeping must never mask the refusal the buyer is owed.
    runtime.log.error(
      `[payments] onChargeError hook failed for ${payable.ref}: ${
        hookError instanceof Error ? hookError.message : String(hookError)
      }`,
    );
  }
  const context = failureContext(runtime, payable.ref, payable.method);
  return sendRefusal(runtime, checkoutRefusalFor(context, error));
}

/** The merchant cannot take payment at all. 409: a state the buyer cannot fix. */
export function notConfigured(runtime: {
  respond: CheckoutResponder;
  copy: CheckoutCopy;
}): Response {
  return runtime.respond.fail(
    { code: 'PAYMENT_NOT_CONFIGURED', message: runtime.copy.notConfigured, field: null },
    409,
  );
}

/**
 * No payable under that handle — or not this caller's, or not one THIS request
 * may charge. Deliberately one answer for all three: the replaced host route
 * 404'd a non-card order with the same body it 404'd a stranger's order with,
 * and telling them apart tells a prober which handles exist.
 */
export function payableNotFound(runtime: {
  respond: CheckoutResponder;
  copy: CheckoutCopy;
}): Response {
  return runtime.respond.fail(
    { code: 'PAYABLE_NOT_FOUND', message: runtime.copy.payableNotFound, field: null },
    404,
  );
}

/** The correlation a host must write, derived from the snapshot alone. */
export function attachedChargeOf(snapshot: ChargeSnapshot): AttachedCharge {
  return {
    provider: snapshot.provider,
    providerChargeId: snapshot.providerChargeId,
    providerOrderId: providerCorrelationId(snapshot),
  };
}

/** A JSON body, or `{}` for a request that carried none. Never throws. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return {};
  }
}

/**
 * The payable handle a request names, from the body or the query string.
 *
 * Read by POSITION, never interpreted: whatever string sits under
 * `payableRefField` is handed straight to `payables.load`, which is the host's
 * own authorization scope. A handle that names nothing, or names somebody
 * else's payable, comes back `null` there and is answered 404.
 */
export function payableRefOf(field: string, source: unknown, url: string): string | null {
  if (source && typeof source === 'object') {
    const value = (source as Record<string, unknown>)[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return new URL(url).searchParams.get(field) || null;
}

/**
 * Load the payable a request names, or the refusal to send instead.
 *
 * `context` is the request as PARSED ({@link PayableLoadContext}) — the intent,
 * the method being charged and the normalized draft. It travels because the
 * host's `load` is the authorization scope and could not previously see what it
 * was authorizing; see the port's own doc.
 */
export async function loadPayable<Caller, View extends object, Display>(
  runtime: CheckoutRuntime<Caller, View, Display>,
  caller: Caller,
  ref: string | null,
  context: PayableLoadContext,
): Promise<{ payable: Payable } | { response: Response }> {
  if (!ref) return { response: payableNotFound(runtime) };
  const payable = await runtime.config.payables.load(caller, ref, context);
  if (!payable) return { response: payableNotFound(runtime) };
  return { payable };
}
