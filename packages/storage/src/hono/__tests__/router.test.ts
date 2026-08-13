import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../../limits';
import { STORAGE_PATHS } from '../../paths';
import type { StorageActor } from '../../server/routes';
import {
  fakePipeline,
  memoryDriver,
  PNG_BYTES,
  type MemoryDriver,
} from '../../server/__tests__/fixtures';
import { storageRouter } from '../index';

/**
 * The Hono adapter — mounted, over a real socket-shaped `app.request`.
 *
 * What only this level can prove: the wildcard actually delivers a NESTED key
 * intact (`products/<scope>/<uuid>/card-320.webp` is four segments, and a naive `*`
 * hands back a path Hono already split), the bytes reach the client with a length,
 * and a host's own gate answers 401 before any handler runs.
 */

const SCOPE = 'minha-loja';

interface Mounted {
  app: Hono;
  driver: MemoryDriver;
}

function mount(actor: StorageActor | null = { scope: SCOPE, mayUpload: true }): Mounted {
  // Named distinctly from what the tests destructure (`app`, `driver`): a `const`
  // holding a call result inside a module-level helper reads as shared state to the
  // flakiness gate, and every same-named local in a case then reads as a mutation
  // of it.
  const memory = memoryDriver();
  const storage = storageRouter({
    driver: memory,
    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
    imagePipeline: fakePipeline(),
    unscopedKeys: 'reject',
    resolveActor: () => actor,
  });
  const server = new Hono();
  server.route('/api', storage.router);
  return { app: server, driver: memory };
}

async function upload(target: Hono): Promise<Response> {
  const bytes = new Uint8Array(PNG_BYTES.byteLength);
  bytes.set(PNG_BYTES);
  return target.request(`/api${STORAGE_PATHS.upload}`, {
    method: 'POST',
    body: bytes.buffer as ArrayBuffer,
    headers: { 'content-type': 'image/png' },
  });
}

describe('storageRouter', () => {
  it('answers the key under the { data } envelope', async () => {
    const { app } = mount();

    const response = await upload(app);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { imageKey: string } };
    expect(body.data.imageKey).toMatch(/^products\/minha-loja\//);
  });

  it('answers 401 for an unauthenticated caller, before any handler runs', async () => {
    const { app, driver } = mount(null);

    const response = await upload(app);

    expect(response.status).toBe(401);
    expect((await response.json()) as { error: string }).toEqual({ error: 'Não autenticado.' });
    expect(driver.objects.size).toBe(0);
  });

  it('leaves a denial UNWRAPPED, so a client can read the reason', async () => {
    const { app } = mount({ scope: SCOPE, mayUpload: false });

    const response = await upload(app);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('serves a NESTED crop key back through the wildcard, intact', async () => {
    // The whole remainder is one parameter. A `*` would hand the handler a path Hono
    // had already split, and every crop in the catalog would 400.
    const { app, driver } = mount();
    const key = await upload(app).then(
      async (response) => ((await response.json()) as { data: { imageKey: string } }).data.imageKey,
    );
    const crop = key.replace('full.webp', 'card-320.webp');
    expect(driver.objects.has(crop)).toBe(true);

    const served = await app.request(`/api${STORAGE_PATHS.serve}/${crop}`);

    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('content-length')).toBe(
      String(driver.objects.get(crop)?.bytes.byteLength),
    );
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(driver.objects.get(crop)?.bytes);
  });

  it('serves the object read WITHOUT an actor — a storefront <img> carries no session', async () => {
    const { app, driver } = mount(null);
    const key = `products/${SCOPE}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`;
    await driver.put(key, PNG_BYTES, 'image/webp');

    expect((await app.request(`/api${STORAGE_PATHS.serve}/${key}`)).status).toBe(200);
  });

  it('404s a key with no object behind it', async () => {
    const { app } = mount();

    const response = await app.request(
      `/api${STORAGE_PATHS.serve}/products/${SCOPE}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`,
    );

    expect(response.status).toBe(404);
  });

  it('re-exports the mount surface, so a host needs one call and one object', () => {
    const mounted = storageRouter({
      driver: memoryDriver(),
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: fakePipeline(),
      unscopedKeys: 'reject',
      resolveActor: () => null,
    });

    expect(mounted.router).toBeInstanceOf(Hono);
    expect(mounted.limits.maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(typeof mounted.storeInlineImage).toBe('function');
    expect(typeof mounted.reclaim.deleteReplaced).toBe('function');
  });
});
