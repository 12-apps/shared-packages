import type { OAuthConnectService } from '../config/oauth';
import type { SettingsService } from '../config/service';
import type { SaveCredentialsInput } from '../config/types';
import { toClientChargeView } from '../core/client-view';
import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ChargeNotPersistedError,
  CredentialsError,
  NoProviderSucceededError,
  PaymentsError,
  ProviderRequestError,
  UnknownProviderError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from '../core/errors';
import type { PaymentsGateway } from '../core/gateway';
import type { ChargeStore } from '../core/ports';
import type {
  ChargeInput,
  MerchantRef,
  PaymentEnvironment,
  ProviderName,
  SetupGuideContext,
} from '../core/types';

/**
 * Fetch-native HTTP surface — plug-and-play route handlers for both pages:
 * the buyer-facing checkout flow and the merchant-facing settings page.
 *
 * Every handler is `(Request, ctx) → Response` on the WHATWG fetch types, so
 * the same functions mount unchanged in a Next.js route handler, an Express
 * adapter, a Worker — or, later, a standalone payments microservice. The
 * host owns AUTH and MERCHANT ATTRIBUTION: it authenticates the caller,
 * decides the `MerchantRef` (tenant checkout vs platform billing vs admin
 * settings), and passes it as `ctx`. Handlers never read cookies/sessions.
 */
export interface PaymentsRequestContext {
  merchant: MerchantRef;
}

/**
 * The UNTRUSTED part of a charge request — what the browser is allowed to
 * choose. Money and order identity are deliberately absent: the buyer picks
 * a method and supplies payment instruments, the SERVER decides what is
 * owed and for which order.
 */
export interface ChargeRequestDraft {
  method: ChargeInput['method'];
  card?: ChargeInput['card'];
  pix?: ChargeInput['pix'];
  boleto?: ChargeInput['boleto'];
  /** Buyer-entered contact details (CPF/e-mail); the host may override. */
  customer?: Partial<ChargeInput['customer']>;
  /**
   * Opaque host-side handle for what is being paid (cart id, order id).
   * The host RESOLVES it against its own records — it is a lookup key, not
   * an authority on price.
   */
  orderRef?: string;
}

export interface PaymentsHttpDeps {
  gateway: PaymentsGateway;
  settings: SettingsService;
  charges: ChargeStore;
  /**
   * OAuth connect service — required only for `authMode: 'oauth'` providers.
   * Omit it and the connect endpoints return 404.
   */
  oauth?: OAuthConnectService;
  /**
   * Turn an untrusted browser draft into the authoritative `ChargeInput`.
   * REQUIRED, and required for a reason: the buyer must never be able to
   * choose `amount` or `reference`. The host looks the order up server-side
   * and returns the amount IT computed; anything the client sent for those
   * fields is discarded here (the draft type does not even carry them).
   * Throw from this resolver to reject the charge.
   */
  resolveChargeRequest: (
    merchant: MerchantRef,
    draft: ChargeRequestDraft,
  ) => Promise<ChargeInput>;
  /**
   * Host-computed, merchant-specific URLs interpolated into provider setup
   * guides (each merchant's webhook URL, etc.). Required for the
   * setup-guide endpoint; omit to disable it (404).
   */
  setupContextFor?: (
    merchant: MerchantRef,
    provider: ProviderName,
  ) => SetupGuideContext | Promise<SetupGuideContext>;
}

