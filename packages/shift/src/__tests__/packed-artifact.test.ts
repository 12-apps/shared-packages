// @vitest-environment node
/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation --
   the filesystem IS the subject: this suite asks npm what it would upload and
   then reads those exact bytes off disk, so mocking the reads would leave it
   asserting against a fixture instead of against the artifact. The isolation
   finding is the `for (const entry of ...)` binding in the sweep loop, a
   per-iteration local. */
/**
 * THE PUBLISHED ARTIFACT — swept, not the rendered output.
 *
 * This package renders nothing, so a ban list run over some surface's output
 * would prove nothing at all. What ships is `src` (minus tests), `prisma` and
 * every `*.md` — so a host's vocabulary can leave through a comment, a doc
 * sentence, a schema annotation or a migration and be invisible to every
 * behavioural test in the suite.
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
  frozenMigrationExemptions,
  HOST1,
  HOST2,
  removedVocabularyPatterns,
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
 * Calling {@link readPackedFiles} per case is what once stopped this repo
 * publishing (#173): npm takes ~26s a call on a runner building every package
 * at once, so two calls put the file past vitest's worker RPC timeout while
 * each individual case stayed inside its own budget and passed.
 *
 * Memoised in a module-private container rather than a `beforeAll`, because a
 * describe-scoped binding reassigned from a hook reads as an order dependency
 * and a module-level `let` trips `no-global-state-mutation`. Write-once, over a
 * pure read of the working tree — one call is as true as three.
 */
const packCache: { entries?: readonly string[] } = {};
function packedFiles(): readonly string[] {
  packCache.entries ??= readPackedFiles();
  return packCache.entries;
}

const isText = (entry: string): boolean =>
  /\.(?:ts|tsx|js|mjs|cjs|json|md|sql|prisma|map)$/.test(entry);

/** Every ban a file's text trips, minus that file's recorded exemptions. */
export function offencesIn(
  entry: string,
  text: string,
  bans: readonly ForeignPattern[],
  exempt: readonly string[] = [],
): string[] {
  const found: string[] = [];
  for (const { pattern } of bans) {
    const hit = pattern.exec(text);
    if (!hit) continue;
    if (exempt.some((allowed) => allowed.toLowerCase() === hit[0].toLowerCase())) continue;
    found.push(`${entry}: ${JSON.stringify(hit[0])}`);
  }
  return found;
}

function sweep(bans: readonly ForeignPattern[]): string[] {
  const exemptions = frozenMigrationExemptions();
  const offences: string[] = [];
  for (const entry of packedFiles()) {
    if (!isText(entry)) continue;
    const full = join(PACKAGE_ROOT, entry);
    if (!statSync(full, { throwIfNoEntry: false })?.isFile()) continue;
    offences.push(
      ...offencesIn(entry, readFileSync(full, 'utf-8'), bans, exemptions.get(entry)),
    );
  }
  return offences;
}

describe('the published tarball', () => {
  it('never ships this ban list, which is what lets it name every banned string', () => {
    // `files` excludes `**/__tests__/**`. If that stopped holding, every file in
    // this folder would become its own first offence.
    expect(packedFiles().filter((entry) => entry.includes('__tests__'))).toEqual([]);
  });

  it('carries no word belonging to the application it was extracted from', () => {
    expect(sweep(foreignPatterns())).toEqual([]);
  });

  it('carries no identifier of the vocabulary that was removed', () => {
    // `SHIFT_KINDS`, `ShiftKind` and the two resource-type constants were
    // exported runtime values. A leftover mention in a doc or a comment is how
    // a removed export gets reintroduced by the next reader.
    expect(sweep(removedVocabularyPatterns())).toEqual([]);
  });
});

describe('the sweep itself', () => {
  it('would fail on each shape the leak actually took', () => {
    // Anti-vacuity: a sweep whose patterns rotted matches nothing and reads
    // exactly like success.
    const bans = [...foreignPatterns(), ...removedVocabularyPatterns()];
    const samples = [
      `-- ${HOST1}-${HOST2} owns this table`,
      'export const SHIFT_KINDS = [] as const;',
      'KITCHEN_STATIONS_RESOURCE_TYPE',
      'SECTORS_RESOURCE_TYPE',
      'a kitchen shift claims a station',
      'the sector a waiter is on',
      '-- (FUT-446)',
      'o preço é R$59,00',
      'uma comanda aberta na mesa',
      'export type ShiftKind = string;',
    ];
    for (const sample of samples) {
      expect(offencesIn('sample.ts', sample, bans)).not.toEqual([]);
    }
  });

  it('does not fire on the words this package needs to describe itself', () => {
    const bans = [...foreignPatterns(), ...removedVocabularyPatterns()];
    const allowed = [
      'export function createShiftService(db: ShiftDb, options: ShiftServiceOptions)',
      'a shift binds a worker to a tenant and, optionally, to one resource',
      'export type ShiftKindTuple = readonly [string, ...string[]];',
      'the service refuses a kind the host did not declare',
      'the resource assignment is released when the shift ends',
    ];
    for (const sample of allowed) {
      expect(offencesIn('sample.ts', sample, bans)).toEqual([]);
    }
  });

  it('keeps the frozen-migration exemptions narrow — exact literals, exact paths', () => {
    const bans = foreignPatterns();
    const frozen = 'prisma/migrations/20260730210000_add_shifts/migration.sql';
    const exempt = frozenMigrationExemptions().get(frozen) ?? [];

    // The recorded literal passes on the file it was recorded for…
    expect(offencesIn(frozen, "CHECK (kind IN ('kitchen'))", bans, exempt)).toEqual([]);
    // …a DIFFERENT offence in the same file does not…
    expect(offencesIn(frozen, '-- uma mesa', bans, exempt)).toEqual([`${frozen}: "mesa"`]);
    // …and the same word anywhere else is still a failure. An exemption is a
    // property of one path, not a hole in the pattern.
    expect(offencesIn('src/service.ts', "'kitchen'", bans, [])).toEqual([
      'src/service.ts: "kitchen"',
    ]);
  });

  it('exempts only files the freeze actually locks', () => {
    // An exemption on an EDITABLE file would be a hole with no justification:
    // the fix there is to reword the file. Both entries name a frozen migration.
    const lock = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, '..', '..', 'migration-freeze.json'), 'utf-8'),
    ) as Record<string, string>;
    for (const entry of frozenMigrationExemptions().keys()) {
      expect(Object.keys(lock)).toContain(`packages/shift/${entry}`);
    }
  });
});
