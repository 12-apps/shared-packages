import { describe, expect, it } from 'vitest';

import { CATALOG_RENDITIONS } from '../renditions';
import { imageSources, objectUrl, versionedObjectUrl } from '../urls';

/**
 * Turning a key into URLs — resolved through the ACTIVE driver, which is why this
 * takes a resolver rather than reading configuration.
 */

const KEY = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';
const FLAT = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp';
const cdn = (key: string): string => `https://cdn.example.com/${key}`;

describe('imageSources', () => {
  it('builds a srcset per family, resolved through the driver', () => {
    const sources = imageSources(KEY, cdn);

    expect(sources?.card.srcSet).toBe(
      [
        'https://cdn.example.com/products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/card-320.webp 320w',
        'https://cdn.example.com/products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/card-640.webp 640w',
        'https://cdn.example.com/products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/card-1280.webp 1280w',
      ].join(', '),
    );
    expect(sources?.thumb.srcSet).toMatch(/thumb-128\.webp 128w, .*thumb-256\.webp 256w$/);
  });

  it('names exactly the renditions that are actually cut', () => {
    const sources = imageSources(KEY, (key) => key);
    const named = `${sources?.card.srcSet} ${sources?.thumb.srcSet}`;

    for (const spec of CATALOG_RENDITIONS) {
      expect(named).toContain(`${spec.name}.webp`);
    }
    // Nothing else: a URL for an object nobody wrote is a broken-image glyph.
    expect(named.match(/\.webp/g)).toHaveLength(CATALOG_RENDITIONS.length);
  });

  it('points `src` at the SMALLEST of the family', () => {
    // `src` is only reached without srcset support, and over-fetching is the worse
    // of the two ways to be wrong there.
    expect(imageSources(KEY, (key) => key)?.card.src).toContain('card-320.webp');
  });

  it('answers null for a photo stored without crops', () => {
    expect(imageSources(FLAT, cdn)).toBeNull();
    expect(imageSources(null, cdn)).toBeNull();
  });

  it('follows a host that cuts a different set', () => {
    const specs = [{ name: 'hero-800', width: 800, height: 600, family: 'card' as const }];
    const sources = imageSources(KEY, (key) => key, { specs });

    expect(sources?.card.srcSet).toContain('hero-800.webp 800w');
    expect(sources && 'thumb' in sources).toBe(false);
  });
});

describe('objectUrl', () => {
  it('resolves the uncropped object, which is what a zoom shows', () => {
    expect(objectUrl(KEY, cdn)).toBe(cdn(KEY));
  });

  it('returns an absolute URL unchanged', () => {
    // A host migrating off an older column may still hold URLs beside real keys.
    expect(objectUrl('https://old.example.com/a.png', cdn)).toBe('https://old.example.com/a.png');
  });

  it('answers null for a missing key so a caller can draw a placeholder', () => {
    expect(objectUrl(null, cdn)).toBeNull();
  });
});

describe('versionedObjectUrl', () => {
  it('stamps the URL so an installed home-screen icon actually re-fetches', () => {
    expect(versionedObjectUrl(FLAT, 'v2', cdn)).toBe(`${cdn(FLAT)}?v=v2`);
  });

  it('appends rather than assuming the base has no query of its own', () => {
    expect(versionedObjectUrl(FLAT, 'v2', (key) => `https://cdn/${key}?tok=1`)).toBe(
      `https://cdn/${FLAT}?tok=1&v=v2`,
    );
  });

  it('is the plain URL when there is no version to stamp', () => {
    expect(versionedObjectUrl(FLAT, null, cdn)).toBe(cdn(FLAT));
  });
});
