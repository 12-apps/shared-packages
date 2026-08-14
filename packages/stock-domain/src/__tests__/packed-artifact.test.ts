// @vitest-environment node
/**
 * THE PUBLISHED ARTIFACT — swept, not the source tree.
 *
 * This package publishes its SOURCE: `exports` points at `./src/index.ts` and
 * `files` ships `src`, `dist`, `prisma`, every root `*.js`/`*.mjs` and every
 * `*.md`. So a host's vocabulary can leave here inside a doc sentence, a code
 * comment, a JSDoc example or an adoption guide — none of which any behavioural
 * test renders, and all of which land in an adopter's `node_modules`.
 *
 * The `files` field is read from npm rather than restated: a second copy of
 * those globs rots in the direction of looking at less. `npm pack --dry-run
 * --json` is asked what would be uploaded, every entry is read off disk, and a
 * word belonging to the application this package was extracted from fails the
 * run.
 *
 * The ban list itself lives in `./foreign-vocabulary`, because the portability
 * suite next door checks its fixtures against the same set and a second copy of
 * it is the drift this package exists to make impossible.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  foreignPatterns,
  REMOVED_EXPORTS_ALLOWED_IN,
  removedExportPatterns,
  type ForeignPattern,
} from './foreign-vocabulary';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What `npm publish` would upload, straight from npm. */
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
 * A case that calls {@link readPackedFiles} for itself runs npm again — ~26s
 * apiece on a runner building 31 packages at once. That shape took down
 * `@12-apps/entitlements` (#173): every case stayed inside its own budget and
 * passed, the FILE outlived vitest's worker RPC, the resulting unhandled error
 * failed the run while the suite reported all green, and `Release` — which
 * needs that job — was SKIPPED, so the repo stopped publishing. Three calls
 * here would be the same cliff; so would two.
 *
 * Memoised HERE rather than in a `beforeAll`, because a describe-scoped binding
 * reassigned from a hook is shared mutable state and reads as an order
 * dependency (`test-flakiness/no-test-isolation`), while a module-level `let`
 * trips `no-global-state-mutation`. The cache is a module-private container,
 * written once, and the pack is a pure read of the working tree — so no case
 * can observe another having run first.
 */
const packCache: { entries?: readonly string[] } = {};
function packedFiles(): readonly string[] {
  packCache.entries ??= readPackedFiles();
  return packCache.entries;
}

/** Files whose CONTENT is worth reading — everything textual. */
function isTextual(entry: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql)$/.test(entry);
}

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real file system IS the subject. These assert properties of the bytes npm
   would upload, so reading them through memfs would assert properties of the
   mock instead. */

/** Every textual packed entry, as `[path, contents]`. */
function packedText(): [string, string][] {
  return packedFiles()
    .filter(isTextual)
    .filter((entry) => statSync(join(PACKAGE_ROOT, entry)).isFile())
    .map((entry) => [entry, readFileSync(join(PACKAGE_ROOT, entry), 'utf8')]);
}

/* eslint-enable test-flakiness/no-unmocked-fs */

/** `entry: "label"` for every ban a packed entry trips. */
function offences(bans: ForeignPattern[], skip?: string): string[] {
  return packedText().flatMap(([entry, text]) =>
    entry === skip
      ? []
      : bans.filter(({ pattern }) => pattern.test(text)).map(({ label }) => `${entry}: "${label}"`),
  );
}

