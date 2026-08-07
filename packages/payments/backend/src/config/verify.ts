import type { PaymentProviderAdapter } from '../core/provider';
import { stubResolvedFor } from '../core/stub-mode';
import type { PaymentEnvironment, ProbeFault } from '../core/types';
import type { MaskedProviderConfig, ProviderConfigStore, StoredProviderConfig } from './types';
import type { MerchantRef } from '../core/types';

/**
 * The credential probe — "Testar conexão" — and what it is allowed to write.
 *
 * Its own module so `service.ts` stays inside its size budget; the masking
 * helper it needs is injected rather than imported, because that lives with
 * the rest of the view-building code.
 */

/**
 * A probe's outcome alongside the config it ran against.
 *
 * Additive on purpose: every existing reader treats this as the
 * `MaskedProviderConfig` it always was. `probe` exists because the stored
 * `status` cannot answer for a NON-active environment — it is deliberately not
 * written there — so without it a caller has no way to report what happened.
 */
export interface VerifiedProviderConfig extends MaskedProviderConfig {
  /**
   * `message` and `fault` come straight from the adapter, unedited.
   *
   * A host that wrote this sentence itself could only say "o provedor" and "as
   * credenciais", because the provider's name, the field's name in ITS app and
   * the screen the owner fixes it on are all adapter knowledge. And `fault` is
   * what lets the screen tell "that tag names no account" (go and re-read it)
   * apart from "we never got an answer" (the tag is saved and probably fine —
   * ask again in a moment). One sentence served both, and on the second it
   * accused the owner of a typo the probe had not established.
   */
  probe: { environment: PaymentEnvironment; ok: boolean; message?: string; fault?: ProbeFault };
}

/**
 * Run the credential probe against ONE environment and report what happened.
 *
 * `target` is the environment the caller is looking at, which is not always
 * the active one: the settings screen lets an owner open the other tab, and
 * probing `config.environment` from there tests a set of credentials that is
 * not on screen and stamps the answer as if it were.
 *
 * Persistence stays pinned to the ACTIVE environment, because `status` and
 * `lastVerifiedAt` describe the credentials the charge path actually uses —
 * one row, one status. Writing a PRODUCTION probe onto a SANDBOX-active
 * config would produce exactly the failure FUT-463 was about: a stored verdict
 * that was never true of the thing it appears to describe.
 *
 * And the active environment is never MOVED here. `saveCredentials` may switch
 * it, but only because it also forces `enabled: false`; a test button that
 * silently repointed a live store at sandbox — still enabled — would send real
 * orders to fake credentials.
 *
 * `allowStubMode` is this deployment's own answer, and the probe requires it
 * for the same reason every other credential read does: every adapter returns
 * `{ ok: true, message: 'stub mode' }` the moment `stub` is set, without
 * asking the acquirer anything. Reading the stored column ALONE let a
 * left-over `stub=true` row — a restored dev dump, a demo tenant on a shared
 * database — answer "Testar conexão" with a pass nobody earned, and persist
 * VERIFIED over a connection holding no credentials at all.
 */
export async function runVerify(
  adapter: PaymentProviderAdapter,
  store: ProviderConfigStore,
  merchant: MerchantRef,
  config: StoredProviderConfig,
  target: PaymentEnvironment,
  allowStubMode: boolean,
  toMasked: (adapter: PaymentProviderAdapter, config: StoredProviderConfig) => MaskedProviderConfig,
): Promise<VerifiedProviderConfig> {
  const result = await adapter.verifyCredentials({
    environment: target,
    fields: config.environments[target],
    // SANDBOX-only, and only where the deployment said yes — see
    // `stubResolvedFor`, which is the one place this is decided.
    stub: stubResolvedFor(allowStubMode, config.stub, target),
  });

  // A probe that never reached the provider has learned NOTHING about the
  // credentials, so it records no verdict about them — the same rule the
  // redirect poll already follows when its request fails (it answers
  // `pending: true` rather than settling the charge as refused). Storing
  // FAILED here on a network blip left a red chip standing over a credential
  // that was perfectly good, and the only way back was to re-save it.
  if (target === config.environment && result.fault !== 'UNREACHABLE') {
    config.status = result.ok ? 'VERIFIED' : 'FAILED';
    config.lastVerifiedAt = new Date();
    await store.save(merchant, config);
  }

  return {
    ...toMasked(adapter, config),
    probe: {
      environment: target,
      ok: result.ok,
      // Only on a failure, and only when the adapter actually said something.
      // A pass has nothing to explain, and an empty string would render as a
      // blank alert — worse than the generic sentence it replaced.
      ...(result.ok || !result.message ? {} : { message: result.message }),
      ...(result.ok || !result.fault ? {} : { fault: result.fault }),
    },
  };
}
