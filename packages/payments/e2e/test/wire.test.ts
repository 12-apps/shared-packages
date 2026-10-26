import { describe, expect, it } from 'vitest';

import { onlyReads } from '../src/helpers/wire.js';

describe('onlyReads', () => {
  it('accepts the config read alone', () => {
    expect(onlyReads('GET /api/checkout/config')).toBe(true);
  });

  it('accepts several reads, comma- or newline-separated', () => {
    expect(onlyReads('GET /api/checkout/cards,GET /api/checkout/config')).toBe(true);
    expect(onlyReads('GET /api/checkout/config\nGET /api/checkout/cards\n')).toBe(true);
  });

  it('refuses a write anywhere in the list', () => {
    expect(onlyReads('GET /api/checkout/config,POST /api/checkout')).toBe(false);
    expect(onlyReads('POST /api/checkout\nGET /api/checkout/config')).toBe(false);
  });

  it('refuses an empty probe and a malformed entry', () => {
    expect(onlyReads('')).toBe(false);
    expect(onlyReads('GET')).toBe(false);
    expect(onlyReads('GET /a /b')).toBe(false);
    expect(onlyReads('GET /a\tGET /b')).toBe(false);
  });

  // The input CodeQL showed the old single pattern backtracking on. A pattern
  // that backtracks exponentially never returns at this length, so the test
  // timeout is the bound; a linear parse answers in milliseconds.
  it('answers on the input that made the old pattern backtrack', () => {
    const hostile = `GET !\tGET ${'!,\tGET '.repeat(50_000)}`;
    expect(onlyReads(hostile)).toBe(false);
  });
});
