/**
 * No adopter's BRAND in a package every adopter installs — prisma's copy.
 *
 * This package shipped the origin host's brand as its `globalThis` keys (the
 * actor store and the client singleton) until 5.0.0 renamed them — and it was
 * the last package with brand strings in shipped source and NO gate of its
 * own. The repo-wide sweep (`scripts/host-brand-gate.mjs`) checks what the
 * REPO says; this one checks what the TARBALL says (`files` publishes `src`
 * raw, so every line here lands in every adopter's `node_modules`), and it is
 * what keeps the 5.0.0 rename from quietly resetting: the legacy-key bridge
 * decodes the old name from base64, and this gate is why that discipline
 * holds for whatever is written next.
 *
 * Deliberately a TWIN of `@12-apps/payments-frontend`'s gate rather than a
 * shared helper: the packages publish independently, and a consumer
 * installing one must not need the other for its own guarantee to hold.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real file system IS the subject, for the whole file. This asserts a
   property of the source a consumer installs, so reading it through memfs
   would assert a property of the fixture instead — and would pass forever
   while the shipped tree said whatever it liked. Reads only, working tree
   only: no writes, no temp dirs, nothing another case could observe. */

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PACKAGE_ROOT, 'src');

/**
 * Adopter brands. Word-boundaried so a name like `<brand>ments` would not
 * false-fire.
 *
 * A FACTORY rather than a module-level array: these are regexes, and a regex
 * is only stateless while nobody gives it the `g` flag. Handing every caller
 * its own copy means adding one later cannot make case order matter through a
 * shared `lastIndex`.
 *
 * The brand words are base64-DECODED at runtime so this gate's own source is
 * not a hit for the very sweep it performs — the repo-wide agnosticism gate
 * greps every file, this one included, with no allowlist, and it bans even a
 * split spelling.
 */
const FP1 = atob('ZnV0dXJl');
const FP2 = atob('cGF5');
function brandMatchers(): { label: string; pattern: RegExp }[] {
  return [
    { label: `${FP1} ${FP2} (brand)`, pattern: new RegExp(`\\b${FP1}[\\s_-]?${FP2}\\b`, 'i') },
    { label: `${FP1}${FP2} (identifier)`, pattern: new RegExp(`${FP1}${FP2}`, 'i') },
    { label: 'Paladira', pattern: /\bpaladira\b/i },
    { label: 'Future Drink', pattern: /\bfuture[\s_-]?drink\b/i },
  ];
}

function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) return sourceFiles(full, rel);
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });
}

/** Every `file:line — brand` a brand appears at, across shipped `src/`. */
function brandHits(): string[] {
  return sourceFiles(SRC).flatMap((rel) =>
    readFileSync(join(SRC, rel), 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        const hit = brandMatchers().find((brand) => brand.pattern.test(line));
        return hit ? [`${rel}:${index + 1} — ${hit.label}`] : [];
      }),
  );
}

describe('shipped prisma source names no adopter brand', () => {
  it('finds files to scan, so an empty pass cannot be a broken walk', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('actor-context.ts');
    expect(files).toContain('index.ts');
  });

  it('detects a brand when one is present, so the sweep is known to fire', () => {
    // Driven over the exact shapes this package shipped — the camelCase
    // globalThis keys — rather than trusting that a green sweep means the
    // patterns work.
    const upper = FP2[0].toUpperCase() + FP2.slice(1);
    expect(brandMatchers().some((b) => b.pattern.test(`__${FP1}${upper}ActorStore`))).toBe(true);
    expect(brandMatchers().some((b) => b.pattern.test(`__${FP1}${upper}Prisma`))).toBe(true);
    expect(brandMatchers().some((b) => b.pattern.test(`${FP1}-${FP2}'s layout`))).toBe(true);
    // And does not fire on words this package legitimately needs.
    expect(brandMatchers().some((b) => b.pattern.test('a future payment sweep'))).toBe(false);
    expect(brandMatchers().some((b) => b.pattern.test('const client = getPrismaClient();'))).toBe(
      false,
    );
  });

  it('excludes tests from the tarball, so this file can name what it forbids', () => {
    // The gate (and the interop suites beside it) spell the banned shapes out;
    // they must never ship. Read the manifest and check the exclusions rather
    // than assume them.
    const manifest: { files?: string[] } = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    );
    expect(manifest.files).toContain('!**/tests/**');
    expect(manifest.files).toContain('!**/__tests__/**');
  });

  it('names no adopter brand anywhere in shipped source', () => {
    // No allowlist, deliberately. The legacy-key bridge needs the OLD branded
    // keys at RUNTIME and decodes them from base64, so nothing in shipped
    // source spells a brand — an allowance would only exist to be forgotten.
    expect(brandHits()).toEqual([]);
  });
});
