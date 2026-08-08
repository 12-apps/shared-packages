import { CredentialsError, UnknownProviderError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef, PaymentEnvironment, ProviderName, ResolvedCredentials } from '../core/types';
import { preserveIdentityFields } from './connected-account';
import type { ProviderConfigStore, StoredProviderConfig } from './types';

/**
 * OAuth connect service — the "merchant clicks Connect" half of provider
 * onboarding, kept separate from the credential-form service because the
 * two flows share nothing but the storage row.
 *
 * The platform's APPLICATION credentials (client id/secret) are shared
 * across every merchant, so they are NOT stored per-merchant: the host
 * supplies them per (provider, environment) via `appCredentials`. What ends
 * up in the merchant's row is only the tokens the flow produces.
 */
export interface OAuthAppCredentialsResolver {
  (provider: ProviderName, environment: PaymentEnvironment): ResolvedCredentials | null;
}

/** What a swallowed revoke failure looked like — see {@link RevokeFailureReporter}. */
export interface RevokeFailure {
  merchant: MerchantRef;
  provider: ProviderName;
  /** The environment whose grant may still be live at the provider. */
  environment: PaymentEnvironment;
  error: unknown;
}

/**
 * Told when a `disconnect` could not revoke a merchant's grant.
 *
 * `disconnect` deliberately ignores every revoke failure so local cleanup
 * always runs — a merchant must never be stranded with a connection they
 * cannot remove. The cost was that the failure became INVISIBLE: the row says
 * disconnected, the confirmation dialog said the authorization was revoked,
 * and the grant is still live at the provider with nobody aware of it.
 *
 * This is the seam that reports it without changing that control flow. It is
 * not a logger the package grew — it is host-supplied, like every other
 * resolver here, and the host decides what a surviving grant is worth telling
 * anyone. It is called for its effects only: a reporter that throws is
 * swallowed, because reporting a problem may not become one.
 */
export interface RevokeFailureReporter {
  (failure: RevokeFailure): void;
}

export interface OAuthConnectService {
  /** Step 1 — where to send the merchant, plus the state to persist/echo. */
  begin(
    merchant: MerchantRef,
    provider: ProviderName,
    ctx: { state: string; redirectUri: string; environment?: PaymentEnvironment },
  ): Promise<{ url: string; state: string }>;
  /** Step 2 — exchange the callback code and store the merchant's tokens. */
  complete(
    merchant: MerchantRef,
    provider: ProviderName,
    ctx: { code: string; redirectUri: string; environment?: PaymentEnvironment },
  ): Promise<StoredProviderConfig>;
  /**
   * Renew a connection before it expires. Hosts drive this from a sweep over
   * the `expires_at` column; on failure the row is marked
   * RECONNECT_REQUIRED so the settings page can prompt for reauthorization.
   */
  refresh(merchant: MerchantRef, provider: ProviderName): Promise<StoredProviderConfig>;
  /**
   * Disconnect: best-effort revoke at the provider, then clear locally. A
   * revoke that fails never stops the local cleanup; it is handed to the
   * host's {@link RevokeFailureReporter} instead, so a grant left live at the
   * provider is at least visible to someone.
   */
  disconnect(merchant: MerchantRef, provider: ProviderName): Promise<void>;
}

function oauthOf(adapter: PaymentProviderAdapter): NonNullable<PaymentProviderAdapter['oauth']> {
  if (!adapter.oauth) {
    throw new CredentialsError(adapter.name, `Provider ${adapter.name} does not support OAuth connect`);
  }
  return adapter.oauth;
}

function emptyConfig(provider: ProviderName, environment: PaymentEnvironment): StoredProviderConfig {
  return {
    provider,
    enabled: false,
    priority: 0,
    environment,
    status: 'UNVERIFIED',
    lastVerifiedAt: null,
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: false,
    environments: { SANDBOX: {}, PRODUCTION: {} },
  };
}

interface OAuthDeps {
  adapterOf: (provider: ProviderName) => PaymentProviderAdapter;
  appCreds: (provider: ProviderName, environment: PaymentEnvironment) => ResolvedCredentials;
  store: ProviderConfigStore;
  reportRevokeFailure?: RevokeFailureReporter;
}

