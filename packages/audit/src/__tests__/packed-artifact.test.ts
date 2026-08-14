// @vitest-environment node
/**
 * THE PUBLISHED ARTIFACT — swept, not the rendered output.
 *
 * A ban list run over `document.body.innerHTML` proves one thing about one
 * screen. The tarball is bigger than the screen: `files` here publishes `src`,
 * `prisma`, `scripts` and every top-level `*.md`, so a host's vocabulary can
 * ship in a doc sentence, a schema annotation, a migration comment or a JSDoc
 * block and never appear in a render. That is precisely how it survived here —
 * this package's whole reason for existing was a module holding one
 * application's actions, resources and pt-BR labels, exported by name.
 *
 * So this suite asks `npm pack` what would actually be uploaded, reads every
 * entry in that list off disk, and refuses a word belonging to the application
 * this package was extracted from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  foreignPatterns,
  removedVocabularyPatterns,
  REMOVED_EXPORTS_ALLOWED_IN,
  type ForeignPattern,
} from './foreign-vocabulary';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * What `npm publish` would upload, straight from npm rather than from a
 * reimplementation of the `files` field — a second copy of those globs would
 * rot in the direction of not looking.
 */
function readPackedFiles(): readonly string[] {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [tarball] = JSON.parse(raw) as [{ files: { path: string }[] }];
  return tarball.files.map((file) => file.path);
}

/**
 * The pack, computed at most once per FILE.
 *
 * Calling {@link readPackedFiles} per case is what stopped this repo publishing
 * once already: npm takes ~26s a call on a runner building 31 packages at once,
 * so three calls put the file past vitest's worker RPC timeout while every
 * individual case stayed inside its own budget and passed. The resulting
 * unhandled error fails the run whatever the assertions said, `Release` needs
 * that job so it is SKIPPED rather than failed, and the cause is invisible from
 * the log tail. Two sibling packages shipped the un-memoised copy.
 *
 * Memoised HERE rather than in a `beforeAll`, because a describe-scoped binding
 * reassigned from a hook is shared mutable state and reads as an order
 * dependency (`test-flakiness/no-test-isolation`), while a module-level `let`
 * reassignment trips `no-global-state-mutation`. The cache is a module-private
 * container property, write-once, and the pack is a pure read of the working
 * tree — so one call is as true as three and no case can observe another having
 * run first.
 */
const packCache: { entries?: readonly string[] } = {};
function packedFiles(): readonly string[] {
  packCache.entries ??= readPackedFiles();
  return packCache.entries;
}

/**
 * Files whose CONTENT is worth reading — everything textual.
 *
 * The sweep asserts, in its own case, that EVERY packed entry matches this: a
 * future `.mts`, `.map`, `.mdx` or `.yaml` would otherwise slip past and be
 * swept by nothing at all, silently and greenly.
 */
function isTextual(entry: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql)$/.test(entry);
}

/** What one ban actually found in a file, as concrete text. */
function hitsFor(text: string, ban: ForeignPattern): string[] {
  // The MATCHED TEXT, never the pattern source, so an exemption stays as narrow
  // as it claims to be: exempting `FUTURE_PAY_AUDIT_VOCABULARY` on one path
  // leaves `FUTURE_PAY_TRACKED_MODELS` on that same path failing. Deduplicated,
  // so one banned name repeated in a file is one offence and not a wall.
  const global = new RegExp(ban.pattern.source, `${ban.pattern.flags.replace('g', '')}g`);
  return [...new Set(text.match(global) ?? [])];
}

/**
 * Every ban a file's text trips.
 *
 * `removedVocabularyPatterns` is exempt on exactly ONE path — the migration
 * table in ADOPTING.md, whose left column has to name what was removed. The
 * prose bans are exempt nowhere at all.
 */
export function offencesIn(entry: string, text: string): string[] {
  const removedAllowed = entry === REMOVED_EXPORTS_ALLOWED_IN;
  const bans = removedAllowed
    ? foreignPatterns()
    : [...foreignPatterns(), ...removedVocabularyPatterns()];
  return bans.flatMap((ban) => hitsFor(text, ban).map((hit) => `${entry}: "${hit}"`));
}

