/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED
   @12-apps/product-research routes through the harness's own app, over a real
   Postgres built from the package's own eight migrations. Each case resets to
   an empty catalog first. */
/**
 * `@12-apps/product-research`'s HTTP surface as a CONSUMER gets it: seventeen
 * published route descriptors, mounted by a host that supplies the seven things
 * the factory refuses to start without.
 *
 * The schema half is `product-research-migrations.test.ts`. This is the surface
 * standing on it, and the cases concentrate on the INTEGRATIONS routes because
 * that is where the host/package split actually bites: a paid connector's key
 * is probed by the host, encrypted by the host, stored by the host — and the
 * package decides, from the probe's answer alone, whether the save is verified,
 * unverified or refused. Nothing upstream can run that: the package's own suite
 * fakes the store and the codec, so the round trip through a real row — where
 * the ciphertext has to stop travelling — has never been exercised.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  RESEARCH_TENANT_B_ID,
  RESEARCH_TENANT_ID,
  RESEARCH_USER_HEADER,
  researchProbes,
} from '../src/research-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

/** Drive the surface as a signed-in operator of one store. */
function as(tenantId: string = RESEARCH_TENANT_ID) {
  const base = `/api/admin/${tenantId}/research`;
  const headers = { [RESEARCH_USER_HEADER]: 'ana', 'content-type': 'application/json' };
  return {
    listIntegrations: () => backend.app.request(`${base}/integrations`, { headers }),
    saveIntegration: (type: string, body: Record<string, unknown>) =>
      backend.app.request(`${base}/integrations/${type}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      }),
    setIntegrationEnabled: (type: string, enabled: boolean) =>
      backend.app.request(`${base}/integrations/${type}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled }),
      }),
    removeIntegration: (type: string) =>
      backend.app.request(`${base}/integrations/${type}`, { method: 'DELETE', headers }),
  };
}

interface Integration {
  type: string;
  enabled: boolean;
  mounted: boolean;
  credentialHint: string | null;
  credentialStatus: string;
}

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

/** What actually landed in the row — the half a client must never see. */
async function storedConfig(type: string): Promise<Record<string, unknown>> {
  const { rows } = await backend.pg.query<{ config: Record<string, unknown> }>(
    `SELECT config FROM price_sources WHERE client_id = $1 AND type = $2 AND archived_at IS NULL`,
    [RESEARCH_TENANT_ID, type],
  );
  return rows[0]?.config ?? {};
}

describe('storing a connector key', () => {
  it('stores it VERIFIED when the host probe says the provider accepted it', async () => {
    researchProbes.credentialResult = { ok: true };
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    expect(saved.credentialStatus).toBe('VERIFIED');
    expect(saved.type).toBe('SERP');
  });

  it('stores it UNVERIFIED when this host cannot probe at all', async () => {
    // `null` is not a failure — it is "no probe available". The package's own
    // comment: no probe, or an unreachable provider, stores the key visibly
    // UNVERIFIED, never a blocked save. An operator whose provider is down must
    // still be able to finish configuring.
    researchProbes.credentialResult = null;
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    expect(saved.credentialStatus).toBe('UNVERIFIED');
  });

  it('refuses it, in the host words, when the provider says no', async () => {
    researchProbes.credentialResult = { ok: false, error: 'chave expirada' };
    const response = await as().saveIntegration('SERP', {
      credentials: { apiKey: 'dead-key' },
    });

    expect(response.status).toBe(422);
    // The host's probe reason is forwarded VERBATIM inside the host's own
    // sentence — the package never rewrites an operator-facing reason it did
    // not produce.
    expect(JSON.stringify(await response.json())).toContain('chave expirada');

    // And nothing was stored: a refused key must not sit in the row looking
    // configured.
    expect(await storedConfig('SERP')).toEqual({});
  });

  it('never lets the key itself back out — only the hint', async () => {
    researchProbes.credentialResult = { ok: true };
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    // What a roster may show: the tail an operator recognises their own key by.
    expect(saved.credentialHint).toBe('****9876');
    expect(JSON.stringify(saved)).not.toContain('live-key-9876');

    // What the row holds: the CIPHERTEXT, which the store scrubs on every read.
    // This is the property the package's own suite cannot reach — it fakes both
    // the store and the codec, so nothing there ever writes a real row.
    const config = await storedConfig('SERP');
    expect(String(config['credentialsEncrypted'])).toMatch(/^enc:/);
    expect(JSON.stringify(config)).not.toContain('live-key-9876');
  });

  it('swaps the key on a second save rather than adding a row', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'first-key-1111' } });
    const second = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'second-key-2222' } }),
    );

    // The singleton invariant, enforced by the PACKAGE'S OWN partial unique
    // index — the store upserts over it rather than re-deriving which types are
    // singletons, so the two cannot come to disagree.
    expect(second.credentialHint).toBe('****2222');
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM price_sources
        WHERE client_id = $1 AND type = 'SERP' AND archived_at IS NULL`,
      [RESEARCH_TENANT_ID],
    );
    expect(rows[0]?.count).toBe('1');
  });
});

describe('what the roster says about this deployment', () => {
  it('marks a type this server has mounted, and one it has not', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'k1' } });
    await as().saveIntegration('VTEX', { credentials: { appKey: 'k2', appToken: 't2' } });

    const roster = await dataOf<Integration[]>(await as().listIntegrations());
    const byType = Object.fromEntries(roster.map((row) => [row.type, row]));

    // `mounted` is a fact about the DEPLOYMENT, not about the package: an
    // unmounted type is still configurable, and starts participating the moment
    // the connector lands. An operator whose key is stored and waiting needs to
    // be able to tell that from a key that is broken.
    expect(byType['SERP']?.mounted).toBe(true);
    expect(byType['VTEX']).toBeUndefined();
  });

  it('shows one store nothing of another', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'k1' } });

    expect(await dataOf<Integration[]>(await as(RESEARCH_TENANT_B_ID).listIntegrations())).toEqual(
      [],
    );
  });
});

describe('turning a connector off and removing it', () => {
  it('keeps the stored key when the operator only switches it off', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } });

    const off = await dataOf<Integration>(await as().setIntegrationEnabled('SERP', false));
    expect(off.enabled).toBe(false);

    // Switching off is not disconnecting: the key stays so switching back on
    // costs nothing. Losing it here would make a pause indistinguishable from a
    // disconnection.
    expect(off.credentialHint).toBe('****9876');
    expect(String((await storedConfig('SERP'))['credentialsEncrypted'])).toMatch(/^enc:/);
  });

  it('takes it off the roster on removal, and frees the type', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'first-1111' } });
    expect((await as().removeIntegration('SERP')).status).toBeLessThan(300);
    expect(await dataOf<Integration[]>(await as().listIntegrations())).toEqual([]);

    // Archived rather than deleted — and the singleton index is partial on
    // `archived_at IS NULL`, so the type is free to be connected again. That
    // pair is exactly what the soft-delete migration was for.
    const reconnected = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'second-2222' } }),
    );
    expect(reconnected.credentialHint).toBe('****2222');
  });
});

describe('the caller', () => {
  it('answers 401 with no caller at all', async () => {
    const response = await backend.app.request(
      `/api/admin/${RESEARCH_TENANT_ID}/research/integrations`,
    );
    expect(response.status).toBe(401);
  });
});
