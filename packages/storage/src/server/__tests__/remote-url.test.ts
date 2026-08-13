import { describe, expect, it } from 'vitest';

import { StorageNotConfiguredError } from '../../problems';
import { assertRemoteUrlConfig, remoteObjectUrl } from '../remote-url';

/**
 * The public URL of a bucket object. Every branch below is a real deployment that
 * got this wrong once, which is why they are asserted separately rather than as
 * "it builds a URL".
 */

const KEY = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';

describe('remoteObjectUrl', () => {
  it('builds the AWS regional URL from bucket + region', () => {
    expect(remoteObjectUrl({ bucket: 'catalog', region: 'us-east-1' }, KEY)).toBe(
      `https://catalog.s3.us-east-1.amazonaws.com/${KEY}`,
    );
  });

  it('builds a virtual-hosted URL from an S3-compatible endpoint', () => {
    expect(
      remoteObjectUrl(
        { bucket: 'catalog', endpoint: 'https://sfo3.digitaloceanspaces.com' },
        KEY,
      ),
    ).toBe(`https://catalog.sfo3.digitaloceanspaces.com/${KEY}`);
  });

  it('builds a path-style URL, keeping the endpoint scheme', () => {
    // A store that cannot do virtual-hosted addressing on localhost. Rewriting the
    // scheme to https would make every display URL unreachable in development.
    expect(
      remoteObjectUrl(
        { bucket: 'catalog', endpoint: 'http://localhost:9000', forcePathStyle: true },
        KEY,
      ),
    ).toBe(`http://localhost:9000/catalog/${KEY}`);
  });

  it('lets a CDN base win over any bucket-derived URL', () => {
    expect(
      remoteObjectUrl(
        {
          bucket: 'catalog',
          endpoint: 'https://sfo3.digitaloceanspaces.com',
          publicBaseUrl: 'https://cdn.example.com/',
        },
        KEY,
      ),
    ).toBe(`https://cdn.example.com/${KEY}`);
  });

  it('tolerates an endpoint or CDN base with a trailing slash', () => {
    expect(remoteObjectUrl({ bucket: 'c', endpoint: 'https://s3.test/' }, 'a.png')).toBe(
      'https://c.s3.test/a.png',
    );
  });
});

describe('assertRemoteUrlConfig', () => {
  it('refuses a config with no bucket', () => {
    expect(() => assertRemoteUrlConfig({ bucket: '' })).toThrow(StorageNotConfiguredError);
  });

  it('refuses a config that cannot produce a URL at all', () => {
    // Answering the bare key here would put a relative path in an `<img src>`, which
    // resolves against the app's own origin and 404s — a broken image with no error
    // anywhere, for every product in the catalog.
    expect(() => assertRemoteUrlConfig({ bucket: 'catalog' })).toThrow(
      /region, an endpoint or a publicBaseUrl/,
    );
  });

  it('accepts any one of the three ways to name where objects are served', () => {
    expect(() => assertRemoteUrlConfig({ bucket: 'c', region: 'us-east-1' })).not.toThrow();
    expect(() => assertRemoteUrlConfig({ bucket: 'c', endpoint: 'https://s3.test' })).not.toThrow();
    expect(() =>
      assertRemoteUrlConfig({ bucket: 'c', publicBaseUrl: 'https://cdn.test' }),
    ).not.toThrow();
  });
});
