import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pagbankApiBase } from '../providers/pagbank-api-base';

/**
 * PagBank's Orders API hosts, and the property that they are spelled ONCE
 * (FUT-760).
 *
 * The literals were written out five times inside this package and a sixth
 * time in the first adopting host. Every copy agreed, which is exactly why
 * nothing noticed: a duplicate only bites the day one of them changes, and by
 * then the wrong charge has already gone to the wrong host.
 */

const SRC = join(__dirname, '..');

/** Every `.ts` under `src`, excluding this suite's own directory. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('pagbankApiBase', () => {
  it('answers PagBank production for PRODUCTION', () => {
    expect(pagbankApiBase('PRODUCTION')).toBe('https://api.pagseguro.com');
  });

  it('answers sandbox for SANDBOX', () => {
    expect(pagbankApiBase('SANDBOX')).toBe('https://sandbox.api.pagseguro.com');
  });

  /**
   * THE POINT OF THE MODULE, pinned rather than trusted.
   *
   * A new copy of either literal is how the five-way duplication came back
   * last time — each one added in good faith, in a module that had no reason
   * to import a peer. This fails on the copy rather than on the divergence it
   * eventually causes.
   *
   * Note the assertion is about the SOURCE, so a comment naming the host in
   * prose (which several modules do, legitimately) has to be written without
   * the bare literal — quoting a URL in a docstring is how a "documentation
   * only" copy becomes a real one after a careless refactor.
   */
  it('is the only place either host is written', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith(join('providers', 'pagbank-api-base.ts')))
      .filter((path) => /https:\/\/(sandbox\.)?api\.pagseguro\.com/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
