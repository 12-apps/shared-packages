/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it } from 'vitest';
import {
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { storageManifest } from '../index';
import { asWireAnswer, storageServerManifest } from '../server';
import { createLocalDiskDriver, passthroughImagePipeline } from '../../server';
import { PT_BR_STORAGE_MESSAGES } from '../../index';

/**
 * The smallest config the factory accepts — nothing here is exercised, because
 * these cases read the DESCRIPTORS rather than call a handler.
 */
function configForTest(): Parameters<typeof storageServerManifest.http.create>[0] {
  return {
    driver: createLocalDiskDriver({ root: '/tmp/storage-manifest-test', publicPathPrefix: '/x' }),
    maxBytes: 1024,
    imagePipeline: passthroughImagePipeline(),
    unscopedKeys: 'reject',
    references: [],
    messages: PT_BR_STORAGE_MESSAGES,
  };
}

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about absence
 * has to be made against. Built per case: the flakiness lane refuses shared
 * test-scope bindings.
 */
function declared(): PackageManifest {
  return storageManifest;
}

describe('the storage manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(storageManifest)).toBe(storageManifest);
    expect(defineServerManifest(storageManifest, storageServerManifest)).toBe(storageServerManifest);
  });

  it('inventories http, and files its telemetry under `storage`', () => {
    expect(storageManifest.name).toBe('@12-apps/storage');
    expect(storageManifest.contract).toBe(1);
    expect(storageManifest.server).toEqual(['http']);
    expect(storageManifest.observability).toEqual({ namespace: 'storage' });
  });

  it('declares no db and no env, because it owns neither', () => {
    // No table: an upload leaves a KEY, and the row it hangs off is the host's.
    expect(declared().db).toBeUndefined();
    // No `process.env` in shipped source — every deployment decision is an
    // argument. A declaration here would contradict `./server`'s own rule.
    expect(declared().env).toBeUndefined();
  });

  it('mirrors the manifest subpaths into package.json', () => {
    assertExportsMirror(storageManifest, packageJson);
  });
});

describe('the wire view of a descriptor', () => {
  it('carries the serve route\'s wildcard through to the aggregate', () => {
    // The gap this closes. The serve route's key is FOUR segments —
    // `products/<scope>/<uuid>/card-320.webp` — so an adapter that registers
    // only `path` answers the prefix and 404s every real object, while the
    // upload route beside it keeps working. That is why it hid: the surface
    // looked mounted.
    //
    // The NAME travels, not the syntax: `:key{.+}` is Hono's spelling and
    // `*key` is Express's, so a package writing either would have chosen its
    // host's framework. `./hono` composes the Hono form from this name, and so
    // must any other adapter.
    const routes = storageServerManifest.http.create(configForTest()).routes;
    const serve = routes.find((route) => route.method === 'GET');

    expect(serve?.wildcardParam).toBe('key');
  });

  it('leaves the upload route without one, because its path is fixed', () => {
    const routes = storageServerManifest.http.create(configForTest()).routes;
    const upload = routes.find((route) => route.method === 'POST');

    expect(upload?.wildcardParam).toBeUndefined();
  });
});

describe('the wire view of a descriptor answer', () => {
  it('renders JSON through the contract, not through a Response', () => {
    // The JSON arm stays `{status, body}` so the consumer's own primitives
    // shape it — only what they cannot express takes the raw half.
    expect(asWireAnswer({ status: 201, body: { key: 'k' } })).toEqual({
      status: 201,
      body: { key: 'k' },
    });
  });

  it('gives the bytes arm its OWN buffer — a pooled view leaks its neighbours', () => {
    // The security detail this wire view exists to stop every host re-deriving.
    // A Uint8Array over a pooled allocation hands the client whatever else
    // shares the pool, so the bytes are copied out before they are served.
    const pool = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = pool.subarray(2, 5);

    const answer = asWireAnswer({ status: 200, bytes: view, headers: { 'content-type': 'image/png' } });

    expect('response' in answer).toBe(true);
    const { response } = answer as { response: Response };
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    // Length is the VIEW's, not the pool's — the copy is exact, not the whole
    // allocation rounded up.
    expect(response.headers.get('content-length')).toBe('3');
  });

  it('serves a redirect as a redirect, which `{status, body}` cannot say', () => {
    const answer = asWireAnswer({ status: 302, redirect: 'https://cdn.example/x.png' });

    expect('response' in answer).toBe(true);
    const { response } = answer as { response: Response };
    expect(response.headers.get('location')).toBe('https://cdn.example/x.png');
  });
});