async function completeConnect(
  deps: OAuthDeps,
  merchant: MerchantRef,
  provider: ProviderName,
  ctx: { code: string; redirectUri: string; environment?: PaymentEnvironment },
): Promise<StoredProviderConfig> {
  const adapter = deps.adapterOf(provider);
  const environment = ctx.environment ?? 'PRODUCTION';
  const tokens = await oauthOf(adapter).exchangeCode(ctx.code, deps.appCreds(provider, environment), {
    redirectUri: ctx.redirectUri,
  });
  const config = (await deps.store.get(merchant, provider)) ?? emptyConfig(provider, environment);
  config.environment = environment;
  // `connectedAt` is stamped HERE, not by the adapter: a completed exchange is
  // the connect moment whoever the vendor is, and the settings page reads it
  // back as "conectada em" (FUT-300). A reconnect re-stamps on purpose — it is
  // a new authorization, possibly of a different account.
  config.environments[environment] = { ...tokens.fields, connectedAt: new Date().toISOString() };
  config.expiresAt = tokens.expiresAt ?? null;
  // A completed authorization IS proof the connection works — no separate
  // verify probe needed, unlike a pasted credential set.
  config.status = 'VERIFIED';
  config.lastVerifiedAt = new Date();
  await deps.store.save(merchant, config);
  return config;
}

