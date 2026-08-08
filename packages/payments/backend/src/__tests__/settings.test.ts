import { describe, expect, it } from 'vitest';

import { credentialStoreFrom } from '../config/service';
import { IrreversibleChainRemovalError, UnprovenProviderError } from '../core/errors';
import {
  TENANT,
  setupOAuthWorld,
  setupSettingsWorld as setup,
  setupStrictSettings,
} from './fixtures';

describe('createOAuthConnectService', () => {
  it('exposes oauth providers as authMode oauth so the UI shows a button', () => {
    const { settings } = setupOAuthWorld();
    expect(settings.listProviders()[0]?.authMode).toBe('oauth');
  });

  it('completes a connect: stores tokens, marks VERIFIED, records expiry', async () => {
    const { oauth, store } = setupOAuthWorld();
    const begun = await oauth.begin(TENANT, 'oauthy', {
      state: 'st_1',
      redirectUri: 'https://host.test/cb',
    });
    expect(begun.url).toContain('state=st_1');

    const config = await oauth.complete(TENANT, 'oauthy', {
      code: 'abc',
      redirectUri: 'https://host.test/cb',
    });
    expect(config.status).toBe('VERIFIED');
    expect(config.expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    const stored = await store.get(TENANT, 'oauthy');
    expect(stored?.environments.PRODUCTION['accessToken']).toBe('at_abc');
  });

  it('never echoes tokens in the masked view', async () => {
    const { oauth, settings } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    const view = await settings.getSettings(TENANT);
    expect(JSON.stringify(view)).not.toContain('at_abc');
  });

  it('refreshes a live connection and rotates the expiry', async () => {
    const { oauth, store } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    const refreshed = await oauth.refresh(TENANT, 'oauthy');
    expect(refreshed.status).toBe('VERIFIED');
    expect((await store.get(TENANT, 'oauthy'))?.environments.PRODUCTION['accessToken']).toBe(
      'at_refreshed',
    );
  });

  it('marks RECONNECT_REQUIRED (not FAILED) when a refresh is rejected', async () => {
    const { oauth } = setupOAuthWorld({ failRefresh: true });
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    const stale = await oauth.refresh(TENANT, 'oauthy');
    // The remedy is reauthorizing, so the UI must be able to tell these apart.
    expect(stale.status).toBe('RECONNECT_REQUIRED');
  });

  /**
   * A provider that ROTATES on renewal — PagBank issues a new refresh token and
   * kills the spent one immediately — turns a failed save into a destroyed
   * connection: the only working tokens exist solely in the response we just
   * dropped. A bare storage error would read as a transient blip and hide that.
   */
  it('says so loudly when rotated tokens cannot be stored', async () => {
    const { oauth, store } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });

    store.save = async () => {
      throw new Error('database is down');
    };

    await expect(oauth.refresh(TENANT, 'oauthy')).rejects.toThrow(/must be reauthorized/i);
  });

  it('disconnect revokes and clears EVERY environment, not just the active one', async () => {
    const { oauth, store, revoked } = setupOAuthWorld();
    // Connect sandbox first, then production — both hold live tokens.
    await oauth.complete(TENANT, 'oauthy', {
      code: 'sbx',
      redirectUri: 'https://host.test/cb',
      environment: 'SANDBOX',
    });
    await oauth.complete(TENANT, 'oauthy', {
      code: 'prd',
      redirectUri: 'https://host.test/cb',
      environment: 'PRODUCTION',
    });
    await oauth.disconnect(TENANT, 'oauthy');

    const stored = await store.get(TENANT, 'oauthy');
    // Neither environment may keep a usable grant behind.
    expect(stored?.environments.SANDBOX).toEqual({});
    expect(stored?.environments.PRODUCTION).toEqual({});
    expect(revoked.sort()).toEqual(['PRODUCTION', 'SANDBOX']);
  });

  it('disconnect still clears locally when platform credentials are gone', async () => {
    // Connect while credentials exist, then simulate them being rotated away.
    const connected = setupOAuthWorld();
    await connected.oauth.complete(TENANT, 'oauthy', {
      code: 'abc',
      redirectUri: 'https://host.test/cb',
    });
    const stored = await connected.store.get(TENANT, 'oauthy');

    const broken = setupOAuthWorld({ missingAppCredentials: true });
    await broken.store.save(TENANT, stored!);
    // Revocation cannot run without app credentials, but the merchant must
    // still be able to remove the connection.
    await broken.oauth.disconnect(TENANT, 'oauthy');
    const after = await broken.store.get(TENANT, 'oauthy');
    expect(after?.environments.PRODUCTION).toEqual({});
    expect(after?.enabled).toBe(false);
  });

  /**
   * A revoke that fails is IGNORED on purpose — local cleanup must always run,
   * or a merchant is stranded with a connection they cannot remove. What that
   * cost was silence: the row says disconnected, the confirmation dialog said
   * the authorization was revoked, and the grant is still live at the provider
   * with nobody aware of it. Reporting is the fix; the control flow is not.
   */
  it('reports a revoke failure instead of swallowing it', async () => {
    const { oauth, store, reported } = setupOAuthWorld({ failRevoke: true });
    await oauth.complete(TENANT, 'oauthy', {
      code: 'sbx',
      redirectUri: 'https://host.test/cb',
      environment: 'SANDBOX',
    });
    await oauth.complete(TENANT, 'oauthy', { code: 'prd', redirectUri: 'https://host.test/cb' });

    await oauth.disconnect(TENANT, 'oauthy');

    // One report per environment whose grant may still be live — the merchant
    // who connected both must not have either one quietly left behind.
    expect(reported.map((failure) => failure.environment).sort()).toEqual([
      'PRODUCTION',
      'SANDBOX',
    ]);
    expect(reported[0]?.provider).toBe('oauthy');
    expect(reported[0]?.merchant).toEqual(TENANT);
    expect((reported[0]?.error as Error).message).toMatch(/did not revoke/i);
    // And the disconnect still happened. That is the whole constraint.
    expect((await store.get(TENANT, 'oauthy'))?.environments.PRODUCTION).toEqual({});
  });

  /**
   * The reporter is HOST code running inside the loop that must reach local
   * cleanup. A dead log transport may not become a merchant who cannot
   * disconnect, so reporting is best-effort too.
   */
  it('disconnects even when the reporter itself throws', async () => {
    const { oauth, store } = setupOAuthWorld({ failRevoke: true, reporterThrows: true });
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });

    await expect(oauth.disconnect(TENANT, 'oauthy')).resolves.toBeUndefined();

    const stored = await store.get(TENANT, 'oauthy');
    expect(stored?.enabled).toBe(false);
    expect(stored?.environments.PRODUCTION).toEqual({});
  });

  it('reports nothing when every revoke succeeds', async () => {
    const { oauth, reported } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    await oauth.disconnect(TENANT, 'oauthy');
    expect(reported).toEqual([]);
  });

  it('disconnect disables and clears in ONE write (no partial state)', async () => {
    const { oauth, store } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    const saves: number[] = [];
    const realSave = store.save.bind(store);
    store.save = async (merchant, config) => {
      saves.push(1);
      // Whenever the row is written during disconnect, disabling and token
      // clearing must already be together — never one without the other.
      if (!config.enabled) {
        expect(config.environments.PRODUCTION).toEqual({});
      }
      return realSave(merchant, config);
    };
    await oauth.disconnect(TENANT, 'oauthy');
    expect(saves).toHaveLength(1);
  });

  it('disconnect clears tokens and stands the provider down', async () => {
    const { oauth, settings, store } = setupOAuthWorld();
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });
    await settings.applyChargeVerification(TENANT, 'oauthy', true);
    await oauth.disconnect(TENANT, 'oauthy');
    const stored = await store.get(TENANT, 'oauthy');
    expect(stored?.enabled).toBe(false);
    expect(stored?.environments.PRODUCTION).toEqual({});
    expect(stored?.expiresAt).toBeNull();
  });

  /**
   * The row OUTLIVES the disconnect, so anything on it that describes a
   * connection has to go with the tokens. A leftover `VERIFIED` is the worst of
   * them — the settings screen reads status to decide whether a store is
   * connected at all, so it would keep reporting one that no longer exists.
   */
  it('disconnect leaves nothing on the row still describing a connection', async () => {
    const { oauth, store } = setupOAuthWorld();
    // A completed authorization is itself the proof — it stamps both fields.
    await oauth.complete(TENANT, 'oauthy', { code: 'abc', redirectUri: 'https://host.test/cb' });

    const connected = await store.get(TENANT, 'oauthy');
    expect(connected?.status).toBe('VERIFIED');
    expect(connected?.lastVerifiedAt).not.toBeNull();

    await oauth.disconnect(TENANT, 'oauthy');

    const stored = await store.get(TENANT, 'oauthy');
    expect(stored?.status).toBe('UNVERIFIED');
    // A disconnected store must not go on reporting when it was last proven.
    expect(stored?.lastVerifiedAt).toBeNull();
  });
});

