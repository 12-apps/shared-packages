import { describe, expect, it, vi } from 'vitest';

import { cacheFetchedField, mintBrowserKey, storedBrowserKey } from '../config/browser-key';
import type { StoredProviderConfig } from '../config/types';
import { AdapterContractError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { MerchantRef } from '../core/types';

import { activationAdapter, activationRegistry, connectedConfig } from './activation-fixtures';

/**
 * MINTING A BROWSER KEY, AND WHAT CACHING IT MUST NOT DO.
 *
 * A public key belongs to the account it was minted under, so a merchant who
 * never pasted one — every OAuth connection — needs one fetched with their own
 * credentials and kept. The fetch has been an adapter's job for a while; the
 * KEEPING was still written by hand in an adopting host, once per caller, and
 * these are the rules that hand-written version had to get right with nothing
 * checking it.
 *
 * The dangerous one is the last: this write deliberately does NOT go through
 * `saveCredentials`, whose whole job is to invalidate. Routed there, a routine
 * backfill would clear `chargeVerifiedAt` and drop the provider out of the
 * failover chain — taking a working merchant's checkout offline on the next
 * page load, for having fetched a key that names the account it already proved.
 */

const ACME: MerchantRef = { kind: 'TENANT', id: 'client-1' };

/** An adapter that can mint, plus the store that remembers what was written. */
function world(options: { mint?: () => Promise<string | null>; config?: StoredProviderConfig } = {}) {
  const mint = vi.fn(options.mint ?? (async () => 'MINTED_KEY'));
  const adapter = activationAdapter('pagbank', {
    browserKey: { field: 'publicKey', mint },
  } as Partial<PaymentProviderAdapter>);

  let stored: StoredProviderConfig | null = options.config ?? connectedConfig();
  const saves: StoredProviderConfig[] = [];
  const deps = {
    providers: activationRegistry({ pagbank: adapter }),
    connections: {
      get: async () => stored,
      save: async (_merchant: MerchantRef, config: StoredProviderConfig) => {
        stored = config;
        saves.push(config);
      },
    },
  };
  return { adapter, deps, mint, saves, current: () => stored };
}

const CREDS = { environment: 'PRODUCTION' as const, fields: { token: 'live-token' } };

describe('storedBrowserKey', () => {
  it("answers the adapter's own clientConfig, not a guessed field name", () => {
    const { adapter } = world();
    const key = storedBrowserKey(adapter, {
      environment: 'PRODUCTION',
      fields: { token: 'live-token', publicKey: 'PASTED' },
    });
    expect(key).toBe('PASTED');
  });

  it('answers null for a connection carrying no key', () => {
    const { adapter } = world();
    expect(storedBrowserKey(adapter, CREDS)).toBeNull();
  });

  /**
   * Reading and minting are separate capabilities. A merchant on an adapter
   * that cannot mint has PASTED their key, and tying the read to `browserKey`
   * would report them as key-less — the checkout would then fall through to
   * the mock tokenizer and put a fake token into a real charge.
   */
  it('reads a pasted key from an adapter that cannot mint at all', () => {
    const cannotMint = activationAdapter('stone');
    expect(cannotMint.browserKey).toBeUndefined();
    expect(
      storedBrowserKey(cannotMint, {
        environment: 'PRODUCTION',
        fields: { token: 't', publicKey: 'PASTED' },
      }),
    ).toBe('PASTED');
  });
});

describe('mintBrowserKey', () => {
  it("mints with the merchant's own credentials and caches the result", async () => {
    const { deps, mint, current } = world();

    expect(await mintBrowserKey(deps, ACME, 'pagbank', CREDS)).toBe('MINTED_KEY');
    expect(mint).toHaveBeenCalledWith(CREDS);
    expect(current()?.environments.PRODUCTION['publicKey']).toBe('MINTED_KEY');
  });

  /** Into the ACTIVE environment only — a sandbox key cannot serve live cards. */
  it('caches into the active environment and leaves the other alone', async () => {
    const { deps, current } = world({
      config: connectedConfig({
        environment: 'SANDBOX',
        environments: { SANDBOX: { token: 'sandbox-token' }, PRODUCTION: { token: 'live-token' } },
      }),
    });

    await mintBrowserKey(deps, ACME, 'pagbank', CREDS);

    expect(current()?.environments.SANDBOX['publicKey']).toBe('MINTED_KEY');
    expect(current()?.environments.PRODUCTION['publicKey']).toBeUndefined();
  });

  /**
   * The rule this whole module exists for. Asserted as a group because the
   * failure is "the save invalidated", and any one of these four flipping is
   * that same failure arriving by a different field.
   */
  it('invalidates nothing — the proof, the chain and the pending charge all survive', async () => {
    const proven = connectedConfig({
      enabled: true,
      priority: 2,
      status: 'VERIFIED',
      chargeVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      pendingVerification: { provider: 'pagbank', attemptId: 'att-1' } as never,
    });
    const { deps, current } = world({ config: proven });

    await mintBrowserKey(deps, ACME, 'pagbank', CREDS);

    const after = current();
    expect(after?.enabled).toBe(true);
    expect(after?.priority).toBe(2);
    expect(after?.status).toBe('VERIFIED');
    expect(after?.chargeVerifiedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(after?.pendingVerification).toEqual(proven.pendingVerification);
  });

  it('answers null, and writes nothing, for an adapter that cannot mint', async () => {
    const { deps, saves } = world();
    const registry = activationRegistry({ stone: activationAdapter('stone') });

    expect(await mintBrowserKey({ ...deps, providers: registry }, ACME, 'stone', CREDS)).toBeNull();
    expect(saves).toEqual([]);
  });

  /** Best-effort: a refused mint is an answer, and there is nothing to cache. */
  it('answers null, and writes nothing, when the mint comes back empty', async () => {
    const { deps, saves } = world({ mint: async () => null });

    expect(await mintBrowserKey(deps, ACME, 'pagbank', CREDS)).toBeNull();
    expect(saves).toEqual([]);
  });

  /**
   * A merchant with no row still gets their key. The caller asked what to hand
   * the browser; "nowhere to cache it" is this module's problem, not theirs.
   */
  it('still returns the key when there is no connection row to cache onto', async () => {
    const { deps } = world();
    const noRow = { ...deps, connections: { ...deps.connections, get: async () => null } };

    expect(await mintBrowserKey(noRow, ACME, 'pagbank', CREDS)).toBe('MINTED_KEY');
  });

  /** A store that refuses the write costs a slower next call, never the charge. */
  it('still returns the key when caching it throws', async () => {
    const { deps } = world();
    const brokenStore = {
      ...deps,
      connections: {
        ...deps.connections,
        save: async () => {
          throw new Error('store is down');
        },
      },
    };

    expect(await mintBrowserKey(brokenStore, ACME, 'pagbank', CREDS)).toBe('MINTED_KEY');
  });
});

describe('cacheFetchedField', () => {
  /**
   * The guard the host copy could not express, being a spread of the row: this
   * path has no invalidation, so nothing that could name a different account
   * may travel down it.
   */
  it('refuses a field the adapter marks secret', async () => {
    const { deps, saves } = world();

    await expect(cacheFetchedField(deps, ACME, 'pagbank', 'token', 'stolen')).rejects.toThrow(
      AdapterContractError,
    );
    expect(saves).toEqual([]);
  });

  it("refuses a field the adapter's schema does not declare", async () => {
    const { deps, saves } = world();

    await expect(cacheFetchedField(deps, ACME, 'pagbank', 'nope', 'x')).rejects.toThrow(
      AdapterContractError,
    );
    expect(saves).toEqual([]);
  });
});
