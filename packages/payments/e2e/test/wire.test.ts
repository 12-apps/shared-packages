import { describe, expect, it } from 'vitest';

import { noWrites, onlyReads } from '../src/helpers/wire.js';

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

describe('noWrites', () => {
  it('finds no write in an empty probe or a placeholder (liveness is checked apart)', () => {
    expect(noWrites('')).toBe(true);
    expect(noWrites('(none)')).toBe(true);
  });

  it('accepts reads, with or without the config read', () => {
    expect(noWrites('GET /api/checkout/cards')).toBe(true);
    expect(noWrites('GET /api/checkout/config\nGET /api/checkout/cards')).toBe(true);
  });

  it('refuses any write', () => {
    expect(noWrites('POST /api/checkout')).toBe(false);
    expect(noWrites('GET /api/checkout/config,POST /api/checkout/charge')).toBe(false);
    expect(noWrites('GET /api/checkout/heartbeat\nPUT /api/checkout/x')).toBe(false);
  });

  it('counts a writing verb as a write whatever follows it', () => {
    expect(noWrites('POST')).toBe(false);
    expect(noWrites('POST /a b')).toBe(false);
    expect(noWrites('POST /x extra')).toBe(false);
    expect(noWrites('GET /api/checkout/config,DELETE')).toBe(false);
  });
});