async function refreshConnect(
  deps: OAuthDeps,
  merchant: MerchantRef,
  provider: ProviderName,
): Promise<StoredProviderConfig> {
  const adapter = deps.adapterOf(provider);
  const existing = await deps.store.get(merchant, provider);
  if (!existing) throw new CredentialsError(provider, `Provider ${provider} is not connected`);
  const environment = existing.environment;

  /**
   * Whether the provider has ROTATED — issued new tokens and invalidated the
   * ones we still hold. Past this point our stored copy is already dead at the
   * provider, so failing to persist is not a retryable hiccup: it destroys the
   * connection.
   */
  let rotated = false;

  try {
    const tokens = await oauthOf(adapter).refresh(
      { environment, fields: existing.environments[environment], stub: existing.stub },
      deps.appCreds(provider, environment),
    );
    rotated = true;
    // A refresh renews the SAME grant, so the identity recorded at connect
    // time survives an adapter whose refresh response carries tokens only.
    existing.environments[environment] = preserveIdentityFields(
      existing.environments[environment],
      tokens.fields,
    );
    existing.expiresAt = tokens.expiresAt ?? null;
    existing.status = 'VERIFIED';
    existing.lastVerifiedAt = new Date();
  } catch (error) {
    // A rotation that then failed locally is NOT the reauthorize case — the
    // provider accepted us, we simply could not keep what it gave back. Let it
    // out rather than recording a state that misdescribes what happened.
    if (rotated) throw error;
    // The merchant must reauthorize — a distinct state from FAILED, because
    // the remedy is a button, not a corrected credential.
    existing.status = 'RECONNECT_REQUIRED';
  }

  try {
    await deps.store.save(merchant, existing);
  } catch (error) {
    if (!rotated) throw error;
    // Loud on purpose. The tokens we were just handed are the ONLY ones that
    // still work, and they are now lost — the merchant has to reauthorize, and
    // an operator has to know why. A bare storage error here would read as a
    // transient blip and hide that the connection is gone.
    throw new CredentialsError(
      provider,
      `Provider ${provider} rotated its tokens but they could not be stored; the previous ` +
        `tokens are already invalid at the provider, so this connection must be reauthorized. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return existing;
}

const ALL_ENVIRONMENTS: readonly PaymentEnvironment[] = ['SANDBOX', 'PRODUCTION'];

/**
 * Hand a revoke failure to the host, and let nothing it does escape.
 *
 * The reporter is host code running inside the one loop that must always
 * reach the local cleanup below it. A reporter that throws — a logger with a
 * dead transport, a metrics client mid-reconnect — would abort the disconnect
 * and strand the merchant, which is the exact failure the surrounding
 * `try`/`catch` exists to prevent. So the report is best-effort too.
 */
function reportRevokeFailure(deps: OAuthDeps, failure: RevokeFailure): void {
  try {
    deps.reportRevokeFailure?.(failure);
  } catch {
    // Nothing left to report it TO. Losing the report is survivable; losing
    // the disconnect is not.
  }
}

async function disconnectConnect(
  deps: OAuthDeps,
  merchant: MerchantRef,
  provider: ProviderName,
): Promise<void> {
  const adapter = deps.adapterOf(provider);
  const existing = await deps.store.get(merchant, provider);
  if (!existing) return;
  const revoke = adapter.oauth?.revoke;

  // Revoke EVERY environment that holds tokens, not just the active one: a
  // merchant who connected sandbox and then production must not be left with
  // a live grant in the environment they are not currently using.
  for (const environment of ALL_ENVIRONMENTS) {
    const fields = existing.environments[environment];
    if (!revoke || Object.keys(fields).length === 0) continue;
    // Best effort, and the try/catch must WRAP credential resolution too —
    // `appCreds` throws synchronously when the platform's application
    // credentials for an environment are missing or rotated, and as a plain
    // argument that throw would escape a `.catch()` on the returned promise
    // and abort the disconnect before any local cleanup ran. Nothing here
    // may strand a merchant with a connection they cannot remove.
    try {
      await revoke(
        { environment, fields, stub: existing.stub },
        deps.appCreds(provider, environment),
      );
    } catch (error) {
      // Reported, never rethrown — local cleanup below is what must always
      // happen. Silence here is what left a merchant "disconnected" locally
      // while their grant stayed live at the provider, with no record that
      // anyone could have acted on.
      reportRevokeFailure(deps, { merchant, provider, environment, error });
    }
  }

  // ONE write: disabling and clearing the tokens land together, so a failure
  // can never leave payments switched off with the connection still stored.
  // Dropping out of the chain only ever REMOVES a rank, which cannot collide
  // on the partial unique index, so no chain rewrite is needed. It can leave
  // the remaining ranks sparse (0, 2, 3), which is harmless: order comes from
  // sorting by rank, not from the ranks being contiguous.
  existing.enabled = false;
  for (const environment of ALL_ENVIRONMENTS) existing.environments[environment] = {};
  existing.expiresAt = null;
  existing.status = 'UNVERIFIED';
  // The row OUTLIVES the disconnect (it still carries the merchant's chosen
  // environment and its place in the catalog), so every field that describes a
  // connection has to be cleared with the tokens — otherwise the leftovers keep
  // describing one that no longer exists. `lastVerifiedAt` is the one that got
  // missed: a disconnected store went on reporting when it was last proven.
  existing.lastVerifiedAt = null;
  // Same reasoning for the charge proof, and it matters more: it is what
  // unlocks the "Ativo" switch. Carrying it across a disconnect would let the
  // NEXT account connected here be switched on off the back of the previous
  // one's charge — a different merchant account entirely, never proven.
  existing.chargeVerifiedAt = null;
  // A reconnect replaces the account being charged, so a charge minted
  // against the old one can never confirm — drop it rather than leave the
  // screen waiting on a link that is now pointed somewhere else.
  existing.pendingVerification = null;
  await deps.store.save(merchant, existing);
}

export function createOAuthConnectService(
  providers: ProviderRegistry,
  store: ProviderConfigStore,
  appCredentialsFor: OAuthAppCredentialsResolver,
  onRevokeFailure?: RevokeFailureReporter,
): OAuthConnectService {
  function adapterOf(provider: ProviderName): PaymentProviderAdapter {
    if (!providers.has(provider)) throw new UnknownProviderError(provider);
    return providers.get(provider);
  }

  function appCreds(provider: ProviderName, environment: PaymentEnvironment): ResolvedCredentials {
    const creds = appCredentialsFor(provider, environment);
    if (!creds) {
      throw new CredentialsError(
        provider,
        `No platform OAuth application credentials configured for ${provider}/${environment}`,
      );
    }
    return creds;
  }

  const deps: OAuthDeps = { adapterOf, appCreds, store, reportRevokeFailure: onRevokeFailure };

  return {
    async begin(merchant, provider, ctx) {
      const adapter = adapterOf(provider);
      const environment = ctx.environment ?? 'PRODUCTION';
      const request = await oauthOf(adapter).buildAuthorizeUrl(appCreds(provider, environment), {
        state: ctx.state,
        redirectUri: ctx.redirectUri,
      });
      return { url: request.url, state: request.state };
    },
    complete: (merchant, provider, ctx) => completeConnect(deps, merchant, provider, ctx),
    refresh: (merchant, provider) => refreshConnect(deps, merchant, provider),
    disconnect: (merchant, provider) => disconnectConnect(deps, merchant, provider),
  };
}
