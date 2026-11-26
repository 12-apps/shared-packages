import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/* eslint-disable test-flakiness/no-unmocked-fs --
   The shipped source tree on disk IS the subject of this suite. */

/**
 * The package knows only "tenant". Every file under `src/` is searched for the
 * vocabulary of the host it was extracted from, as WHOLE WORDS, ignoring case,
 * and the search must come back empty. Key-column names, ids and copy reach
 * the package as host config; its own source names none of them.
 *
 * The words are spelled in pieces here, and this file skips itself, so the
 * list of what is forbidden is not itself a finding.
 */

function forbiddenWords(): string[] {
  return [
  ['lo', 'ja'],
  ['sto', 're'],
  ['ped', 'ido'],
  ['card', 'ápio'],
  ['card', 'apio'],
  ['client', '_id'],
  ['future', ' pay'],
  ['pala', 'dira'],
].map((parts) => parts.join(''));
}

/**
 * `\b` is ASCII-only in JavaScript, so a word ending in an accented letter
 * would never meet it. Letters, digits and `_` on either side mean "inside a
 * longer word"; anything else is a boundary.
 */
function wholeWord(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
}

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('the domain-agnostic rule', () => {
  it('matches whole words in any case, and nothing inside a longer word', () => {
    const forbidden = forbiddenWords();
    const word = forbidden[1] as string;
    expect(wholeWord(word).test(word.toUpperCase())).toBe(true);
    expect(wholeWord(word).test(`the ${word}'s row`)).toBe(true);
    for (const innocent of ['restore', 'stored', 'restored', '@12-apps/storage', 'storage', 'datastore']) {
      expect(wholeWord(word).test(innocent)).toBe(false);
    }
    expect(wholeWord(forbidden[3] as string).test(`o ${forbidden[3]}.`)).toBe(true);
    expect(wholeWord(forbidden[3] as string).test(`${forbidden[3]}s`)).toBe(false);
  });

  it('finds none of the host vocabulary anywhere under src/', () => {
    const files = sourceFiles(SRC).filter((path) => path !== SELF);
    expect(files.length).toBeGreaterThan(5);
    const findings = files.flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return forbiddenWords().filter((word) => wholeWord(word).test(text)).map(
        (word) => `${relative(SRC, path)}: ${word}`,
      );
    });
    expect(findings).toEqual([]);
  });
});
