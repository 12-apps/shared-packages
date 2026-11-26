import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { mountTenantGates } from '../hono';
import { createApiTenant, createTenantGates, TenantConfigError, type TenantGatesConfig } from '../server';
import { serverConfig } from './fixtures';

/**
 * The admin and public gates of a closing or closed tenant: who passes, what
 * each refusal says, the fixed words that are never a slug, and the escaped
 * path that is no way around.
 */

const STATUS: Record<string, string> = { open: 'OPEN', going: 'WINDING_DOWN', gone: 'SHUT', 'café': 'WINDING_DOWN' };

function gatesConfig(holds: boolean | null = true, lookups: string[] = []): TenantGatesConfig {
  return {
    admin: { prefix: '/api/staff', closingWrites: ['/closing', '/closing/export'] },
    public: {
      prefix: '/api',
      families: {
        basket: { readsToo: false, fixedWords: ['_boot'], slugAfter: [] },
        catalog: { readsToo: true, fixedWords: [], slugAfter: [] },
        portal: { readsToo: false, fixedWords: ['ping'], slugAfter: ['points'] },
      },
    },
    lookup: async (slug) => {
      lookups.push(slug);
      if (slug === 'boom') throw new Error('db down');
      const status = STATUS[slug];
      return status === undefined ? null : { id: `id-${slug}`, status };
    },
    holdsClose: async () => holds,
    locale: () => 'pt-BR',
  };
}

const tenant = createApiTenant(serverConfig());
const gates = (holds: boolean | null = true, lookups: string[] = []) => createTenantGates(tenant, gatesConfig(holds, lookups));
const req = (method: string, path: string) => new Request(`https://host.test${path}`, { method });

describe('the admin gate', () => {
  it('lets an open tenant, an unknown one and a failed lookup through', async () => {
    for (const slug of ['open', 'nobody', 'boom']) {
      expect(await gates().adminRefusal(req('POST', `/api/staff/${slug}/orders`))).toBeNull();
    }
  });

  it('refuses everything at a closed tenant', async () => {
    expect(await gates().adminRefusal(req('GET', '/api/staff/gone/closing'))).toEqual({
      kind: 'closed',
      status: 403,
      code: 'CLINIC_SHUT',
      message: 'pt-BR: refusalClosed.',
    });
  });

  it('lets a close holder read and use the closing writes only; the rest of the team is refused', async () => {
    const holder = gates(true);
    expect(await holder.adminRefusal(req('GET', '/api/staff/going/orders'))).toBeNull();
    expect(await holder.adminRefusal(req('DELETE', '/api/staff/going/closing'))).toBeNull();
    expect(await holder.adminRefusal(req('POST', '/api/staff/going/closing/export'))).toBeNull();
    expect(await holder.adminRefusal(req('POST', '/api/staff/going/orders'))).toMatchObject({ kind: 'readOnly', code: 'CLINIC_READ_ONLY' });
    expect(await gates(false).adminRefusal(req('GET', '/api/staff/going/orders'))).toMatchObject({ kind: 'closing', status: 403 });
    expect(await gates(null).adminRefusal(req('POST', '/api/staff/going/orders'))).toBeNull();
  });

  it('reads the path as a router does, and decodes the slug', async () => {
    expect(await gates().adminRefusal(req('GET', '/api/%73taff/gone/x'))).toMatchObject({ kind: 'closed' });
    expect(await gates(false).adminRefusal(req('GET', '/api/staff/caf%C3%A9/x'))).toMatchObject({ kind: 'closing' });
  });
});

describe('the public gate', () => {
  it('finds the slug in a family path, never in a fixed word, and after a slugAfter word', () => {
    const g = gates();
    expect(g.publicSlugOf('/api/basket/north', 'POST')).toBe('north');
    expect(g.publicSlugOf('/api/basket/north', 'GET')).toBeNull();
    expect(g.publicSlugOf('/api/basket/_boot', 'POST')).toBeNull();
    expect(g.publicSlugOf('/api/catalog/north', 'GET')).toBe('north');
    expect(g.publicSlugOf('/api/portal/points/north/trade', 'POST')).toBe('north');
    expect(g.publicSlugOf('/api/portal/ping', 'POST')).toBeNull();
    expect(g.publicSlugOf('/api/elsewhere/north', 'POST')).toBeNull();
    expect(g.publicSlugOf('/other/basket/north', 'POST')).toBeNull();
  });

  it('refuses a gone tenant 409 and looks nothing up for a fixed word', async () => {
    const lookups: string[] = [];
    const g = gates(true, lookups);
    expect(await g.publicRefusal(req('POST', '/api/basket/going'))).toEqual({
      kind: 'gone',
      status: 409,
      code: 'CLINIC_GONE',
      message: 'pt-BR: refusalGone.',
    });
    expect(await g.publicRefusal(req('POST', '/api/basket/open'))).toBeNull();
    expect(await g.publicRefusal(req('POST', '/api/basket/_boot'))).toBeNull();
    expect(await g.publicRefusal(req('POST', '/api/basket/%E0%A4%A'))).toBeNull();
    expect(lookups).toEqual(['going', 'open']);
  });
});

describe('the Hono mount', () => {
  it('renders each refusal with its status and lets the rest reach the route', async () => {
    const app = new Hono();
    mountTenantGates(app, gates(false));
    app.all('*', (c) => c.json({ ok: true }));
    const closing = await app.request('/api/staff/going/orders');
    expect(closing.status).toBe(403);
    expect(await closing.json()).toEqual({ error: 'pt-BR: refusalClosing.', code: 'CLINIC_WINDING_DOWN', details: {} });
    expect((await app.request('/api/catalog/gone')).status).toBe(409);
    expect((await app.request('/api/basket/gone')).status).toBe(200);
    expect((await app.request('/api/staff/open/orders')).status).toBe(200);
  });
});

describe('the gates config', () => {
  function keyOf(config: unknown): string {
    try {
      createTenantGates(tenant, config as TenantGatesConfig);
    } catch (error) {
      if (error instanceof TenantConfigError) return error.key;
      throw error;
    }
    return 'none';
  }

  it('names each missing or bad key', () => {
    const good = gatesConfig();
    expect(keyOf({ ...good, admin: { ...good.admin, prefix: '/api/staff/' } })).toBe('gates.admin.prefix');
    expect(keyOf({ ...good, admin: { ...good.admin, closingWrites: ['closing'] } })).toBe('gates.admin.closingWrites[0]');
    expect(keyOf({ ...good, public: { ...good.public, families: { basket: { readsToo: 'yes' } } } })).toBe(
      'gates.public.families.basket.readsToo',
    );
    expect(keyOf({ ...good, lookup: undefined })).toBe('gates.lookup');
    expect(keyOf({ ...good, holdsClose: 1 })).toBe('gates.holdsClose');
    expect(keyOf(good)).toBe('none');
  });
});
