import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { mountTenant } from '../hono';
import { createApiTenant, type TenantRoute } from '../server';
import { serverConfig } from './fixtures';

describe('mountTenant', () => {
  it('mounts nothing while the package ships no routes', async () => {
    const app = new Hono();
    expect(mountTenant(app, createApiTenant(serverConfig()))).toBe(app);
    expect((await app.request('/anything')).status).toBe(404);
  });

  it('mounts each descriptor with its method and path, handing over the raw request', async () => {
    const route: TenantRoute = {
      method: 'POST',
      path: '/close',
      handler: async (request) => new Response(`${request.method} ${new URL(request.url).pathname}`),
    };
    const app = mountTenant(new Hono(), { routes: [route] });
    const answer = await app.request('/close', { method: 'POST' });
    expect(await answer.text()).toBe('POST /close');
    expect((await app.request('/close')).status).toBe(404);
  });
});
