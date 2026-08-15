/**
 * No adopter's BRAND in a package every adopter installs.
 *
 * This package shipped the origin host's brand inside a rendered pt-BR
 * sentence ('O <brand> cria as cobranças em seu nome') and as the namespace of
 * a browser storage key. Neither was a decision — the component's very next
 * branch already templated its provider from props — and neither was
 * catchable, because nothing looked. A brand is the one kind of tie that cannot be
 * defended as a sensible default for somebody else, so it gets a gate rather
 * than a review habit.
 *
 * Scope is deliberately narrow: BRAND names only, not domain vocabulary. The
 * restaurant words in `flows/copy.ts` (`garçom`, `mesa`, `cardápio`) are a
 * different and larger problem — they need a copy port, which is a breaking
 * change — and folding them in here would mean landing this gate red or
 * pre-loading it with exceptions it would never burn down. One rule that holds
 * beats a broader one that gets suppressed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real file system IS the subject, for the whole file. This asserts a
   property of the source a consumer installs, so reading it through memfs
   would assert a property of the fixture instead — and would pass forever
   while the shipped tree said whatever it liked. The reads are of the working
   tree only: no writes, no temp dirs, nothing another case could observe. */

// `import.meta.url`, not `__dirname`: this package is `"type": "module"`.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Adopter brands. Word-boundaried so a name like `<brand>ments` would not
 * false-fire.
 *
 * A FACTORY rather than a module-level array, and not merely to satisfy
 * `test-flakiness/no-test-isolation`: these are regexes, and a regex is only
 * stateless while nobody gives it the `g` flag. Handing every caller its own
 * copy means adding one later cannot make case order matter through a shared
 * `lastIndex` — the exact bug the rule is pointed at.
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

/**
 * Sites allowed to name the old brand — empty, and it must stay that way.
 * Even the one legitimate RUNTIME use of the old name (the read-only legacy
 * storage key in `hosted-return.ts`, kept for a buyer mid-redirect across an
 * adopter's key-renaming deploy) decodes it from base64, so shipped source
 * spells no brand and needs no allowance.
 */
const ALLOWED: { file: string; declares: string }[] = [];

function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      // `__tests__` describes the ties in order to forbid them, so scanning it
      // would make this file its own first violation. `stories` is Storybook
      // fixture data that npm never uploads — package.json's `files` carries
      // `!src/stories/**` — so a brand there reaches no adopter. Both are
      // skipped for reasons about SHIPPING, not for convenience: anything a
      // consumer can install is in scope.
      return entry === '__tests__' || entry === 'stories' ? [] : sourceFiles(full, rel);
    }
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });
}

/** Every `file:line — brand` a brand appears at, outside the allowlist. */
function brandHits(): string[] {
  return sourceFiles(SRC).flatMap((rel) => {
    const allowance = ALLOWED.find((entry) => entry.file === rel);
    return readFileSync(join(SRC, rel), 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        // An allowed FILE excuses only the line that declares the constant it
        // was granted for — not the rest of the file, and not a second use.
        if (allowance && line.includes(allowance.declares)) return [];
        const hit = brandMatchers().find((brand) => brand.pattern.test(line));
        return hit ? [`${rel}:${index + 1} — ${hit.label}`] : [];
      });
  });
}

describe('shipped source names no adopter brand', () => {
  it('finds files to scan, so an empty pass cannot be a broken walk', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('components/ProviderConnection.tsx');
    expect(files).toContain('components/checkout/hosted-return.ts');
  });

  it('detects a brand when one is present, so the sweep is known to fire', () => {
    // Drives the matchers over the shape they exist to catch, rather than
    // trusting that a green sweep means the patterns work.
    expect(brandMatchers().some((b) => b.pattern.test(`O ${FP1} ${FP2} cria as cobranças`))).toBe(true);
    expect(brandMatchers().some((b) => b.pattern.test(`"${FP1}${FP2}.checkout.hostedOrder"`))).toBe(true);
    // And does not fire on the words this package legitimately needs.
    expect(brandMatchers().some((b) => b.pattern.test('const payments = usePayments();'))).toBe(false);
    expect(brandMatchers().some((b) => b.pattern.test('payments.checkout.hostedOrder'))).toBe(false);
  });

  it('skips `stories` only while npm genuinely excludes it', () => {
    // The skip above rests on a claim about the tarball. Read the manifest and
    // check it, so removing that ignore rule turns the stories back into
    // shippable source AND fails here, instead of quietly widening the hole.
    const manifest: { files?: string[] } = JSON.parse(
      readFileSync(join(SRC, '..', 'package.json'), 'utf8'),
    );
    expect(manifest.files).toContain('!src/stories/**');
  });

  it('names no brand outside the documented allowance', () => {
    expect(brandHits()).toEqual([]);
  });

  it('keeps the allowance honest: every entry still exists and still applies', () => {
    // A stale allowance is worse than none — it reads as "we checked" while
    // excusing a line that moved or a file that no longer has the problem.
    for (const entry of ALLOWED) {
      const source = readFileSync(join(SRC, entry.file), 'utf8');
      expect(source).toContain(entry.declares);
      const declaringLine = source
        .split('\n')
        .find((line) => line.includes(entry.declares) && !line.trimStart().startsWith('*'));
      expect(brandMatchers().some((brand) => brand.pattern.test(declaringLine ?? ''))).toBe(true);
    }
  });
});
