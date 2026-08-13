import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDiskDriver, localObjectPath } from '../drivers/local-disk';
import type { StorageDriver } from '../driver';

/**
 * The local-disk driver, against a real temp directory. "The objects exist" is
 * files on disk here; nothing about this is worth asserting against a mock — which
 * is also why the filename says `integration`: the flakiness gate's unit tier
 * forbids unmocked fs, correctly, and this suite's whole subject is the fs.
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KEY = `products/minha-loja/${UUID}/full.webp`;
const BYTES = new Uint8Array([1, 2, 3, 4]);

const root = { current: '' };
let driver: StorageDriver;

beforeEach(async () => {
  root.current = await mkdtemp(path.join(tmpdir(), 'storage-local-'));
  driver = createLocalDiskDriver({
    root: root.current,
    publicPathPrefix: '/api/uploads/local',
  });
});

afterEach(async () => {
  await rm(root.current, { recursive: true, force: true });
});

describe('put', () => {
  it('creates the directories on the way, so a first upload does not fail', async () => {
    await driver.put(KEY, BYTES, 'image/webp');

    expect(new Uint8Array(await readFile(path.join(root.current, KEY)))).toEqual(BYTES);
  });

  it('overwrites in place rather than appending', async () => {
    await driver.put(KEY, BYTES, 'image/webp');
    await driver.put(KEY, new Uint8Array([9]), 'image/webp');

    expect(new Uint8Array(await readFile(path.join(root.current, KEY)))).toEqual(
      new Uint8Array([9]),
    );
  });
});

describe('read', () => {
  it('answers the bytes and the type the extension names', async () => {
    await driver.put(KEY, BYTES, 'image/webp');

    expect(await driver.read?.(KEY)).toEqual({ bytes: BYTES, contentType: 'image/webp' });
  });

  it('answers null for an object that is not there', async () => {
    expect(await driver.read?.(KEY)).toBeNull();
  });

  it('answers null for a DIRECTORY whose name happens to match', async () => {
    // Otherwise a set key's own directory reads as an unreadable object rather than
    // as an absent one, and the route answers 500 where it should answer 404.
    await driver.put(KEY, BYTES, 'image/webp');
    const directory = `products/minha-loja/${UUID}`;

    expect(await driver.read?.(directory)).toBeNull();
  });
});

describe('delete', () => {
  it('removes the object', async () => {
    await driver.put(KEY, BYTES, 'image/webp');

    await driver.delete(KEY);

    expect(await driver.read?.(KEY)).toBeNull();
  });

  it('is SUCCESS for an object that is already gone', async () => {
    // The caller is reconciling "nothing references this key any more", and an
    // absent object satisfies that.
    await expect(driver.delete(KEY)).resolves.toBeUndefined();
  });

  it('prunes the set directory once its last member goes', async () => {
    // A bucket has no directories — a key's slashes are just characters — so an
    // empty leftover is purely this driver's artifact.
    await driver.put(KEY, BYTES, 'image/webp');
    const crop = KEY.replace('full.webp', 'card-320.webp');
    await driver.put(crop, BYTES, 'image/webp');

    await driver.delete(KEY);
    expect(await readdir(path.join(root.current, 'products/minha-loja'))).toEqual([UUID]);

    await driver.delete(crop);
    expect(await readdir(path.join(root.current, 'products/minha-loja'))).toEqual([]);
  });

  it('never prunes the root itself', async () => {
    await writeFile(path.join(root.current, 'products'), '');

    await driver.delete('products');

    expect(await readdir(root.current)).toEqual([]);
  });
});

describe('publicUrl', () => {
  it('points at the serve route on this same origin, never at a bucket', () => {
    expect(driver.publicUrl(KEY)).toBe(`/api/uploads/local/${KEY}`);
  });

  it('does not double the slash when the prefix carries a trailing one', () => {
    const withSlash = createLocalDiskDriver({
      root: root.current,
      publicPathPrefix: '/api/uploads/local/',
    });

    expect(withSlash.publicUrl(KEY)).toBe(`/api/uploads/local/${KEY}`);
  });
});

describe('localObjectPath', () => {
  it('resolves a key to its path under the root', () => {
    expect(localObjectPath('/var/uploads', KEY)).toBe(`/var/uploads/${KEY}`);
  });

  it('throws on a traversal rather than resolving it', () => {
    // Keys reaching here are server-minted, so this is a backstop: a traversal
    // segment would mean a key was assembled somewhere it should not have been.
    for (const key of ['../etc/passwd', 'products/../../x', 'products/.hidden/a.png']) {
      expect(() => localObjectPath('/var/uploads', key), key).toThrow(/unsafe/);
    }
  });
});
