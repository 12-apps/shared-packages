// @vitest-environment node
/**
 * THE PUBLISHED ARTIFACT — swept, not the rendered output.
 *
 * A ban list that only reads `document.body.innerHTML` proves one thing about
 * one screen. The tarball is bigger than the screen: `files` here publishes
 * `src`, `prisma`, `scripts` and every `*.md`, so a host's vocabulary can ship
 * in a doc, a helper, a migration or a comment and never appear in a render.
 * That is exactly how a sibling package's leak survived its own portability
 * test — the offending strings sat in `src/e2e/helpers`, which its `files`
 * field publishes.
 *
 * So this suite asks `npm pack` what would actually be uploaded, reads every
 * file in that list off disk, and refuses a word belonging to the application
 * this package was extracted from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * What `npm publish` would upload, straight from npm rather than from a
 * reimplementation of the `files` field — a second copy of those globs would
 * rot in the direction of not looking.
 */
function packedFiles(): string[] {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [tarball] = JSON.parse(raw) as [{ files: { path: string }[] }];
  return tarball.files.map((file) => file.path);
}

/**
 * Every word belonging to the host application this package came out of: its
 * name, its nouns, its feature keys, its tier names and its currency.
 *
 * Matched case-insensitively against the whole packed file, so it also catches
 * a comment, a doc sentence and a migration. Built fresh per call so no test
 * can mutate what a later one checks against.
 */
function foreignWords(): readonly string[] {
  return [
    'future pay',
    'future-pay',
    'futurepay',
    'loja',
    'mesas',
    'comanda',
    'cozinha',
    'cardápio',
    'estoque',
    'fornecedor',
    'salão',
    'garçom',
    'pagbank',
    // No trailing space. This entry used to read `'R$ '`, which is not how a
    // price is usually written: `R$59,00` shipped straight past it, and the
    // surface suite next door (`portability-surface.test.tsx`) had always
    // banned the bare symbol — so the two gates disagreed about the same word.
    'R$',
    'stock.locations',
    'catalog.products',
    'storefront.tables',
    'branding.white_label',
    'suppliers.nfe_import',
    'integrations.mcp',
    'acima do Max',
  ];
}

/**
 * Deliberately NOT on the list: `audit.retention_days`, which appears once as
 * a doc example in `prisma/entitlements.prisma`. An audit trail with a
 * retention window in days is a fact about retention quotas, not about any
 * one product — the same category as `seats.included` — and every genuinely
 * host-shaped key beside it (a warehouse location, a storefront table, a
 * white-label switch) IS listed. The judgement is recorded here rather than
 * left implicit, because an unexplained gap in a completeness gate is
 * indistinguishable from an oversight.
 */

/** Files whose CONTENT is worth reading — everything textual. */
function isTextual(entry: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql)$/.test(entry);
}

describe('the tarball npm would upload', () => {
  // `npm pack --dry-run` shells out and reads the whole tree; under the full
  // suite's parallelism it comfortably outruns the 5s default.
  const PACK_TIMEOUT_MS = 60_000;

  it('publishes the entries the manifest claims, and no test fixtures', () => {
    const files = packedFiles();
    // The anti-vacuity guard: a sweep over an empty list proves nothing, and
    // an empty list here would mean the pack call failed silently.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files).toContain('ADOPTING.md');
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/server/contribution.ts');
    expect(files).toContain('scripts/entitlements-coverage.mjs');
    expect(files).toContain('prisma/entitlements.prisma');

    // `files` excludes these, and it has to keep doing so: the fixtures and
    // the portability hosts name a vocabulary on purpose.
    const shipped = files.filter(
      (entry) => entry.includes('__tests__') || /\.(test|spec)\./.test(entry),
    );
    expect(shipped).toEqual([]);
  }, PACK_TIMEOUT_MS);

  /* eslint-disable test-flakiness/no-unmocked-fs --
     the real file system IS the subject. What this asserts is a property of
     the bytes npm would upload, so reading them through memfs would assert a
     property of the mock instead. */
  it('carries no word belonging to the application it was extracted from', () => {
    const banned = foreignWords();
    const offences: string[] = [];
    for (const entry of packedFiles().filter(isTextual)) {
      const absolute = join(PACKAGE_ROOT, entry);
      if (!statSync(absolute).isFile()) continue;
      const haystack = readFileSync(absolute, 'utf8').toLowerCase();
      for (const word of banned) {
        if (haystack.includes(word.toLowerCase())) offences.push(`${entry}: "${word}"`);
      }
    }
    expect(offences).toEqual([]);
  }, PACK_TIMEOUT_MS);
  /* eslint-enable test-flakiness/no-unmocked-fs */

  it('would catch a plant, so a green run means something', () => {
    // The same check, run over a string that IS a violation — without this the
    // suite above passes just as happily when the word list stops matching.
    //
    // The plant now carries a PRICE, and one written the way a price actually
    // is: `R$59,00`, no space. The old plant contained no currency at all, so
    // the currency entry had zero coverage here — which is exactly how it went
    // unnoticed that the entry itself demanded a trailing space.
    const planted = 'o plano da loja inclui 3 locais de estoque por R$59,00';
    const caught = foreignWords().filter((word) =>
      planted.toLowerCase().includes(word.toLowerCase()),
    );
    // Named, not counted: a plant that trips three other entries proves
    // nothing about the one being covered, and `length > 0` is satisfied by
    // any of them.
    expect(caught).toContain('R$');
    expect(caught).toContain('loja');
    expect(caught).toContain('estoque');
  });
});