/** Which bans a given string trips, by label. */
function caughtIn(bans: ForeignPattern[], text: string): string[] {
  return bans.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

describe('the tarball npm would upload', () => {
  // `npm pack --dry-run` shells out and walks the whole tree; under the full
  // suite's parallelism the first call comfortably outruns the 5s default.
  const PACK_TIMEOUT_MS = 60_000;

  it('publishes the entries the manifest claims, and no tests', () => {
    const files = packedFiles();
    // Anti-vacuity: a sweep over an empty list proves nothing, and an empty
    // list here would mean the pack call failed silently.
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files).toContain('ADOPTING.md');
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/vocabulary.ts');
    expect(files).toContain('src/taxonomy.ts');
    expect(files).toContain('src/errors.ts');

    // `files` excludes these, and has to keep doing so: the suites next door
    // name two foreign vocabularies on purpose, and `foreign-vocabulary.ts`
    // names every banned string there is.
    const shipped = files.filter(
      (entry) => entry.includes('__tests__') || /\.(test|spec)\./.test(entry),
    );
    expect(shipped).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it('carries no word belonging to the application it was extracted from', () => {
    expect(offences(foreignPatterns())).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it('would catch a plant, so a green run means something', () => {
    // The same check over strings that ARE violations. Without this the sweep
    // above passes just as happily once the patterns stop matching anything.
    //
    // Three plants rather than one, each naming the entries it must trip:
    // the value words with the boundary that makes them precise, the
    // underscored keys `\bloss\b` structurally cannot see, and the pt-BR
    // labels the values wear on the origin's screens.
    const bans = foreignPatterns();
    expect(caughtIn(bans, 'kind: LOSS | GAIN, category: WASTE | LOSS | SPOILAGE')).toEqual(
      expect.arrayContaining(['LOSS', 'GAIN', 'WASTE', 'SPOILAGE']),
    );
    expect(
      caughtIn(bans, 'feature stock.loss_tracking over loss_reasons and loss_events'),
    ).toEqual(expect.arrayContaining(['loss_tracking', 'loss_reasons', 'loss_events']));
    expect(
      caughtIn(bans, 'motivo de perda: Desperdício, Estrago — total R$59,00 na loja'),
    ).toEqual(expect.arrayContaining(['motivo', 'perda', 'desperdício', 'estrago', 'R$', 'loja']));
  });

  it('does not fire on the words the shape itself is described in', () => {
    // The other half of the plant: a ban list wide enough to hit `lossless`,
    // `against` or `bargain` would have to be narrowed by exceptions, and an
    // exception list is where a real value hides.
    const innocent =
      'a lossless narrowing checked against the declared set — no bargain, and no waster of bytes';
    expect(caughtIn(foreignPatterns(), innocent)).toEqual([]);
  });
});

describe('the removed exports do not come back', () => {
  const PACK_TIMEOUT_MS = 60_000;

  it('appear in no published entry but the migration table', () => {
    expect(offences(removedExportPatterns(), REMOVED_EXPORTS_ALLOWED_IN)).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it('DO still appear there, so the exemption is load-bearing rather than dead', () => {
    // The other direction, and the reason the exemption is one exact path: an
    // allowance for a file that no longer trips anything is an allowance nobody
    // would notice widening.
    const table = packedText().find(([entry]) => entry === REMOVED_EXPORTS_ALLOWED_IN);
    expect(table).toBeDefined();
    expect(caughtIn(removedExportPatterns(), table?.[1] ?? '')).toEqual(
      expect.arrayContaining([
        'STOCK_REASON_KIND(S)',
        'LOSS_CATEGOR(IES|Y)',
        'StockReasonKind',
        'LossCategory',
      ]),
    );
  }, PACK_TIMEOUT_MS);

  it('would catch each of the eight names if one returned to the source', () => {
    // Named, not counted, and one plant per REMOVED EXPORT rather than per
    // pattern: four patterns stand in for eight names, and a plant that only
    // exercises four of them proves nothing about the other four.
    const bans = removedExportPatterns();
    for (const [name, label] of [
      ['STOCK_REASON_KINDS', 'STOCK_REASON_KIND(S)'],
      ['DEFAULT_STOCK_REASON_KIND', 'STOCK_REASON_KIND(S)'],
      ['LOSS_CATEGORIES', 'LOSS_CATEGOR(IES|Y)'],
      ['DEFAULT_LOSS_CATEGORY', 'LOSS_CATEGOR(IES|Y)'],
      ['StockReasonKind', 'StockReasonKind'],
      ['isStockReasonKind', 'StockReasonKind'],
      ['LossCategory', 'LossCategory'],
      ['isLossCategory', 'LossCategory'],
    ] as const) {
      expect(caughtIn(bans, `export const ${name} = 1;`)).toContain(label);
    }
  });

  it('are invisible to the word-boundary list, which is why they need their own', () => {
    // The rationale, asserted rather than asserted-in-a-comment: `_` and a
    // camel hump are both word characters, so `\bloss\b` cannot see any of
    // these four — the exact near-miss class the underscored feature keys were
    // added for.
    for (const name of [
      'LOSS_CATEGORIES',
      'DEFAULT_LOSS_CATEGORY',
      'LossCategory',
      'isLossCategory',
    ]) {
      expect(caughtIn(foreignPatterns(), `export const ${name} = 1;`)).toEqual([]);
    }
  });
});