/**
 * A dead grant must not receive checkouts (FUT-683).
 *
 * `RECONNECT_REQUIRED` used to change nothing but the settings badge: the row
 * stayed `enabled`, the chain filtered on `enabled` alone, and checkout kept
 * routing to a token the provider had already refused. These are the ticket's
 * scenarios, kept in Given/When/Then form.
 */
describe('RECONNECT_REQUIRED routing (FUT-683)', () => {
  /** Connect oauthy, put it (and optionally backup) in the chain. */
  async function connectedWorld(overrides: Parameters<typeof setupOAuthWorld>[0] = {}) {
    const world = setupOAuthWorld(overrides);
    await world.oauth.complete(TENANT, 'oauthy', {
      code: 'abc',
      redirectUri: 'https://host.test/cb',
    });
    await world.settings.setEnabled(TENANT, 'oauthy', true);
    return { ...world, credentials: credentialStoreFrom(world.store) };
  }

  it('given a healthy second provider, when the refresh is refused, then the chain routes to it', async () => {
    const world = await connectedWorld({ failRefresh: true, withBackup: true });
    await world.settings.setEnabled(TENANT, 'backup', true);
    expect(await world.credentials.providerChain(TENANT)).toEqual(['oauthy', 'backup']);

    await world.oauth.refresh(TENANT, 'oauthy');

    // The dead grant drops out and the healthy provider becomes chain[0] —
    // new checkouts go straight to it rather than failing over off a 401.
    expect(await world.credentials.providerChain(TENANT)).toEqual(['backup']);
    expect(await world.credentials.defaultProvider(TENANT)).toBe('backup');
    // The settings view publishes the SAME chain — the screen may never claim
    // an active provider that checkout will not walk.
    const view = await world.settings.getSettings(TENANT);
    expect(view.providerChain).toEqual(['backup']);
    expect(view.activeProvider).toBe('backup');
    // And nothing switched the row off: the owner's enablement stands, the
    // GRANT is what died.
    expect(view.configs.find((c) => c.provider === 'oauthy')?.enabled).toBe(true);
  });

  it('given a store whose only provider lost its grant, then the chain is empty — the NO_PROVIDER path', async () => {
    const world = await connectedWorld({ failRefresh: true });
    await world.oauth.refresh(TENANT, 'oauthy');

    // An empty chain is the state the storefront already words honestly
    // ("payments unavailable") instead of a generic charge error.
    expect(await world.credentials.providerChain(TENANT)).toEqual([]);
    expect(await world.credentials.defaultProvider(TENANT)).toBeNull();
    expect((await world.settings.getSettings(TENANT)).activeProvider).toBeNull();
  });

  it('refuses to resolve CHARGING credentials for a dead grant, but keeps LISTENING open', async () => {
    const world = await connectedWorld({ failRefresh: true });
    await world.oauth.refresh(TENANT, 'oauthy');

    // A direct charge (explicit provider, no chain consulted) must not spend
    // a request on a token the provider already refused.
    await expect(world.credentials.getCredentials(TENANT, 'oauthy')).rejects.toThrow(
      /requires reauthorization/,
    );
    // Listening is not routing: a webhook about money that ALREADY moved must
    // still authenticate, or paid orders stop confirming exactly when the
    // owner is distracted by reconnecting.
    await expect(
      world.credentials.getConnectedCredentials?.(TENANT, 'oauthy'),
    ).resolves.toMatchObject({ environment: 'PRODUCTION' });
  });

  it('when the owner reconnects via OAuth, then the provider returns to the chain with no manual re-activation', async () => {
    const world = await connectedWorld({ failRefresh: true });
    await world.oauth.refresh(TENANT, 'oauthy');
    expect(await world.credentials.providerChain(TENANT)).toEqual([]);

    // Reauthorize — the same `complete` a first connect runs.
    await world.oauth.complete(TENANT, 'oauthy', {
      code: 'again',
      redirectUri: 'https://host.test/cb',
    });

    // VERIFIED again, and straight back into rotation: `enabled` was never
    // touched, so no one has to find a switch to flip.
    expect(await world.credentials.providerChain(TENANT)).toEqual(['oauthy']);
    expect(await world.credentials.defaultProvider(TENANT)).toBe('oauthy');
  });
});

