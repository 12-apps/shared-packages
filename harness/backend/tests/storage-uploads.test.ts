/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation --
   the database and the FILESYSTEM are the subject: these are the origin host's storage
   integration suites, ported to run against the PUBLISHED tarball, with the
   reclaim's reference probes reading a real Postgres (PGlite) and the local-disk
   driver writing real files. A mocked fs would test a driver nobody ships, and the
   one backend + one temp root are shared deliberately (a PGlite and a mounted app
   per case would take minutes); `/__harness/reset` between cases is what restores
   isolation, exactly as the suites beside this one do it. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { renderWiringReport } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { STORAGE_MOUNT_PATH, STORAGE_TENANT, STORAGE_TENANT_B } from '../src/storage-host';

/**
 * `@12-apps/storage` end to end (12-20): the port of the origin host's
 * `app/api/uploads/image/__tests__/route.integration.test.ts`,
 * `app/api/uploads/local/__tests__/route.integration.test.ts` and
 * `lib/storage/__tests__/store-image-set.integration.test.ts` — now driven through
 * the published package's own Hono router, its own local-disk driver, and a host
 * whose only contribution is the four seams the ADOPTING contract names.
 *
 * The claim the package is named for is the one thing there is no test FOR, and
 * cannot be: every byte reaches storage through a request to this origin, because
 * there is no presign endpoint to call.
 */

let backend: HarnessBackend;
let root: string;

/** A real PNG signature plus a little payload — enough for the byte check. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
/** The ceiling this mount was configured with (storage-host.ts). */
const MAX_BYTES = 1024 * 1024;
const CROP_NAMES = ['card-320', 'card-640', 'card-1280', 'thumb-128', 'thumb-256'];

