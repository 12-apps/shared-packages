/**
 * THE HOST'S OWN ROUTES on the admin mount — the two OAuth legs a real host
 * writes beside the library table (the origin host ships both shapes: an
 * `oauth/prepare` extension and a callback route), served through
 * `MountPaymentsOptions.extensions` so the same parse → auth → dispatch path
 * runs for them.
 *
 * ## Error mapping is the host's job here — mandatory
 *
 * `mountPayments` dispatches an extension with a bare `handler(...)` call:
 * there is no try/catch anywhere in the dispatcher, and `guarded` — the only
 * thing that turns a `PaymentsError` into a status — is applied only inside
 * `createPaymentsHttp`'s own handlers and is not exported. A throw from
 * `exchangeCode` → `oauth.complete` → the callback handler would otherwise
 * leave a status-less wire row and a rejected page fetch, with no response to
 * assert on. `hostGuard` is the mapping a real host owes its own extensions,
 * mirroring the subset of the package's `errorStatus` this harness can
 * actually produce.
 */
import {
  CredentialsError,
  PaymentsError,
  ProviderRequestError,
  verifyProviderCharge,
  type ActivationContext,
  type OAuthConnectService,
  type PaymentsRouteExtension,
  type ProviderConfigStore,
  type ProviderRegistry,
  type SettingsService,
  type VerifyChargeInput,
} from '@12-apps/payments-backend';

import type { AdminCaller } from './admin-ports';
import type { AdminSinks, AdminStoreSpec } from './admin-store';
import { PT_BR_ACTIVATION_COPY } from '@12-apps/payments-backend';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The mapping table: 502 upstream, 409 owner-actionable, 500 everything else. */
export async function hostGuard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return json({ error: error.name, message: error.message }, 502);
    }
    if (error instanceof CredentialsError) {
      return json({ error: error.name, message: error.message }, 409);
    }
    if (error instanceof PaymentsError) {
      return json({ error: error.name, message: error.message }, 500);
    }
    // A host must not let an unknown throw become an unhandled rejection in a
    // browser — and only an Error's message may cross the wire: stringifying
    // the value itself ships its stack in runtimes whose toString includes it.
    const message = error instanceof Error ? error.message : 'non-Error throw';
    return json({ error: 'HarnessError', message }, 500);
  }
}

/** The slug is the hash's PATH; anything after `?` is the page's own query. */
export function currentSlug(): string {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
}

/** Where the consent screen sends the browser back — this very page. */
export function callbackUrl(): string {
  return `${window.location.origin}${window.location.pathname}#/${currentSlug()}`;
}

/**
 * The fictional provider's authorize URL. Same origin, same path, FRAGMENT
 * differs only — so `window.location.assign(url)` is a same-document
 * navigation: the React tree stays mounted and the in-page mount, the memory
 * store and the wire log all survive the hop.
 */
export function consentUrl(provider: string, state: string): string {
  return `${window.location.origin}${window.location.pathname}#/${currentSlug()}?oauth=consent&state=${state}&provider=${provider}`;
}

/**
 * `POST {base}/oauth/prepare/:provider` — mint and persist the CSRF state
 * server-side (a browser must not mint its own), and answer with the callback
 * URL. The state is a counter, not `crypto.randomUUID()`: deterministic is
 * assertable.
 */
export function connectPrepareFor(
  world: AdminSinks,
  _spec: AdminStoreSpec,
): PaymentsRouteExtension<AdminCaller> {
  return {
    kind: 'hostConnectPrepare',
    method: 'POST',
    pattern: ['oauth', 'prepare', ':provider'],
    handler: () =>
      hostGuard(async () => {
        const state = `st_${world.mintedStates.length + 1}`;
        world.mintedStates.push(state);
        world.fire();
        return json({ state, redirectUri: callbackUrl(), environment: 'SANDBOX' }, 200);
      }),
  };
}

/**
 * `POST {base}/oauth/callback/:provider` — the CSRF comparison, then the
 * published `oauth.complete`. A state the world did not mint is refused with
 * 403 BEFORE any code is spent; that check happening on a host route is the
 * entire reason `completeOAuth` is excluded from the mount.
 */
/**
 * `POST {base}/activation/verify/:provider` — the host route behind the
 * activation step (FUT-463/FUT-689): run the package's card-phase verification
 * over this store's OWN ports, then settle enablement BOTH ways, exactly as
 * the origin host's route does. A refused verification answers 200 — it is the
 * ANSWER the screen exists to show, not a transport error.
 */
export function activationVerifyFor(
  world: AdminSinks,
  ports: { registry: ProviderRegistry; store: ProviderConfigStore; settings: SettingsService },
): PaymentsRouteExtension<AdminCaller> {
  return {
    kind: 'hostActivationVerify',
    method: 'POST',
    pattern: ['activation', 'verify', ':provider'],
    handler: ({ request, intent, merchant }) =>
      hostGuard(async () => {
        const input = (await request.json()) as VerifyChargeInput;
        const ctx: ActivationContext = {
          providers: ports.registry,
          // The words this host renders. Named, not inherited: the package
          // ships no default, so this line is where the flow's Portuguese is
          // chosen — and the journeys read the sentences it produces.
          copy: PT_BR_ACTIVATION_COPY,
          config: ports.store,
          settings: ports.settings,
          // The deployment's own yes: this store is a stub world by design.
          allowStubMode: true,
        };
        const provider = intent.provider ?? '';
        const result = await verifyProviderCharge(ctx, merchant, provider, input);
        await ports.settings.applyChargeVerification(merchant, provider, result.ok);
        world.fire();
        return json(result, 200);
      }),
  };
}

export function oauthCallbackFor(
  world: AdminSinks,
  oauth: OAuthConnectService,
): PaymentsRouteExtension<AdminCaller> {
  return {
    kind: 'hostOAuthCallback',
    method: 'POST',
    pattern: ['oauth', 'callback', ':provider'],
    handler: ({ request, intent, merchant }) =>
      hostGuard(async () => {
        const body = (await request.json()) as { code: string; state: string; redirectUri: string };
        world.consumedStates.push(body.state);
        world.fire();
        if (!world.mintedStates.includes(body.state)) return json({ error: 'InvalidState' }, 403);
        await oauth.complete(merchant, intent.provider ?? '', {
          code: body.code,
          redirectUri: body.redirectUri,
          environment: 'SANDBOX',
        });
        return json({ connected: true, provider: intent.provider }, 200);
      }),
  };
}
