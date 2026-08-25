/**
 * THE HOST'S PORTS for the merchant admin store — auth, merchant attribution's
 * neighbours, the setup-guide context, the platform's OAuth app credentials.
 *
 * Every port here is a FACTORY returning the port, never a module-level port:
 * each one closes over the case's `spec`, the world's sinks or the store, and
 * that shape is also what keeps `createAdminStore` a short assembly under the
 * size gate — the same arrangement `store.ts` uses for `instrumentsPort`.
 */
import type {
  MountPaymentsOptions,
  OAuthAppCredentialsResolver,
  PaymentsHttpDeps,
  ProviderConfigStore,
  ProviderRegistry,
  RevokeFailureReporter,
} from '@12-apps/payments-backend';
// Through the accessor: `credentialSchema` is a COPY SOURCE and may be a
// resolver, so a consumer reading the field directly gets a function where it
// expected an array. No locale is passed because the only thing read below is
// `field.key` — a STRUCTURAL question, which has no reader and must not be
// made to invent one.
import { credentialSchemaOf } from '@12-apps/payments-backend';

import type { AdminSinks, AdminStoreSpec, PrepareConnect } from './admin-store';

/** What `requireAuth` answers with when it does not refuse. */
export interface AdminCaller {
  id: string;
}

const OWNER: AdminCaller = { id: 'owner-1' };

/**
 * Host auth: the store owner, unless the case scripted a refusal.
 *
 * `request.clone()` is load-bearing whenever `whenEnabled` is set:
 * `mountPayments` hands the SAME `Request` object to `requireAuth` and then to
 * the handler, so reading the original body here starves the handler and turns
 * a 403 test into a confusing 400.
 */
export function requireAuthFor(spec: AdminStoreSpec): MountPaymentsOptions<AdminCaller>['requireAuth'] {
  return async (request, intent) => {
    const refuse = spec.refuse;
    if (!refuse || intent.kind !== refuse.kind) return OWNER;
    if (refuse.whenEnabled !== undefined) {
      const body = (await request.clone().json()) as { enabled?: boolean };
      if (body.enabled !== refuse.whenEnabled) return OWNER;
    }
    return new Response(JSON.stringify({ error: 'HarnessRefusal' }), { status: refuse.status });
  };
}

/**
 * The host-computed guide context, with a REAL `SetupProgress` derived from
 * the stored row. Omitting `progress` makes every guide print all its stages,
 * and the walkthrough assertions become untestable.
 */
export function setupContextFor(
  store: ProviderConfigStore,
  registry: ProviderRegistry,
): NonNullable<PaymentsHttpDeps['setupContextFor']> {
  return async (merchant, provider) => {
    const row = await store.get(merchant, provider);
    const schema = credentialSchemaOf(registry.get(provider));
    const fields = row ? row.environments[row.environment] : {};
    return {
      // The ADOPTER's own platform name, supplied by the adopter — the fact
      // this harness exists to prove. Guides that address the platform by
      // name ("é assim que o {brandName} confirma…") used to say one specific
      // adopter's brand whoever installed the package, and a consumer built
      // against the published TARBALL is the only place the substitution can
      // be observed end to end. Deliberately a name no adopter is called.
      brandName: 'Plataforma Harness',
      webhookUrl: `https://loja.exemplo/api/pagamentos/webhooks/${provider}`,
      publicKeyUrl: 'https://loja.exemplo/api/pagamentos/chave-publica',
      merchantName: 'Loja Harness',
      storefrontUrl: 'https://loja.exemplo',
      progress: {
        configured: Object.fromEntries(schema.map((field) => [field.key, Boolean(fields[field.key])])),
        // The probe has passed — `RECONNECT_REQUIRED` still counts, because a
        // dead grant was once proven and the guide must not send the owner
        // back to step one to fix it.
        connected: row?.status === 'VERIFIED' || row?.status === 'RECONNECT_REQUIRED',
        proven: Boolean(row?.chargeVerifiedAt),
      },
    };
  };
}

/**
 * The platform's OAuth application credentials, per (provider, environment) —
 * and `null` for a provider the case listed in `unregisteredApps`, which is
 * how `createOAuthConnectService`'s `CredentialsError` becomes an assertable
 * 409 on `beginOAuth`.
 */
export function appCredentialsFor(spec: AdminStoreSpec): OAuthAppCredentialsResolver {
  return (provider, environment) =>
    spec.unregisteredApps?.includes(provider)
      ? null
      : { environment, fields: { clientId: 'app-harness', clientSecret: 'segredo-app' }, stub: true };
}

/** The swallowed-revoke seam: the failure lands in the world, visibly. */
export function onRevokeFailure(world: AdminSinks): RevokeFailureReporter {
  return (failure) => {
    world.revokeFailures.push(failure.provider);
    world.fire();
  };
}

/**
 * Required by `createPaymentsHttp` and unreachable: every admin mount
 * excludes the charge intents (`createCharge`/`getCharge`/`handleWebhook`/
 * `getClientConfig`), so nothing can route here. A thrower says so louder
 * than a stub that would quietly mint a charge nobody resolved.
 */
export const resolveChargeRequest: PaymentsHttpDeps['resolveChargeRequest'] = async () => {
  throw new Error('unreachable: every admin mount excludes the charge intents');
};

/**
 * The published component's `prepareConnect`: the host route that mints and
 * persists the CSRF state — `POST {base}/oauth/prepare/{p}`, on the wire, so
 * its order relative to the client's own calls is assertable.
 */
export function prepareConnectFor(fetchImpl: typeof fetch, baseUrl: string): PrepareConnect {
  return async (provider, environment) => {
    const response = await fetchImpl(`${baseUrl}/oauth/prepare/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ environment }),
    });
    // Mirror the published client's own refusal shape: a non-2xx becomes a
    // throw whose message is the raw body, surfaced by the component's alert.
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as Awaited<ReturnType<PrepareConnect>>;
  };
}
