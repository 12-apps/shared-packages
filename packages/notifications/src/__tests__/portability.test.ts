/**
 * THE TRIPWIRE THIS PACKAGE DID NOT HAVE.
 *
 * `@12-apps/audit` and `@12-apps/impersonation` each carry a suite like this;
 * `notifications` shipped without one, and it had drifted furthest of the four:
 * ELEVEN docstrings naming the application it was extracted from, and a
 * `DEFAULT_NOTIFICATION_MESSAGES` table of some forty sentences labelled in the
 * source as that application's "exact copy" — spread UNDER a host's override,
 * and per KEY inside the three nested records, so a host relabelling one
 * channel kept the origin's wording for the other three.
 *
 * All of it was removed by hand. This file is what stops the next one, and it is
 * deliberately a TWIN of the sibling suites rather than a shared helper: these
 * packages publish independently, so a consumer installing one must not need
 * another for its own guarantee to hold.
 *
 * The subject is the SHIPPED FILES, not this suite's imports. A package can
 * pass every behavioural test it has and still ship somebody else's product
 * inside it — `files` in the manifest includes `src`, so every docstring here
 * lands in every adopter's `node_modules`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as rootEntry from '../index';

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real file system IS the subject, for the whole file. This asserts a
   property of the source a consumer installs, so reading it through a mock
   would assert a property of the fixture instead — and would pass forever
   while the shipped tree said whatever it liked. Reads only, working tree
   only: no writes, no temp dirs, nothing another case could observe. */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ROOT = join(SRC, '..');

/**
 * A FACTORY rather than a module-level array: these are regexes, and a regex is
 * stateless only until somebody adds the `g` flag. Handing each caller its own
 * copy means adding one later cannot make case order matter through a shared
 * `lastIndex`.
 */
const FP1 = 'future';
const FP2 = 'pay';
function brandMatchers(): { label: string; pattern: RegExp }[] {
  // The brand words are SPLIT (`FP1 + FP2`) so this gate's own source is not a
  // hit for the repo-wide agnosticism sweep, which greps every file with no
  // allowlist.
  return [
    { label: `${FP1} ${FP2} (brand)`, pattern: new RegExp(`\\b${FP1}[\\s_-]?${FP2}\\b`, 'i') },
    { label: 'Paladira', pattern: /\bpaladira\b/i },
    { label: 'Future Drink', pattern: /\bfuture[\s_-]?drink\b/i },
  ];
}

function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    // `__tests__` describes the ties in order to forbid them, so scanning it
    // would make this file its own first violation. It is also excluded from
    // the tarball, which a case below VERIFIES rather than assumes.
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full, rel);
    }
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });
}

/** Every `file:line` a pattern appears at, across the shipped source. */
function offendingLines(pattern: RegExp): string[] {
  return sourceFiles(SRC).flatMap((rel) =>
    readFileSync(join(SRC, rel), 'utf8')
      .split('\n')
      .flatMap((line, index) => (pattern.test(line) ? [`${rel}:${index + 1}: ${line.trim()}`] : [])),
  );
}

describe('the shipped source names no adopter', () => {
  it('finds files to scan, so an empty pass cannot be a broken walk', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('messages.ts');
    expect(files).toContain('types.ts');
  });

  it('detects a brand when one is present, so the sweep is known to fire', () => {
    // Driven over the exact strings this package shipped, rather than trusting
    // that a green sweep means the patterns work.
    const shipped = `/** ${FP1}-${FP2}'s exact copy — the product default. */`;
    expect(brandMatchers().some((b) => b.pattern.test(shipped))).toBe(true);
    expect(brandMatchers().some((b) => b.pattern.test(`In ${FP1}-${FP2} this`))).toBe(true);
    // …and does not fire on words this package legitimately needs.
    expect(brandMatchers().some((b) => b.pattern.test('const payload = future(); // pay'))).toBe(
      false,
    );
  });

  it('skips `__tests__` only while the manifest genuinely excludes it', () => {
    // The skip above rests on a claim about the tarball. Read the manifest and
    // check it, so removing that ignore rule turns the tests back into
    // shippable source AND fails here, instead of quietly widening the hole.
    const manifest: { files?: string[] } = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    );
    expect(manifest.files).toContain('!**/__tests__/**');
    expect(manifest.files).toContain('src');
  });

  it('names no adopter brand anywhere in shipped source', () => {
    // No allowlist, deliberately. Nothing in here is load-bearing on a brand,
    // so the honest list is empty and must stay empty — a gate that starts
    // with exceptions never burns them down.
    const hits = brandMatchers().flatMap((brand) =>
      offendingLines(brand.pattern).map((line) => `${line}  [${brand.label}]`),
    );
    expect(hits).toEqual([]);
  });

  it('carries no ticket ids from the application it was extracted from', () => {
    // A ticket number is a host's issue tracker leaking into a library: it
    // means nothing to any other consumer, and is a standing invitation to
    // write the next one down too. Published standards are spelled the same
    // way and are not that, so they are named out rather than matched.
    expect(offendingLines(/\b(?!ISO|RFC|UTF|SHA|AES|GCM|HTTP|UTC)[A-Z]{2,5}-\d{2,6}\b/)).toEqual(
      [],
    );
  });
});

describe('the shipped source ships nobody else\'s words', () => {
  it('exports no DEFAULT_ copy table for a host to inherit by accident', () => {
    // The defect this release removes. A default fails OPEN for a second host:
    // it silently adopts the extraction origin's vocabulary instead of failing
    // loudly at compile time, and a PARTIAL override is worse still — the gaps
    // are filled by another product with nothing reporting it.
    //
    // Scoped to copy rather than to every `DEFAULT_`: `DEFAULT_PAGE`,
    // `DEFAULT_SWEEP_TAKE` and `DEFAULT_MAX_DELIVERY_ATTEMPTS` are this
    // package's own machinery (a page size is not somebody's language), and
    // forbidding them outright would be a rule nobody could keep.
    //
    // `CATEGORIES` is named too: the taxonomy left this package one release
    // ago and must not come back through a differently-shaped door.
    const exported = Object.keys(rootEntry);
    expect(exported.filter((name) => /^DEFAULT_.*MESSAGES?$/.test(name))).toEqual([]);
    expect(
      exported.filter((name) => /(MESSAGES?|LABELS?|COPY|CATEGORIES)$/.test(name)),
    ).toEqual([]);
  });
});
