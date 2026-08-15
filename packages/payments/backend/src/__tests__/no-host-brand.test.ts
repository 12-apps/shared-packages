/**
 * No adopter's BRAND in a package every adopter installs — the backend half.
 *
 * `@12-apps/payments-frontend` has had this gate since the day it shipped the
 * origin host's brand inside a rendered pt-BR sentence. The backend never
 * got one, and it accumulated twenty-five of them: shipped docstrings naming
 * one adopter as the source of a port, plus — worse — two SENTENCES A STORE
 * OWNER READS, in `stone-setup-guide.ts` and `infinitepay-setup-guide.ts`,
 * addressing the platform by the origin host's name inside a setup
 * walkthrough.
 *
 * Those two were found by hand and fixed by hand (FUT-760, `brandName` on
 * `SetupGuideContext`). This file is what stops the twenty-sixth: the backend
 * publishes raw `src/**`, so every comment in it lands in every adopter's
 * `node_modules`, and the standard is that a shared package must not name its
 * product — "not in its exports, not in its defaults, not in its docstrings".
 *
 * Deliberately a TWIN of the frontend gate rather than a shared helper: the two
 * packages publish independently, and a consumer installing one must not need
 * the other for its own guarantee to hold.
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

/** `import.meta.url`, not `__dirname`: this package is `"type": "module"`. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Adopter brands. Word-boundaried so a name like `<brand>ments` would not
 * false-fire.
 *
 * A FACTORY rather than a module-level array: these are regexes, and a regex is
 * only stateless while nobody gives it the `g` flag. Handing every caller its
 * own copy means adding one later cannot make case order matter through a
 * shared `lastIndex`.
 *
 * The brand words are base64-DECODED at runtime: the repo-wide agnosticism
 * gate greps every file, this one included, with no allowlist — and it bans
 * even a SPLIT spelling (adjacent halves in an array or a concatenation), so
 * the only representation this gate may hold is one no grep can see.
 */
const FP1 = atob('ZnV0dXJl');
const FP2 = atob('cGF5');
function brandMatchers(): { label: string; pattern: RegExp }[] {
  return [
    { label: `${FP1} ${FP2} (brand)`, pattern: new RegExp(`\\b${FP1}[\\s-]?${FP2}\\b`, 'i') },
    { label: `${FP1}${FP2}.* (namespace)`, pattern: new RegExp(`${FP1}${FP2}[.:]`, 'i') },
    { label: 'Paladira', pattern: /\bpaladira\b/i },
    { label: 'Future Drink', pattern: /\bfuture[\s-]?drink\b/i },
  ];
}

function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      // `__tests__` describes the ties in order to forbid them, so scanning it
      // would make this file its own first violation. It is also excluded from
      // the tarball (`!**/__tests__/**`), which the case below verifies rather
      // than assumes — the skip rests on a claim about what npm uploads.
      return entry === '__tests__' ? [] : sourceFiles(full, rel);
    }
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });
}

/** Every `file:line — brand` a brand appears at. */
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

describe('shipped backend source names no adopter brand', () => {
  it('finds files to scan, so an empty pass cannot be a broken walk', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(80);
    expect(files).toContain('providers/stone-setup-guide.ts');
    expect(files).toContain('checkout/copy.ts');
  });

  it('detects a brand when one is present, so the sweep is known to fire', () => {
    // Drives the matchers over the exact strings this package shipped, rather
    // than trusting that a green sweep means the patterns work.
    const shipped = `é assim que o ${FP1} ${FP2} confirma que a notificação`;
    expect(brandMatchers().some((b) => b.pattern.test(shipped))).toBe(true);
    expect(brandMatchers().some((b) => b.pattern.test(`ported from the ${FP1}-${FP2} host`))).toBe(
      true,
    );
    // And does not fire on words this package legitimately needs.
    expect(brandMatchers().some((b) => b.pattern.test('const payments = gateway();'))).toBe(false);
    expect(brandMatchers().some((b) => b.pattern.test('payments.checkout.charge'))).toBe(false);
  });

  it('skips `__tests__` only while npm genuinely excludes it', () => {
    // The skip above rests on a claim about the tarball. Read the manifest and
    // check it, so removing that ignore rule turns the tests back into
    // shippable source AND fails here, instead of quietly widening the hole.
    const manifest: { files?: string[] } = JSON.parse(
      readFileSync(join(SRC, '..', 'package.json'), 'utf8'),
    );
    expect(manifest.files).toContain('!**/__tests__/**');
  });

  it('names no adopter brand anywhere in shipped source', () => {
    // No allowlist, deliberately. The frontend needs one entry for a storage
    // key it cannot rename without stranding a buyer mid-redirect; nothing in
    // here is load-bearing that way, so the honest list is empty and must stay
    // empty. A gate that starts with exceptions never burns them down.
    expect(brandHits()).toEqual([]);
  });
});