beforeAll(async () => {
  backend = await createHarnessBackend();
  root = backend.storageRoot;
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

interface Uploaded {
  status: number;
  key?: string;
  error?: string;
}

async function upload(
  bytes: Uint8Array,
  options: { contentType?: string; scope?: string; gate?: 'deny' } = {},
): Promise<Uploaded> {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  const headers: Record<string, string> = { 'content-type': options.contentType ?? 'image/png' };
  if (options.scope) headers['x-storage-actor'] = options.scope;
  if (options.gate) headers['x-storage-gate'] = options.gate;
  const response = await backend.app.request('/api/uploads/image', {
    method: 'POST',
    body: body.buffer as ArrayBuffer,
    headers,
  });
  const payload = (await response.json()) as { data?: { imageKey: string }; error?: string };
  return {
    status: response.status,
    ...(payload.data ? { key: payload.data.imageKey } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  };
}

/** An upload that is expected to succeed. */
async function stored(options: Parameters<typeof upload>[1] = {}): Promise<string> {
  const result = await upload(PNG, options);
  expect(result.status).toBe(200);
  return result.key as string;
}

function serve(key: string): Promise<Response> {
  return backend.app.request(`/api/uploads/local/${key}`);
}

/** A host write, through the harness's own control surface. */
async function host(path: string, body: unknown): Promise<void> {
  const response = await backend.app.request(`/__harness/storage/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(204);
}

async function stillStored(key: string): Promise<boolean> {
  return (await serve(key)).status === 200;
}

function setDirectory(key: string): string {
  return join(root, key.slice(0, key.lastIndexOf('/')));
}

describe('POST /api/uploads/image', () => {
  it('stores the photo AND its crops, and answers with the key to save', async () => {
    const key = await stored();

    // The SET shape, and the SCOPE the host resolved: the caller gets back a key
    // that already names a photo whose crops exist — nothing was promised first.
    expect(key).toMatch(new RegExp(`^products/${STORAGE_TENANT}/[0-9a-f-]{36}/full\\.png$`));
    expect((await readdir(setDirectory(key))).sort()).toEqual([
      'card-1280.webp',
      'card-320.webp',
      'card-640.webp',
      'full.png',
      'thumb-128.webp',
      'thumb-256.webp',
    ]);
  });

  it('serves the uncropped object back byte for byte, cacheable forever', async () => {
    const key = await stored();

    const response = await serve(key);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('serves every crop from the same key space as the uncropped object', async () => {
    const key = await stored();

    for (const name of CROP_NAMES) {
      const response = await serve(key.replace('full.png', `${name}.webp`));
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type'), name).toBe('image/webp');
    }
  });

  it('scopes the key to the ACTOR the host resolved, not to anything in the request', async () => {
    // The one thing a caller must never choose: a key it picked could address
    // another tenant's object.
    expect(await stored({ scope: STORAGE_TENANT_B })).toMatch(
      new RegExp(`^products/${STORAGE_TENANT_B}/`),
    );
  });

  it('refuses a caller the host gated out, without storing anything', async () => {
    const before = await readdir(root);

    const result = await upload(PNG, { gate: 'deny' });

    expect(result.status).toBe(403);
    expect(result.error).toBe('forbidden');
    expect(await readdir(root)).toEqual(before);
  });

  it('rejects a content type outside the allowlist', async () => {
    const result = await upload(PNG, { contentType: 'application/zip' });

    expect(result.status).toBe(400);
    // A finished pt-BR sentence, not the code `unsupported_content_type`: the
    // browser half relays whatever the mount states, so a bare code here makes it
    // fall back to copy built from its OWN config instead.
    expect(result.error).toContain('Formato não suportado');
  });

  it('rejects bytes whose magic number contradicts the declared type', async () => {
    // Without this the endpoint is a way to park arbitrary content at a
    // world-readable URL on the store's own domain, served as whatever was claimed.
    const result = await upload(GIF, { contentType: 'image/png' });

    expect(result.status).toBe(400);
    expect(result.error).toContain('não corresponde');
  });

  it('rejects an empty body', async () => {
    expect((await upload(new Uint8Array(0))).status).toBe(400);
  });

  it('rejects an oversize upload against the ceiling THIS mount was given', async () => {
    const oversize = new Uint8Array(MAX_BYTES + 1024);
    oversize.set(PNG);

    const result = await upload(oversize);

    expect(result.status).toBe(413);
    // And it NAMES that ceiling. This mount is 1 MB while the browser half defaults
    // to 8 MB, so a bare code here is exactly what let a store owner read
    // "o limite é 8 MB" about a file a 1 MB mount had refused.
    expect(result.error).toContain('1 MB');
    expect(result.error).not.toContain('8 MB');
  });
});

describe('GET /api/uploads/local', () => {
  it('404s a key with no object behind it', async () => {
    const missing = `products/${STORAGE_TENANT}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png`;

    expect((await serve(missing)).status).toBe(404);
  });

  it('refuses anything that is not a key the package minted', async () => {
    for (const key of ['products/x.png', 'etc/passwd', 'products/nope/secret.png']) {
      expect((await serve(key)).status, key).toBe(400);
    }
  });

  it('answers a public read with no upload rights at all', async () => {
    // A storefront `<img>` carries no session; gating this would put one on every
    // image in a public catalog.
    const key = await stored();

    const response = await backend.app.request(`/api/uploads/local/${key}`, {
      headers: { 'x-storage-gate': 'deny' },
    });

    expect(response.status).toBe(200);
  });
});

describe('what the server hands a client', () => {
  it('builds a srcset per family from the key alone, through the active driver', async () => {
    const key = await stored();

    const response = await backend.app.request(
      `/__harness/storage/sources?key=${encodeURIComponent(key)}`,
    );
    const body = (await response.json()) as {
      url: string;
      sources: { card: { src: string; srcSet: string }; thumb: { srcSet: string } };
      objects: string[];
    };

    // Same-origin, through the local driver — the URL is the serve route, never a
    // bucket address.
    expect(body.url).toBe(`/api/uploads/local/${key}`);
    expect(body.sources.card.src).toContain('card-320.webp');
    expect(body.sources.card.srcSet).toContain('card-1280.webp 1280w');
    expect(body.sources.thumb.srcSet).toContain('thumb-256.webp 256w');
    expect(body.objects).toHaveLength(6);
    // Every URL it names is an object that really exists.
    for (const object of body.objects) {
      expect(await stillStored(object), object).toBe(true);
    }
  });

  it('answers no crops for a photo stored without them', async () => {
    const flat = `products/${STORAGE_TENANT}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png`;

    const response = await backend.app.request(
      `/__harness/storage/sources?key=${encodeURIComponent(flat)}`,
    );

    expect(((await response.json()) as { sources: unknown }).sources).toBeNull();
  });

  it('reports the ceiling it enforces, so a tool schema cannot drift from it', async () => {
    const response = await backend.app.request('/__harness/storage/sources?key=');
    const { limits } = (await response.json()) as {
      limits: { maxBytes: number; maxBytesLabel: string; driver: string };
    };

    expect(limits).toMatchObject({
      maxBytes: MAX_BYTES,
      maxBytesLabel: '1 MB',
      driver: 'local-disk',
    });
  });
});

describe('reclaiming a replaced object', () => {
  it('deletes the WHOLE set when nothing references it any more', async () => {
    // Deleting only the key the row named would leak five crops per replaced photo
    // — the same leak this exists to close, one level down.
    const key = await stored();

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(false);
    for (const name of CROP_NAMES) {
      expect(await stillStored(key.replace('full.png', `${name}.webp`)), name).toBe(false);
    }
  });

  it('keeps an object a LIVE row still points at', async () => {
    const key = await stored();
    await host('rows', { imageKey: key });

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(true);
  });

  it('keeps an object an OPEN edit is waiting to publish', async () => {
    // Reclaiming it would publish a row with no photo.
    const key = await stored();
    await host('pending', { imageKey: key, status: 'OPEN' });

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(true);
  });

  it('DELETES an object only a DISCARDED edit names', async () => {
    // A discarded edit is as dead as a version. Leaving it in would restore "never
    // reclaims" one abandoned edit at a time.
    const key = await stored();
    await host('pending', { imageKey: key, status: 'DISCARDED' });

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(false);
  });

  it('DELETES an object only version history names — a version must never pin one', async () => {
    // Versioning is on by default, so counting a version as a reference pins the
    // object for the whole retention window and "replace a photo" reclaims nothing,
    // ever. Restoring such a version re-states a key with no object behind it, which
    // renders as the same placeholder a photo-less row shows.
    const key = await stored();
    await host('versions', { imageKey: key });

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(false);
  });

  it("never touches another tenant's object, whatever its own tables say", async () => {
    // A probe answers "does anything of MINE reference this?" — true of every other
    // tenant's objects too. That is exactly how a scope-blind reclaim deletes a
    // neighbour's photo.
    const neighbour = await stored({ scope: STORAGE_TENANT_B });

    await host('reclaim', { scope: STORAGE_TENANT, key: neighbour });

    expect(await stillStored(neighbour)).toBe(true);
  });

  it("does not let one tenant's pending state pin another tenant's object", async () => {
    const key = await stored();
    await host('pending', { tenant: STORAGE_TENANT_B, imageKey: key, status: 'OPEN' });

    await host('reclaim', { key });

    expect(await stillStored(key)).toBe(false);
  });

  it('deletes only the keys a write superseded', async () => {
    const replaced = await stored();
    const kept = await stored();

    await host('reclaim', { before: [replaced, kept], after: [kept] });

    expect(await stillStored(replaced)).toBe(false);
    expect(await stillStored(kept)).toBe(true);
  });

  it('discards keys a failed write just minted, without asking a probe', async () => {
    // Nothing can reference a key nobody has been told about yet, so asking the
    // host's tables would be a round trip whose answer is known.
    const key = await stored();
    await host('rows', { imageKey: key });

    await host('reclaim', { discard: [key] });

    expect(await stillStored(key)).toBe(false);
  });

  it('prunes the set directory once its last member is gone', async () => {
    // Purely this driver's artifact — a bucket has no directories — but a leftover
    // makes the root an untruthful picture of what is stored.
    const key = await stored();

    await host('reclaim', { key });

    await expect(readdir(setDirectory(key))).rejects.toThrow();
  });
});

describe('the objects on disk', () => {
  it('stores the uncropped object as the bytes that were uploaded', async () => {
    const key = await stored();

    expect(new Uint8Array(await readFile(join(root, key)))).toEqual(PNG);
  });

  it('keeps two tenants in separate directories', async () => {
    const mine = await stored();
    const theirs = await stored({ scope: STORAGE_TENANT_B });

    expect(mine.startsWith(`products/${STORAGE_TENANT}/`)).toBe(true);
    expect(theirs.startsWith(`products/${STORAGE_TENANT_B}/`)).toBe(true);
    expect((await readdir(join(root, 'products'))).sort()).toEqual(
      [STORAGE_TENANT, STORAGE_TENANT_B].sort(),
    );
  });
});

describe('adopted through @12-apps/wiring, not by calling the factory', () => {
  it('carries the wildcard the serve route cannot work without', () => {
    // This package is the reason the contract has `wildcardParam` at all. An
    // object key is FOUR segments (`products/<scope>/<uuid>/card-320.webp`), so
    // an adapter registering only `path` answers the prefix and 404s every real
    // object — while the upload route, and every other route, keeps working.
    // That is how it hid.
    const { hosts } = backend;
    const serve = hosts.storage.routes.find(
      (mounted) => (mounted.route as { wildcardParam?: string }).wildcardParam !== undefined,
    );

    expect(serve?.route.method).toBe('GET');
    expect((serve?.route as { wildcardParam?: string }).wildcardParam).toBeDefined();
    // …and it is `public`, which is the other half: an `<img>` carries no
    // session, so the bridge must not gate it.
    expect((serve?.route as { kind?: string }).kind).toBe('public');
  });

  it('accounts for every capability, with none unanswered', () => {
    const { hosts } = backend;
    const statuses = new Map(
      hosts.storage.report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    // Mandatory because `http` is: "a refused upload or a driver that could not
    // be reached files under `storage` rather than under whichever host
    // happened to mount it."
    expect(statuses.get('observability')).toBe('bound');
    // No `db` and no `env` — both deliberate absences the manifest argues for:
    // this package owns no table, and every deployment-shaped decision is an
    // argument rather than a `process.env` read.
    expect(statuses.get('db')).toBeUndefined();
    expect(statuses.get('env')).toBeUndefined();
    expect([...statuses.values()]).not.toContain('unanswered');
  });

  it('renders a report naming the mount', () => {
    const { hosts } = backend;
    expect(renderWiringReport(hosts.storage.report)).toContain(
      `http: bound — ${hosts.storage.routes.length} routes at ${STORAGE_MOUNT_PATH}`,
    );
  });
});