describe('createSettingsService', () => {
  it('never lets a request body turn on stub mode, and never stubs PRODUCTION', async () => {
    const { settings, store } = setup();
    // The payload type carries no `stub` field; even smuggling one through
    // an untyped body must not enable fake charges.
    const smuggled = { environment: 'PRODUCTION', fields: { secretKey: 'sk_live' }, stub: true };
    await settings.saveCredentials(TENANT, 'stone', smuggled as never);
    expect((await store.get(TENANT, 'stone'))?.stub).toBe(false);
  });

  it('keeps stub mode off entirely when the deployment disallows it', async () => {
    const strict = setupStrictSettings();
    await strict.settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_test' },
    });
    expect((await strict.store.get(TENANT, 'stone'))?.stub).toBe(false);
  });

  it('resolves credentials deterministically if two rows are somehow enabled', async () => {
    const { settings, store } = setup();
    const credentials = credentialStoreFrom(store);
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: {} });
    await settings.saveCredentials(TENANT, 'stripe', { environment: 'SANDBOX', fields: {} });
    // Simulate the corrupted state the DB's partial unique index prevents.
    for (const config of await store.list(TENANT)) {
      config.enabled = true;
      await store.save(TENANT, config);
    }
    expect(await credentials.defaultProvider(TENANT)).toBe('stone');
    expect(await credentials.defaultProvider(TENANT)).toBe('stone');
  });

  it('lists providers with schema and capabilities for form rendering', () => {
    const { settings } = setup();
    const [stone] = settings.listProviders();
    expect(stone?.displayName).toBe('Stone');
    expect(stone?.credentialSchema.map((f) => f.key)).toContain('secretKey');
    expect(stone?.capabilities.methods).toContain('PIX');
  });

  /**
   * The catalog carries each provider's URL spelling RESOLVED (FUT-557), so a
   * host routing per-provider pages reads it off the descriptor — an adapter
   * that declares nothing is spelled by its own name.
   */
  it('resolves each descriptor urlSlug, defaulting to the name', () => {
    const { settings } = setup();
    for (const descriptor of settings.listProviders()) {
      expect(descriptor.urlSlug).toBe(descriptor.name);
    }
  });

  it('masks secrets as tail hints and echoes non-secrets in full', async () => {
    const { settings } = setup();
    const masked = await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_live_abcd1234', publicKey: 'pk_xyz' },
    });
    expect(masked.environments.SANDBOX['secretKey']).toEqual({ configured: true, hint: '••••1234' });
    expect(masked.environments.SANDBOX['publicKey']).toEqual({ configured: true, hint: 'pk_xyz' });
    expect(JSON.stringify(masked)).not.toContain('sk_live_abcd1234');
  });

  // The third key used to be `webhookSecret`, which Stone's schema does not
  // declare — it is Stripe's. Nothing noticed, because every key was written
  // through; now that only declared keys are, the case has to be stated in
  // Stone's own vocabulary (`webhookPassword`) to still be about Stone.
  it('preserves on undefined, clears on empty, replaces on value', async () => {
    const { settings, store } = setup();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_1', publicKey: 'pk_1', webhookPassword: 'wh_1' },
    });
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: undefined, publicKey: 'pk_2', webhookPassword: '' },
    });
    const stored = await store.get(TENANT, 'stone');
    expect(stored?.environments.SANDBOX).toEqual({ secretKey: 'sk_1', publicKey: 'pk_2' });
  });

  it('keeps both environments side by side and activates the edited one', async () => {
    const { settings, store } = setup();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_sandbox' },
    });
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk_production' },
    });
    const stored = await store.get(TENANT, 'stone');
    expect(stored?.environment).toBe('PRODUCTION');
    expect(stored?.environments.SANDBOX['secretKey']).toBe('sk_sandbox');
    expect(stored?.environments.PRODUCTION['secretKey']).toBe('sk_production');
  });

  it('defaults the failover policy to TECHNICAL — cascading is never inherited', async () => {
    const { settings } = setup();
    const view = await settings.getSettings(TENANT);
    expect(view.failoverPolicy).toBe('TECHNICAL');
  });

  it('persists an explicit opt-in to decline cascading', async () => {
    const { settings } = setup();
    const view = await settings.setFailoverPolicy(TENANT, 'TECHNICAL_AND_DECLINE');
    expect(view.failoverPolicy).toBe('TECHNICAL_AND_DECLINE');
    expect((await settings.getSettings(TENANT)).failoverPolicy).toBe('TECHNICAL_AND_DECLINE');
  });

  /**
   * Activation is earned by charging (FUT-463).
   *
   * The failure these pin is a real one: PagBank Connect completed, the
   * credential probe passed, the row read `VERIFIED`, an owner flipped the
   * switch — and every shopper was declined with `403 ACCESS_DENIED`, because
   * authenticating and being allowed to charge are different permissions.
   */
  it('refuses to enable a provider that has never completed a charge', async () => {
    const { settings } = setup();
    // Probe-verified — exactly the state that used to be enough.
    await settings.verify(TENANT, 'stone');

    await expect(settings.setEnabled(TENANT, 'stone', true)).rejects.toThrow(
      UnprovenProviderError,
    );
    expect((await settings.getSettings(TENANT)).providerChain).toEqual([]);
  });

  /**
   * The rule binds only where the proof is obtainable.
   *
   * Stripe has no browser tokenization written, so no verification charge can
   * ever run for it. Requiring one anyway did not make its "Ativo" honest — it
   * made the provider impossible to enable at all, which is how three adapters
   * got bricked by the gate that was meant to protect one.
   */
  it('enables a provider that cannot run the charge, without one', async () => {
    const { settings } = setup();
    await settings.verify(TENANT, 'stripe');

    await expect(settings.setEnabled(TENANT, 'stripe', true)).resolves.toMatchObject({
      enabled: true,
    });
  });

  it('lets an unproven provider be switched OFF, so nothing is ever stuck on', async () => {
    const { settings, store } = setup();
    // A row enabled before the rule existed. It must not become untouchable:
    // an owner has to be able to pull it out of rotation immediately.
    const config = await store.get(TENANT, 'stone');
    await store.save(TENANT, { ...config!, enabled: true });

    await expect(settings.setEnabled(TENANT, 'stone', false)).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('a FAILED verification takes the provider out of the chain', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    expect((await settings.getSettings(TENANT)).providerChain).toEqual(['stone']);

    // The half that was missing: the screen showed `Ativo` directly above the
    // provider's own refusal, and said so again on every reload.
    await settings.applyChargeVerification(TENANT, 'stone', false);
    expect((await settings.getSettings(TENANT)).providerChain).toEqual([]);
  });

  it('keeps the proof across a pause, so a proven provider resumes without recharging', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.setEnabled(TENANT, 'stone', false);

    // `chargeVerifiedAt` outlives `enabled` on purpose — otherwise pausing a
    // provider would cost a fresh R$0,01 charge to undo.
    await expect(settings.setEnabled(TENANT, 'stone', true)).resolves.toMatchObject({
      enabled: true,
    });
  });

  it('persists the proof and the cleared pending charge — not only in memory', async () => {
    const { settings, store } = setup();
    await settings.setPendingVerification(TENANT, 'stone', {
      reference: 'verify-stone-t1',
      checkoutUrl: 'https://pay.test/x',
      startedAt: '2026-07-31T21:00:00.000Z',
    });

    await settings.applyChargeVerification(TENANT, 'stone', true);

    // Through the STORE, which returns fresh copies exactly as Prisma does.
    // The stamp used to live only on the loaded object — the chain toggle
    // persists nothing but enablement — so a webhook-confirmed activation
    // reported success while `charge_verified_at` stayed NULL in the database.
    const reloaded = await store.get(TENANT, 'stone');
    expect(reloaded?.chargeVerifiedAt).not.toBeNull();
    expect(reloaded?.pendingVerification).toBeNull();
  });

  /**
   * FUT-679 — the one exception to "a failure clears the pending charge": a
   * CARD write-ahead row still standing at failure time is an attempt whose
   * answer was LOST (the flow clears it itself on every settled outcome), and
   * hosts settle card failures with `applyChargeVerification(false)`. Erasing
   * it here would hide a possibly-real cent from the reconcile sweep, which
   * only scans configs holding a pending row.
   */
  it('a failed CARD verification keeps its unresolved write-ahead row for the sweep', async () => {
    const { settings, store } = setup();
    await settings.setPendingVerification(TENANT, 'stone', {
      reference: 'verify-stone-t1--k9x',
      checkoutUrl: '',
      startedAt: '2026-07-31T21:00:00.000Z',
      phase: 'CARD',
    });

    await settings.applyChargeVerification(TENANT, 'stone', false);

    expect((await store.get(TENANT, 'stone'))?.pendingVerification?.reference).toBe(
      'verify-stone-t1--k9x',
    );

    // A PASS settles everything — the row goes, exactly as before.
    await settings.applyChargeVerification(TENANT, 'stone', true);
    expect((await store.get(TENANT, 'stone'))?.pendingVerification).toBeNull();
  });

  it('voids the proof when credentials change — a new account has proven nothing', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);

    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_other_account' },
    });

    const config = (await settings.getSettings(TENANT)).configs.find((c) => c.provider === 'stone');
    expect(config?.chargeVerifiedAt).toBeNull();
    expect(config?.enabled).toBe(false);
    await expect(settings.setEnabled(TENANT, 'stone', true)).rejects.toThrow(
      UnprovenProviderError,
    );
  });

  /**
   * The counterpart to the test above, and the one that cost two real R$1,01
   * payments to learn: re-saving the SAME value is not a credential change.
   *
   * An owner retypes their handle, or presses Salvar twice, and the write used
   * to void the activation proof and drop the pending charge's `slug` — the
   * only thing `payment_check` can confirm a payment with. The screen then had
   * nothing left to offer but another real charge.
   */
  it('a no-op save keeps the proof and the outstanding charge', async () => {
    const { settings } = setup();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_same' },
    });
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.setPendingVerification(TENANT, 'stone', {
      reference: 'verify-stone-1',
      slug: 'abc123',
    } as Parameters<typeof settings.setPendingVerification>[2]);

    // The same value again — what pressing Salvar on an untouched form does.
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_same' },
    });

    const config = (await settings.getSettings(TENANT)).configs.find((c) => c.provider === 'stone');
    expect(config?.chargeVerifiedAt).not.toBeNull();
    expect(await settings.getPendingVerification(TENANT, 'stone')).not.toBeNull();
  });

  it('enabling a second provider APPENDS it to the chain rather than replacing', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    const view = await settings.getSettings(TENANT);
    // Both stay enabled — the single-active-provider invariant is gone. And
    // the newcomer lands LAST: enabling a provider must never silently
    // demote the one the merchant has been charging on.
    expect(view.providerChain).toEqual(['stone', 'stripe']);
    expect(view.activeProvider).toBe('stone');
    expect(view.configs.find((c) => c.provider === 'stone')?.enabled).toBe(true);
  });

  it('disabling a provider removes it from the chain and keeps the rest ordered', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    await settings.setEnabled(TENANT, 'stone', false);
    const view = await settings.getSettings(TENANT);
    expect(view.providerChain).toEqual(['stripe']);
    expect(view.activeProvider).toBe('stripe');
  });

  it('setPriorities reorders the chain atomically and survives a reload', async () => {
    const { settings, store } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.applyChargeVerification(TENANT, 'stripe', true);

    const view = await settings.setPriorities(TENANT, ['stripe', 'stone']);
    expect(view.providerChain).toEqual(['stripe', 'stone']);

    // Re-read through a fresh view: the order is persisted state, not a
    // property of the response we just built.
    const reloaded = await settings.getSettings(TENANT);
    expect(reloaded.providerChain).toEqual(['stripe', 'stone']);
    expect(reloaded.activeProvider).toBe('stripe');

    // Ranks stay dense and distinct — what the partial unique index enforces
    // in the database.
    const ranks = (await store.list(TENANT))
      .filter((c) => c.enabled)
      .map((c) => c.priority)
      .sort();
    expect(ranks).toEqual([0, 1]);
  });

  it('setPriorities omitting a provider takes it out of rotation', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    const view = await settings.setPriorities(TENANT, ['stripe']);
    expect(view.providerChain).toEqual(['stripe']);
    expect(view.configs.find((c) => c.provider === 'stone')?.enabled).toBe(false);
  });

  it('setPriorities rejects a provider that was never configured', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await expect(settings.setPriorities(TENANT, ['stone', 'stripe'])).rejects.toThrow(
      /stripe is not configured/,
    );
  });

  /**
   * Reordering ranks the chain; it must not GRANT membership to it (FUT-693).
   *
   * The rewrite writes `enabled: true` for every name it is handed, so before
   * this a drag — or a bare PUT of the list — went around both gates the enable
   * switch applies: the verification charge, and the plan's provider quota. The
   * three tests below are the ticket's scenarios.
   */
  it('given a configured but disabled provider, when the chain is reordered including it, then it stays disabled', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    // Connected, never switched on. Stripe cannot run an activation charge, so
    // the ONLY thing standing between it and the chain is the owner's switch —
    // and the plan slot that switch spends.
    await settings.saveCredentials(TENANT, 'stripe', { environment: 'SANDBOX', fields: {} });

    await expect(settings.setPriorities(TENANT, ['stone', 'stripe'])).rejects.toThrow(
      /stripe is not enabled/,
    );

    const view = await settings.getSettings(TENANT);
    expect(view.providerChain).toEqual(['stone']);
    expect(view.configs.find((c) => c.provider === 'stripe')?.enabled).toBe(false);
  });

  it('given an unproven provider, when the chain names it, then it is refused as UnprovenProviderError', async () => {
    const { settings } = setup();
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    // Stone CAN run the activation charge and has not — the exact state
    // `setEnabled` refuses, reached through the reorder endpoint instead.
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: {} });

    await expect(settings.setPriorities(TENANT, ['stone', 'stripe'])).rejects.toThrow(
      UnprovenProviderError,
    );
    expect((await settings.getSettings(TENANT)).providerChain).toEqual(['stripe']);
  });

  /**
   * The quota half, expressed as the property that makes it hold: the enable
   * endpoint spends a `payments.providers` slot, this one has no idea what the
   * plan allows, and it does not need one as long as it can only ever hand back
   * a subset of what is already enabled.
   */
  it('given a full chain, when it is reordered, then the enabled count never grows', async () => {
    const { settings, store } = setup();
    await settings.applyChargeVerification(TENANT, 'stone', true);
    await settings.saveCredentials(TENANT, 'stripe', { environment: 'SANDBOX', fields: {} });
    const enabledCount = async () => (await store.list(TENANT)).filter((c) => c.enabled).length;

    const before = await enabledCount();
    await expect(settings.setPriorities(TENANT, ['stripe', 'stone'])).rejects.toThrow();
    expect(await enabledCount()).toBe(before);

    // And a reorder that only shrinks is still free — pulling a PROVEN acquirer
    // out of rotation can never be gated, because switching it back on is one
    // call and costs nothing.
    await settings.setPriorities(TENANT, []);
    expect(await enabledCount()).toBe(0);
  });

  /**
   * The counterweight, and the reason the gate reads `config.enabled` first: a
   * row enabled before the proof rule existed is grandfathered in, so demanding
   * proof to RE-RANK it would pin it wherever it sits — at the head of the
   * chain, in the case that matters. Disabling it stays the way out, exactly as
   * `setEnabled` promises.
   */
  it('given a grandfathered enabled row with no proof, when the chain is reordered, then it may still be demoted', async () => {
    const { settings, store } = setup();
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: {} });
    const stone = await store.get(TENANT, 'stone');
    await store.save(TENANT, { ...stone!, enabled: true, priority: 0, chargeVerifiedAt: null });

    const view = await settings.setPriorities(TENANT, ['stripe', 'stone']);
    expect(view.providerChain).toEqual(['stripe', 'stone']);
  });

  /**
   * The other end of that counterweight, and what makes it worth anything: the
   * grandfathered row is protected only while it is IN the chain, so a rewrite
   * that merely OMITS it used to disable it — and then neither door took it
   * back, because both ask for the proof it was grandfathered past. A store
   * charging happily since before FUT-463 went offline on a partial list from
   * an agent, or a bare `[]`, and stayed there until its owner completed an
   * activation charge nobody had ever asked them for.
   *
   * So the rewrite refuses the drop instead, by its own name — the removal is
   * what is being refused, not an enable — and the deliberate per-provider
   * switch stays the way out, exactly as `setEnabled` promises.
   */
  it('given a grandfathered enabled row, when a rewrite omits it, then the drop is refused and the chain stands', async () => {
    const { settings, store } = setup();
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: {} });
    const stone = await store.get(TENANT, 'stone');
    await store.save(TENANT, { ...stone!, enabled: true, priority: 0, chargeVerifiedAt: null });

    await expect(settings.setPriorities(TENANT, [])).rejects.toThrow(
      IrreversibleChainRemovalError,
    );
    expect((await settings.getSettings(TENANT)).providerChain).toEqual(['stone']);

    // And the round trip that used to brick the store now completes, because
    // the state it depended on — grandfathered, out of the chain — is one the
    // rewrite can no longer produce.
    await settings.applyChargeVerification(TENANT, 'stripe', true);
    await settings.setPriorities(TENANT, ['stripe', 'stone']);
    expect((await settings.getSettings(TENANT)).providerChain).toEqual(['stripe', 'stone']);
  });

  it('given a grandfathered enabled row, when it is switched off deliberately, then that still works', async () => {
    const { settings, store } = setup();
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: {} });
    const stone = await store.get(TENANT, 'stone');
    await store.save(TENANT, { ...stone!, enabled: true, priority: 0, chargeVerifiedAt: null });

    // Taking a provider out of rotation must never need permission — the
    // refusal above is about the door, not about the outcome.
    await settings.setEnabled(TENANT, 'stone', false);
    expect((await settings.getSettings(TENANT)).providerChain).toEqual([]);
  });

  it('verify persists the probe outcome and stub mode verifies ok', async () => {
    const { settings } = setup();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: {},
    });
    const verified = await settings.verify(TENANT, 'stone');
    expect(verified.status).toBe('VERIFIED');
    expect(verified.lastVerifiedAt).not.toBeNull();
  });

  it('credential edits reset a previous verification', async () => {
    const { settings } = setup();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: {},
    });
    await settings.verify(TENANT, 'stone');
    const after = await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_rotated' },
    });
    expect(after.status).toBe('UNVERIFIED');
  });

  it('bridges into the gateway CredentialStore (enabled provider only)', async () => {
    const { settings, store } = setup();
    const credentials = credentialStoreFrom(store, { allowStubMode: true });
    expect(await credentials.defaultProvider(TENANT)).toBeNull();
    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_1' },
    });
    await settings.applyChargeVerification(TENANT, 'stone', true);
    expect(await credentials.defaultProvider(TENANT)).toBe('stone');
    const resolved = await credentials.getCredentials(TENANT, 'stone');
    expect(resolved).toMatchObject({ environment: 'SANDBOX', stub: true });
    expect(resolved?.fields['secretKey']).toBe('sk_1');
  });
});
