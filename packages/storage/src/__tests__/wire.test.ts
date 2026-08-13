import { describe, expect, it } from 'vitest';

import { objectUrl } from '../urls';
import { inlineImageSchema, objectKeySchema, refineImageInput } from '../wire';

/**
 * The wire shapes a host's write body is made of.
 *
 * `objectKeySchema` is here because of an adversarial finding about the ADOPTING
 * recipe, which accepted `imageKey: z.string()`. The hazard is not in either half
 * alone — it is the composition: an `imageKey` is rendered into an `<img src>` by
 * `objectUrl`, and `objectUrl` deliberately passes an ALREADY-ABSOLUTE value
 * through unchanged so a host can migrate off a URL column. Accept any string on
 * the write and you have accepted a third-party URL into a storefront page.
 */

const SCOPE = 'minha-loja';
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SET_KEY = `products/${SCOPE}/${UUID}/full.webp`;
const FLAT_KEY = `products/${SCOPE}/${UUID}.webp`;

const local = (key: string): string => `/api/uploads/local/${key}`;

describe('objectKeySchema', () => {
  it('accepts the shapes this scheme actually mints', () => {
    for (const key of [SET_KEY, FLAT_KEY, `products/${UUID}/full.webp`]) {
      expect(objectKeySchema().safeParse(key).success, key).toBe(true);
    }
  });

  it('refuses an absolute URL — the finding, stated as a case', () => {
    // Accepted by `z.string()`, and then rendered VERBATIM by `objectUrl`: every
    // buyer loading that storefront page sends their IP and user-agent to a third
    // party, with no upload, no bucket and no driver involved.
    const beacon = 'https://tracker.example/p.png';

    expect(objectKeySchema().safeParse(beacon).success).toBe(false);
    // The reason it matters, asserted rather than described.
    expect(objectUrl(beacon, local)).toBe(beacon);
  });

  it('refuses a protocol-relative and a scheme-shaped value too', () => {
    for (const value of [
      '//tracker.example/p.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
    ]) {
      expect(objectKeySchema().safeParse(value).success, value).toBe(false);
    }
  });

  it('leaves a scheme-shaped value inert even if a host skips the schema', () => {
    // Not a defence, an observation worth pinning: `objectUrl` only passes through
    // `^https?://`, so this is handed to the driver and comes back as a path under
    // the mount rather than as a `javascript:` href.
    expect(objectUrl('javascript:alert(1)', local)).toBe(
      '/api/uploads/local/javascript:alert(1)',
    );
  });

  it('refuses traversal, an empty string and free text', () => {
    for (const value of ['', '../../etc/passwd', 'products/../secret.png', 'not a key']) {
      expect(objectKeySchema().safeParse(value).success, value).toBe(false);
    }
  });

  it('follows the prefix it was given rather than a constant of its own', () => {
    const branding = `branding/${SCOPE}/${UUID}.webp`;

    expect(objectKeySchema('branding').safeParse(branding).success).toBe(true);
    // The same key under the default prefix is not a key at all.
    expect(objectKeySchema().safeParse(branding).success).toBe(false);
  });

  it('states a reason a host can surface', () => {
    const parsed = objectKeySchema().safeParse('https://tracker.example/p.png');

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain('object key');
  });
});

describe('the pair a write body is built from', () => {
  it('refuses a body stating BOTH a key and new bytes', () => {
    // They mean opposite things, so silently preferring one discards an upload the
    // caller cannot see was discarded.
    const issues: string[] = [];
    refineImageInput(
      { imageKey: SET_KEY, image: { contentType: 'image/png', contentBase64: 'AAAA' } },
      { addIssue: (issue: { message?: string }) => issues.push(issue.message ?? '') } as never,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('not both');
  });

  it('allows either one alone, and neither', () => {
    for (const value of [
      { imageKey: SET_KEY },
      { image: { contentType: 'image/png', contentBase64: 'AAAA' } },
      {},
    ]) {
      const issues: string[] = [];
      refineImageInput(value, {
        addIssue: (issue: { message?: string }) => issues.push(issue.message ?? ''),
      } as never);
      expect(issues).toEqual([]);
    }
  });

  it('builds the inline ceiling from the number it was handed', () => {
    expect(
      inlineImageSchema(1024).safeParse({ contentType: 'image/png', contentBase64: 'A'.repeat(4096) })
        .success,
    ).toBe(false);
    expect(
      inlineImageSchema(1024 * 1024).safeParse({
        contentType: 'image/png',
        contentBase64: 'A'.repeat(4096),
      }).success,
    ).toBe(true);
  });
});
