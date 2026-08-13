import { describe, expect, it } from 'vitest';

import {
  hasRenditions,
  isLegalScope,
  isObjectKey,
  keyInScope,
  mintObjectKey,
  mintObjectSetKey,
  parseObjectKey,
  parseObjectMemberKey,
  renditionKey,
} from '../keys';

/**
 * The key shapes, and the two questions they exist to answer.
 *
 * "Does this photo have the crops a storefront draws?" and "whose object is this?"
 * are both answered by the KEY and by nothing else — no column, no lookup. That
 * makes the shapes a contract three unrelated places depend on: display code asks
 * for crop URLs off it, the reclaim deletes a whole set off it, and the writer
 * decides whether to cut anything off it. So the boundaries below are tested as
 * boundaries, not as examples.
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const SCOPE = 'minha-loja';

describe('mintObjectKey', () => {
  it('mints the standalone shape, with the extension of the stored type', () => {
    expect(mintObjectKey({ scope: SCOPE, contentType: 'image/webp' })).toMatch(
      /^products\/minha-loja\/[0-9a-f-]{36}\.webp$/,
    );
    expect(mintObjectKey({ scope: SCOPE, contentType: 'image/jpeg' })).toMatch(/\.jpg$/);
    expect(mintObjectKey({ scope: SCOPE, contentType: 'image/gif' })).toMatch(/\.gif$/);
  });

  it('promises no crops', () => {
    expect(hasRenditions(mintObjectKey({ scope: SCOPE, contentType: 'image/webp' }))).toBe(
      false,
    );
  });

  it('never repeats', () => {
    const mint = (): string => mintObjectKey({ scope: SCOPE, contentType: 'image/webp' });
    expect(mint()).not.toBe(mint());
  });

  it('refuses a scope that could escape a filesystem path', () => {
    // The local-disk driver turns a key into a path. A traversal segment reaching
    // it would mean a key was assembled somewhere it should not have been, so this
    // throws at the mint rather than being sanitised quietly.
    for (const scope of ['../etc', 'a/b', 'has space', '', '.hidden']) {
      expect(() => mintObjectKey({ scope, contentType: 'image/webp' })).toThrow(/scope/);
    }
  });

  it('refuses a content type it has no extension for', () => {
    expect(() =>
      mintObjectKey({ scope: SCOPE, contentType: 'application/zip' }),
    ).toThrow(/unsupported/);
  });
});

describe('mintObjectSetKey', () => {
  it('mints the set shape, naming the uncropped member', () => {
    expect(mintObjectSetKey({ scope: SCOPE, contentType: 'image/webp' })).toMatch(
      /^products\/minha-loja\/[0-9a-f-]{36}\/full\.webp$/,
    );
  });

  it('promises crops', () => {
    expect(hasRenditions(mintObjectSetKey({ scope: SCOPE, contentType: 'image/webp' }))).toBe(
      true,
    );
  });

  it('keeps every segment safe as a path component', () => {
    // A key the serve route or the local driver refuses is an image that 404s for
    // every visitor, so the grammar is asserted here rather than discovered there.
    const key = mintObjectSetKey({ scope: SCOPE, contentType: 'image/webp' });
    expect(key.split('/')).toHaveLength(4);
    for (const segment of key.split('/')) {
      expect(segment).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    }
  });
});

describe('parseObjectKey', () => {
  it('reads the scope, the uuid and the crop promise off a scoped set key', () => {
    expect(parseObjectKey(`products/${SCOPE}/${UUID}/full.webp`)).toEqual({
      prefix: 'products',
      scope: SCOPE,
      uuid: UUID,
      extension: 'webp',
      hasRenditions: true,
    });
  });

  it('reads a scoped FLAT key', () => {
    expect(parseObjectKey(`products/${SCOPE}/${UUID}.gif`)).toEqual({
      prefix: 'products',
      scope: SCOPE,
      uuid: UUID,
      extension: 'gif',
      hasRenditions: false,
    });
  });

  it('still reads the two LEGACY unscoped shapes, with no scope', () => {
    // An adopting host has a table full of these. Refusing them here would make
    // every photo it already stored unresolvable.
    expect(parseObjectKey(`products/${UUID}/full.webp`)?.scope).toBeNull();
    expect(parseObjectKey(`products/${UUID}.png`)?.scope).toBeNull();
    expect(parseObjectKey(`products/${UUID}/full.webp`)?.hasRenditions).toBe(true);
    expect(parseObjectKey(`products/${UUID}.png`)?.hasRenditions).toBe(false);
  });

  it('stays unambiguous when the SCOPE is itself uuid-shaped', () => {
    // A host that scopes by tenant id, not slug. `<uuid>/<uuid>.webp` is a scoped
    // flat key and `<uuid>/full.webp` is a legacy set — told apart by the leaf stem,
    // because a uuid is never the word `full`.
    const scoped = parseObjectKey(`products/${OTHER}/${UUID}.webp`);
    expect(scoped).toMatchObject({ scope: OTHER, uuid: UUID, hasRenditions: false });
    const legacy = parseObjectKey(`products/${OTHER}/full.webp`);
    expect(legacy).toMatchObject({ scope: null, uuid: OTHER, hasRenditions: true });
  });

  it('rejects everything that merely resembles a key', () => {
    // Each of these would, if accepted, send a consumer to URLs with no objects
    // behind them — or let a reclaim delete something it never wrote.
    for (const key of [
      `products/${SCOPE}/${UUID}/card-320.webp`,
      `products/${UUID}/full`,
      `logos/${SCOPE}/${UUID}/full.webp`,
      `products/not-a-uuid/full.webp`,
      `products/${SCOPE}/${UUID}/full.webp/evil`,
      `x/products/${UUID}.webp`,
      '../../etc/passwd',
      'products/%.webp',
      `products/a/b/${UUID}/full.webp`,
      '',
    ]) {
      expect(parseObjectKey(key), key).toBeNull();
    }
  });

  it('honors a host that renamed the prefix', () => {
    expect(parseObjectKey(`media/${SCOPE}/${UUID}.webp`, 'media')?.scope).toBe(SCOPE);
    expect(parseObjectKey(`media/${SCOPE}/${UUID}.webp`)).toBeNull();
  });
});

describe('isObjectKey', () => {
  it('accepts every shape and nothing else', () => {
    expect(isObjectKey(`products/${SCOPE}/${UUID}.webp`)).toBe(true);
    expect(isObjectKey(`products/${SCOPE}/${UUID}/full.webp`)).toBe(true);
    expect(isObjectKey(`products/${UUID}.webp`)).toBe(true);
    expect(isObjectKey('products/%.webp')).toBe(false);
  });
});

describe('renditionKey', () => {
  it('names a sibling of the set', () => {
    expect(renditionKey(`products/${SCOPE}/${UUID}/full.webp`, 'card-640')).toBe(
      `products/${SCOPE}/${UUID}/card-640.webp`,
    );
  });

  it('is always WebP, even beside an uncropped object that is not', () => {
    expect(renditionKey(`products/${SCOPE}/${UUID}/full.png`, 'thumb-128')).toBe(
      `products/${SCOPE}/${UUID}/thumb-128.webp`,
    );
  });

  it('refuses a key with no set rather than inventing one', () => {
    expect(renditionKey(`products/${SCOPE}/${UUID}.webp`, 'card-320')).toBeNull();
  });
});

describe('parseObjectMemberKey', () => {
  it('accepts a CROP, which is not a key any row may name', () => {
    expect(parseObjectMemberKey(`products/${SCOPE}/${UUID}/card-320.webp`)).toEqual({
      scope: SCOPE,
      uuid: UUID,
      stem: 'card-320',
      extension: 'webp',
    });
  });

  it('accepts a legacy crop, with no scope', () => {
    expect(parseObjectMemberKey(`products/${UUID}/thumb-256.webp`)).toMatchObject({
      scope: null,
      stem: 'thumb-256',
    });
  });

  it('reads a flat key as its own member', () => {
    expect(parseObjectMemberKey(`products/${SCOPE}/${UUID}.png`)).toEqual({
      scope: SCOPE,
      uuid: UUID,
      stem: UUID,
      extension: 'png',
    });
  });

  it('still refuses a traversal', () => {
    expect(parseObjectMemberKey('products/../../etc/passwd')).toBeNull();
    expect(parseObjectMemberKey(`products/${SCOPE}/${UUID}/a.b.webp`)).toBeNull();
  });
});

describe('keyInScope', () => {
  it('accepts a key carrying this scope', () => {
    expect(keyInScope(`products/${SCOPE}/${UUID}/full.webp`, SCOPE, 'reject')).toBe(true);
  });

  it("refuses another tenant's key, whatever the reference probes would say", () => {
    // This is the structural half of tenant isolation: a probe answers "does
    // anything of MINE reference this?", which is true of every other tenant's
    // objects too.
    expect(keyInScope(`products/outra-loja/${UUID}/full.webp`, SCOPE, 'accept')).toBe(false);
    expect(keyInScope(`products/outra-loja/${UUID}/full.webp`, SCOPE, 'reject')).toBe(false);
  });

  it('lets an UNSCOPED legacy key through only when the host said so', () => {
    expect(keyInScope(`products/${UUID}/full.webp`, SCOPE, 'accept')).toBe(true);
    expect(keyInScope(`products/${UUID}/full.webp`, SCOPE, 'reject')).toBe(false);
  });

  it('refuses a key it did not mint under either setting', () => {
    expect(keyInScope('../../etc/passwd', SCOPE, 'accept')).toBe(false);
  });
});

describe('isLegalScope', () => {
  it('accepts a slug or an id and refuses anything a path could not carry', () => {
    expect(isLegalScope('minha-loja')).toBe(true);
    expect(isLegalScope(UUID)).toBe(true);
    expect(isLegalScope('a'.repeat(64))).toBe(true);
    expect(isLegalScope('a'.repeat(65))).toBe(false);
    expect(isLegalScope('-leading')).toBe(false);
    expect(isLegalScope('has.dot')).toBe(false);
  });
});