export interface PaymentsHttpHandlers {
  // ── checkout surface ────────────────────────────────────────────────
  /** GET — client-safe tokenization config for the active provider. */
  getClientConfig(ctx: PaymentsRequestContext): Promise<Response>;
  /** POST {ChargeInput} — create a charge, return the client-safe view. */
  createCharge(request: Request, ctx: PaymentsRequestContext): Promise<Response>;
  /** GET — current client-safe state of one charge (poll target). */
  getCharge(ctx: PaymentsRequestContext, provider: ProviderName, providerChargeId: string): Promise<Response>;
  /** POST raw provider delivery — verify, dedup, apply, notify. */
  handleWebhook(request: Request, ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  // ── settings surface ────────────────────────────────────────────────
  /** GET — provider catalog + masked per-provider config. */
  getSettings(ctx: PaymentsRequestContext): Promise<Response>;
  /** PUT {SaveCredentialsInput} — write-only credential update. */
  saveCredentials(request: Request, ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  /** PUT {enabled: boolean} — add to / remove from the failover chain. */
  setEnabled(request: Request, ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  /**
   * PUT {providers: string[]} — replace the whole failover chain in priority
   * order (drag-to-reorder). Anything omitted is disabled.
   */
  setPriorities(request: Request, ctx: PaymentsRequestContext): Promise<Response>;
  /** PUT {policy: 'TECHNICAL'|'TECHNICAL_AND_DECLINE'} — decline cascading. */
  setFailoverPolicy(request: Request, ctx: PaymentsRequestContext): Promise<Response>;
  /**
   * POST — run the credential probe against `environment` (default: the
   * active one) and report it. VERIFIED/FAILED is persisted only for the
   * ACTIVE environment, whose credentials `status` describes.
   */
  verify(
    ctx: PaymentsRequestContext,
    provider: ProviderName,
    environment?: PaymentEnvironment,
  ): Promise<Response>;
  /** GET — the provider's step-by-step onboarding walkthrough. */
  getSetupGuide(ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  // ── OAuth connect surface (authMode: 'oauth' providers) ─────────────
  /**
   * POST — begin authorization. The HOST generates and persists `state`
   * against the admin's session BEFORE calling this, and must compare it on
   * the callback: that is what stops a CSRF-forged connect.
   */
  beginOAuth(request: Request, ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  /** POST — finish authorization with the provider's callback code. */
  completeOAuth(request: Request, ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
  /** POST — disconnect: revoke at the provider, clear locally. */
  disconnectOAuth(ctx: PaymentsRequestContext, provider: ProviderName): Promise<Response>;
}

type OAuthHandlers = Pick<
  PaymentsHttpHandlers,
  'beginOAuth' | 'completeOAuth' | 'disconnectOAuth'
>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Uniform error→HTTP mapping, so hosts get consistent statuses everywhere. */
function errorStatus(error: PaymentsError): number {
  if (error instanceof UnknownProviderError) return 404;
  if (error instanceof UnsupportedOperationError) return 422;
  if (error instanceof ChargeDeclinedError) return 402;
  if (error instanceof WebhookVerificationError) return 401;
  // 409, deliberately NOT a 5xx: a charge whose outcome we could not
  // determine must not look retryable to a client or a proxy. Retrying is
  // exactly what would double-charge the buyer; this needs reconciliation.
  if (error instanceof AmbiguousChargeError) return 409;
  // The charge EXISTS at the provider; only our copy is missing. Same rule as
  // above — it must not look retryable, because a retry is what creates the
  // duplicate.
  if (error instanceof ChargeNotPersistedError) return 409;
  if (error instanceof CredentialsError) return 409;
  // Every provider in the chain failed — an upstream problem, not the
  // caller's, and safe to retry once something upstream recovers.
  if (error instanceof NoProviderSucceededError) return 502;
  if (error instanceof ProviderRequestError) return 502;
  return 500;
}

/**
 * The PROVIDER-facing guard: a refusal must be a status the provider will
 * REDELIVER on.
 *
 * The admin API's status mapping is about telling a human operator what went
 * wrong; this is about a machine deciding whether to try again, and the two
 * disagree. InfinitePay documents exactly two answers — 200 for accepted, 400
 * to be re-sent — so a refusal that came back 401 (verification failed) or 409
 * (`CredentialsError`) told it, in effect, do not come back. Every other
 * provider treats any non-2xx as retryable, so 400 is the safe common answer.
 *
 * That mattered: while the activation gate was refusing confirmations with a
 * 409, the payments were not merely rejected, they were rejected in a way that
 * stopped the redelivery which would have fixed them once the gate was.
 *
 * Retrying is the RIGHT outcome for almost everything that can fail here. A
 * failed verification is not proof of a forgery — for an unsigned provider,
 * `verify` is a live call back to it, so a network blip there refuses a real
 * payment. The inbox and the replay drain are built on the same doctrine: fail
 * closed, recover by asking again. The one refusal that must NOT invite a retry
 * is an unknown store, and the host answers that before reaching this.
 */
async function guardedWebhook(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PaymentsError) {
      return json({ error: error.name, message: error.message }, 400);
    }
    throw error;
  }
}

async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PaymentsError) {
      return json({ error: error.name, message: error.message }, errorStatus(error));
    }
    throw error;
  }
}

/** Lower-cased header map of a fetch Request (adapters expect lower-case). */
function lowerHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/** The three OAuth connect endpoints; all 404 when no service is wired. */
function makeOAuthHandlers(oauth: OAuthConnectService | undefined): OAuthHandlers {
  const noOAuth = (): Response =>
    json({ error: 'NotFound', message: 'OAuth connect is not enabled' }, 404);

  return {
    beginOAuth: (request, ctx, provider) =>
      guarded(async () => {
        if (!oauth) return noOAuth();
        const body = (await request.json()) as {
          state: string;
          redirectUri: string;
          environment?: 'SANDBOX' | 'PRODUCTION';
        };
        return json(await oauth.begin(ctx.merchant, provider, body));
      }),

    completeOAuth: (request, ctx, provider) =>
      guarded(async () => {
        if (!oauth) return noOAuth();
        const body = (await request.json()) as {
          code: string;
          redirectUri: string;
          environment?: 'SANDBOX' | 'PRODUCTION';
        };
        const config = await oauth.complete(ctx.merchant, provider, body);
        // Never echo the tokens back — only the connection's public state.
        return json({
          provider: config.provider,
          status: config.status,
          expiresAt: config.expiresAt,
        });
      }),

    disconnectOAuth: (ctx, provider) =>
      guarded(async () => {
        if (!oauth) return noOAuth();
        await oauth.disconnect(ctx.merchant, provider);
        return json({ disconnected: true });
      }),
  };
}

type SettingsHandlers = Pick<
  PaymentsHttpHandlers,
  | 'getSettings'
  | 'saveCredentials'
  | 'setEnabled'
  | 'setPriorities'
  | 'setFailoverPolicy'
  | 'verify'
  | 'getSetupGuide'
>;

/** The merchant-admin settings surface. */
function makeSettingsHandlers(
  settings: SettingsService,
  setupContextFor: PaymentsHttpDeps['setupContextFor'],
): SettingsHandlers {
  return {
    getSettings: (ctx) => guarded(async () => json(await settings.getSettings(ctx.merchant))),

    saveCredentials: (request, ctx, provider) =>
      guarded(async () => {
        const input = (await request.json()) as SaveCredentialsInput;
        return json(await settings.saveCredentials(ctx.merchant, provider, input));
      }),

    setEnabled: (request, ctx, provider) =>
      guarded(async () => {
        const { enabled } = (await request.json()) as { enabled: boolean };
        return json(await settings.setEnabled(ctx.merchant, provider, enabled));
      }),

    setPriorities: (request, ctx) =>
      guarded(async () => {
        const body = (await request.json()) as { providers?: unknown };
        // The chain is routing configuration, so a malformed body is rejected
        // rather than coerced — silently dropping an unparseable entry would
        // take a provider out of rotation without telling anyone.
        if (!Array.isArray(body.providers) || body.providers.some((p) => typeof p !== 'string')) {
          return json(
            { error: 'BadRequest', message: '`providers` must be an array of provider names' },
            400,
          );
        }
        return json(await settings.setPriorities(ctx.merchant, body.providers as ProviderName[]));
      }),

    setFailoverPolicy: (request, ctx) =>
      guarded(async () => {
        const body = (await request.json()) as { policy?: unknown };
        // A closed set, validated rather than coerced: silently defaulting an
        // unrecognised value would decide a fraud-and-fees question for the
        // merchant without telling them.
        if (body.policy !== 'TECHNICAL' && body.policy !== 'TECHNICAL_AND_DECLINE') {
          return json(
            {
              error: 'BadRequest',
              message: '`policy` must be TECHNICAL or TECHNICAL_AND_DECLINE',
            },
            400,
          );
        }
        return json(await settings.setFailoverPolicy(ctx.merchant, body.policy));
      }),

    verify: (ctx, provider, environment) =>
      guarded(async () => json(await settings.verify(ctx.merchant, provider, environment))),

    getSetupGuide: (ctx, provider) =>
      guarded(async () => {
        if (!setupContextFor) return json({ error: 'NotFound', message: 'No setup guides' }, 404);
        const guide = settings.setupGuide(provider, await setupContextFor(ctx.merchant, provider));
        return guide ? json(guide) : json({ error: 'NotFound', message: 'No setup guide' }, 404);
      }),
  };
}

export function createPaymentsHttp(deps: PaymentsHttpDeps): PaymentsHttpHandlers {
  const { gateway, settings, charges, oauth, resolveChargeRequest, setupContextFor } = deps;

  return {
    ...makeOAuthHandlers(oauth),
    getClientConfig: (ctx) =>
      guarded(async () => json(await gateway.clientConfig(ctx.merchant))),

    createCharge: (request, ctx) =>
      guarded(async () => {
        const draft = (await request.json()) as ChargeRequestDraft;
        // The ONLY charge input that reaches the gateway is the one the
        // host derived server-side; amount and reference never come from
        // the browser.
        const input = await resolveChargeRequest(ctx.merchant, draft);
        const stored = await gateway.charge(ctx.merchant, input);
        return json(toClientChargeView(stored.snapshot), 201);
      }),

    getCharge: (ctx, provider, providerChargeId) =>
      guarded(async () => {
        const stored = await charges.findByProviderChargeId(provider, providerChargeId);
        // Ownership check: a charge id belonging to another merchant is 404,
        // indistinguishable from "does not exist".
        if (
          !stored ||
          stored.merchant.kind !== ctx.merchant.kind ||
          stored.merchant.id !== ctx.merchant.id
        ) {
          return json({ error: 'NotFound', message: 'Unknown charge' }, 404);
        }
        return json(toClientChargeView(stored.snapshot));
      }),

    handleWebhook: (request, ctx, provider) =>
      guardedWebhook(async () => {
        const events = await gateway.handleWebhook(ctx.merchant, {
          provider,
          // RAW body — signature schemes verify bytes, never a re-serialize.
          rawBody: await request.text(),
          headers: lowerHeaders(request),
        });
        return json({ processed: events.length });
      }),

    ...makeSettingsHandlers(settings, setupContextFor),
  };
}
