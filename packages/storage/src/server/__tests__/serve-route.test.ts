import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../../limits';
import { createApiStorage } from '../create-api-storage';
import type { StorageDriver } from '../driver';
import type { StorageRoute, StorageRouteResponse } from '../routes';
import { bucketDriver, fakePipeline, memoryDriver, PNG_BYTES } from './fixtures';

/**
 * `GET <mount>/uploads/local/<key…>` — how an object is read back.
 *
 * Which of its two behaviours applies is read off the DRIVER rather than from an
 * environment flag: a driver that holds its own bytes implements `read`, a
 * bucket-backed one does not. The flag version was the same fact recorded twice,
 * and the copy could disagree with the driver actually in use.
 */

const KEY = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';
const CROP = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/card-320.webp';

function serve(driver: StorageDriver): (key: string) => Promise<StorageRouteResponse> {
  const api = createApiStorage({
    driver,
    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
    imagePipeline: fakePipeline(),
    unscopedKeys: 'accept',
  });
  const route = api.routes.find(
    (candidate: StorageRoute) => candidate.method === 'GET',
  ) as StorageRoute;
  return (key) =>
    route.handle({
      actor: null,
      params: { key },
      request: new Request(`http://host.test/api/uploads/local/${key}`),
    });
}

describe('GET /uploads/local', () => {
  it('streams a stored object back, cacheable forever', async () => {
    const driver = memoryDriver();
    await driver.put(KEY, PNG_BYTES, 'image/webp');

    const response = await serve(driver)(KEY);

    expect(response.status).toBe(200);
    expect('bytes' in response && response.bytes).toEqual(PNG_BYTES);
    expect('headers' in response && response.headers).toMatchObject({
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  it('serves a CROP from the same key space as the uncropped object', async () => {
    // A crop's leaf stem is `card-320`, which is deliberately not a key any row may
    // name. Validating the URL as a row key would 400 every crop in the catalog.
    const driver = memoryDriver();
    await driver.put(CROP, PNG_BYTES, 'image/webp');

    expect((await serve(driver)(CROP)).status).toBe(200);
  });

  it('serves a LEGACY unscoped key, which an adopting host has a table full of', async () => {
    const legacy = 'products/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';
    const driver = memoryDriver();
    await driver.put(legacy, PNG_BYTES, 'image/webp');

    expect((await serve(driver)(legacy)).status).toBe(200);
  });

  it('404s for a key that was never stored', async () => {
    expect((await serve(memoryDriver())(KEY)).status).toBe(404);
  });

  it('refuses anything that is not a key this package minted', async () => {
    const get = serve(memoryDriver());

    for (const key of ['../../etc/passwd', 'products/x.webp', 'products/../secret.png', '']) {
      expect((await get(key)).status, key).toBe(400);
    }
  });

  it('refuses an extension it would not know a content type for', async () => {
    const driver = memoryDriver();
    const key = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe';
    await driver.put(key, PNG_BYTES, 'application/octet-stream');

    expect((await serve(driver)(key)).status).toBe(400);
  });

  it('redirects to the bucket object under a driver that keeps its own bytes', async () => {
    // A consumer may still ask here after a switch to a bucket — a cached page, a
    // bundle mid-deploy that fell back to the bare key — and a 404 there is a
    // catalog full of broken images.
    const response = await serve(bucketDriver())(KEY);

    expect(response).toEqual({ status: 302, redirect: `https://memory.test/${KEY}` });
  });

  it('404s rather than 500s when the remote driver cannot build a URL', async () => {
    // A relative "URL" would redirect straight back here, forever.
    const response = await serve(bucketDriver((key) => key))(KEY);

    expect(response.status).toBe(404);
  });

  it('redirects when the public base URL uses an uppercase scheme', async () => {
    const response = await serve(bucketDriver((key) => `HTTPS://cdn.test/${key}`))(KEY);

    expect(response.status).toBe(302);
  });
});
