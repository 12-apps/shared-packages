/**
 * No adopter's BRAND in a package every adopter installs.
 *
 * This package shipped `'O Future Pay cria as cobranças em seu nome'` in a
 * rendered component and `'futurepay.checkout.hostedOrder'` as a browser
 * storage key. Neither was a decision — the component's very next branch
 * already templated its provider from props — and neither was catchable,
 * because nothing looked. A brand is the one kind of tie that cannot be
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

// `import.meta.url`, not `__dirname`: this package is `"type": "module"`.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Adopter brands. Word-boundaried so `futurepayments` would not false-fire. */
const BRANDS = [
  { label: 'Future Pay', pattern: /\bfuture[\s-]?pay\b/i },
  { label: 'futurepay.* (namespace)', pattern: /futurepay[.:]/i },
  { label: 'Paladira', pattern: /\bpaladira\b/i },
  { label: 'Future Drink', pattern: /\bfuture[\s-]?drink\b/i },
];

/**
 * The ONE site allowed to name the old brand, and only because removing it
 * would strand a buyer mid-redirect across the deploy that renames the key.
 * It is read-only and documented for deletion; when it goes, this list goes
 * empty and must stay that way.
 */
const ALLOWED = [{ file: 'components/checkout/hosted-return.ts', declares: 'LEGACY_KEY' }];

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
        const hit = BRANDS.find((brand) => brand.pattern.test(line));
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
    expect(BRANDS.some((b) => b.pattern.test('O Future Pay cria as cobranças'))).toBe(true);
    expect(BRANDS.some((b) => b.pattern.test('"futurepay.checkout.hostedOrder"'))).toBe(true);
    // And does not fire on the words this package legitimately needs.
    expect(BRANDS.some((b) => b.pattern.test('const payments = usePayments();'))).toBe(false);
    expect(BRANDS.some((b) => b.pattern.test('payments.checkout.hostedOrder'))).toBe(false);
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
      expect(BRANDS.some((brand) => brand.pattern.test(declaringLine ?? ''))).toBe(true);
    }
  });
});