describe('the tarball npm would upload', () => {
  // `npm pack --dry-run` shells out and reads the whole tree; under the full
  // suite's parallelism it comfortably outruns the 5s default.
  const PACK_TIMEOUT_MS = 60_000;

  /* eslint-disable test-flakiness/no-unmocked-fs --
     the real file system IS the subject. What this asserts is a property of the
     bytes npm would upload, so reading them through a mock would assert a
     property of the mock instead. */
  it('publishes the entries the manifest claims, and no tests', () => {
    const files = packedFiles();
    // The anti-vacuity guard for THIS case: an empty list here would mean the
    // pack call failed silently, and every `toContain` below would too.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files).toContain('ADOPTING.md');
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/core/vocabulary.ts');
    expect(files).toContain('src/server/create-api-audit.ts');
    expect(files).toContain('src/react/create-web-audit.tsx');
    expect(files).toContain('scripts/sync-audit-schema.mjs');
    expect(files).toContain('prisma/audit.prisma');
    expect(files).toContain('prisma/migrations/20260813120000_add_audit_log/migration.sql');

    // The module that used to ship one application's vocabulary. Named here
    // rather than left to the word sweep: the sweep would also pass if the file
    // came back holding a DIFFERENT product's values.
    expect(files).not.toContain('src/core/future-pay-vocabulary.ts');

    // `files` excludes these, and it has to keep doing so: the portability
    // hosts name a vocabulary on purpose, and the ban list itself is a file
    // full of banned words.
    const shipped = files.filter(
      (entry) => entry.includes('__tests__') || /\.(test|spec)\./.test(entry),
    );
    expect(shipped).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it('carries no word belonging to the application it was extracted from', () => {
    const packed = packedFiles();
    // Built by transformation rather than by pushing into an accumulator: the
    // flakiness lane reads a mutated array in a test body as shared state.
    const swept = packed
      .filter(isTextual)
      .filter((entry) => statSync(join(PACKAGE_ROOT, entry)).isFile());
    const offences = swept.flatMap((entry) =>
      offencesIn(entry, readFileSync(join(PACKAGE_ROOT, entry), 'utf8')),
    );
    expect(offences).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it('sweeps a non-empty list, and every packed entry is one it can read', () => {
    // The anti-vacuity guard, in its OWN case rather than folded into the sweep:
    // `offences` above is empty both when nothing leaks and when the loop never
    // ran, and a guard sharing a case with the assertion it protects is one bad
    // edit away from protecting nothing.
    const packed = packedFiles();
    const swept = packed.filter(isTextual);
    expect(swept.length).toBeGreaterThan(10);
    // And EVERY published entry must be one `isTextual` recognises. `files`
    // also ships `dist`; a genuinely binary asset arriving here has to be an
    // explicit decision in this diff rather than a gap nobody sees.
    expect(packed.filter((entry) => !isTextual(entry))).toEqual([]);
  }, PACK_TIMEOUT_MS);
  /* eslint-enable test-flakiness/no-unmocked-fs */

  it('would catch a plant, so a green run means something', () => {
    // The same check, over text that IS a violation — without this the sweep
    // passes just as happily once the word list stops matching anything.
    const planted =
      'a comanda da loja registra order.cancel e cobra R$59,00 — Página 1 de 2 (FUT-806)';
    const caught = offencesIn('src/planted.ts', planted);

    // Named, not counted: a plant that trips three other entries proves nothing
    // about the one being covered, and `length > 0` is satisfied by any of them.
    expect(caught).toContain('src/planted.ts: "comanda"');
    expect(caught).toContain('src/planted.ts: "loja"');
    expect(caught).toContain('src/planted.ts: "order.cancel"');
    expect(caught).toContain('src/planted.ts: "R$"');
    expect(caught).toContain('src/planted.ts: "Página"');
    expect(caught).toContain('src/planted.ts: "FUT-806"');
  });

  it('does not fire on the words this package needs to describe itself', () => {
    // A ban list needing exceptions is where a real value hides, so the
    // near-misses are pinned. Every one of these appears in published source.
    const innocent =
      'the audit trail records an action against a resource, in declaration ' +
      'order, with pagination meta and an impersonation pair; see RFC-3339 and ' +
      'ISO-8601 for the timestamps, and Order for the model a host may track.';
    expect(offencesIn('src/innocent.ts', innocent)).toEqual([]);
  });

  it('keeps the ADOPTING.md exemption narrow, and load-bearing', () => {
    // An exemption that swallowed the whole file would hide the next leak in
    // it, and one keyed on the pattern rather than the path would hide every
    // removed name everywhere. Both directions are asserted with the REAL list.
    const migrationRow = '| `FUTURE_PAY_AUDIT_VOCABULARY` | the origin catalog | gone |';
    expect(offencesIn(REMOVED_EXPORTS_ALLOWED_IN, migrationRow)).toEqual([]);
    // Same text, any other packed file: still a failure. Reported as the text
    // the ban MATCHED, which is what keeps an exemption as narrow as it claims.
    expect(offencesIn('src/index.ts', migrationRow)).toEqual([
      'src/index.ts: "FUTURE_PAY_AUDIT"',
    ]);
    // Same file, a PROSE ban rather than a removed export: still a failure, so
    // the exemption is scoped to the migration table's job and not to the file.
    expect(offencesIn(REMOVED_EXPORTS_ALLOWED_IN, 'one trail per loja')).toEqual([
      'ADOPTING.md: "loja"',
    ]);
  });

  /* eslint-disable test-flakiness/no-unmocked-fs --
     see above: the published bytes are the subject. */
  it('proves the exemption is not quietly dead', () => {
    // If ADOPTING.md ever stops naming the removed exports, the exemption
    // becomes decorative and its scoping cases prove the scoping of a rule
    // nothing exercises. So the file must still contain them.
    const adopting = readFileSync(join(PACKAGE_ROOT, REMOVED_EXPORTS_ALLOWED_IN), 'utf8');
    const named = removedVocabularyPatterns().filter(({ pattern }) =>
      new RegExp(pattern.source, pattern.flags.replace('g', '')).test(adopting),
    );
    expect(named.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['FUTURE_PAY_AUDIT_*', 'FUTURE_PAY_TRACKED_MODELS']),
    );
  });
  /* eslint-enable test-flakiness/no-unmocked-fs */
});
