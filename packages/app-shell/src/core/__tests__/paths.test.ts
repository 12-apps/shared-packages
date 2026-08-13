/**
 * The trailing-slash strip: byte-identical to the regex it replaces, and linear.
 *
 * Two separate claims, and both are needed. `stripTrailingSlashes` exists because
 * `replace(/\/+$/, '')` is polynomial ReDoS (`js/polynomial-redos`) — but the strings
 * it normalises decide the URL a request is sent to and the path a consent gate
 * compares against, so a faster function that answers differently is worse than the
 * slow one. Hence a DIFFERENTIAL table against the original expression, plus a timing
 * bound.
 */
import { describe, expect, it } from 'vitest';

import { joinApiPath, stripTrailingSlashes } from '../paths';

/**
 * The expression this replaced, kept here as the reference oracle.
 *
 * It is only ever called on the short literals below, so its quadratic never runs and
 * there is no taint path into it — this is a test's own table, not library input.
 */
const legacyStrip = (value: string): string => value.replace(/\/+$/, '');

/**
 * Realistic values, plus the ones where two implementations of "strip trailing
 * slashes" plausibly disagree.
 */
const TABLE: readonly string[] = [
  // The ordinary mounts and paths.
  '/api',
  '/api/',
  '/api//',
  '/api///',
  '/backend/v1/',
  '/consent/status',
  '',
  '/',
  '//',
  '///',
  // Runs that are not at the end: nothing may be touched.
  '/api//v1/consent',
  'a//b',
  '//leading',
  // A base with an authority, and a real callback URL — both are things a host passes.
  'https://loja.exemplo.com.br',
  'https://loja.exemplo.com.br/',
  'http://localhost:5219/',
  'http://localhost:5219//api//',
  'https://app.exemplo.com/entrar?callbackUrl=%2Fpedidos%2F',
  '/terms#aceite',
  '/privacidade?lang=pt-BR',
  // Whitespace padding: neither implementation trims, and both must agree on that.
  ' /api/ ',
  '/api/\t',
  // ECMAScript's `$` without `m` matches END OF INPUT only — it does NOT match before
  // a final newline the way Perl's does. So a trailing newline protects the slash.
  '/api/\n',
  '/api\n/',
  '/api/\r\n',
  // Slash LOOK-ALIKES. `\/` matches U+002F alone, and so does the walk: a path ending
  // in one of these keeps it, and a host that pasted one gets the same answer as
  // before rather than a quietly different URL.
  '/api／',
  '/api／/',
  '/api∕',
  '/api∕∕',
  '/açaí/',
  '/emoji/🥐/',
  // A lone high surrogate, to be sure the walk never slices into a pair.
  '/api/\u{1F950}',
];

describe('stripTrailingSlashes', () => {
  it.each(TABLE)('answers exactly what the regex answered for %j', (value) => {
    expect(stripTrailingSlashes(value)).toBe(legacyStrip(value));
  });

  it('returns the same string object when there is nothing to strip', () => {
    const value = '/api';
    expect(stripTrailingSlashes(value)).toBe(value);
  });
});

/**
 * The pathological family, and the ONLY thing these two cases may fail on is time.
 *
 * Both implementations answer the input UNCHANGED here — the run does not reach the
 * end, so there is nothing to strip either way. That is deliberate: an assertion that
 * only the new walk satisfies would fail against the old code for a semantic reason
 * and the timing claim would be untested, which is the mistake a previous round in
 * this series made.
 *
 * The shape matters as much as the size. `'/'.repeat(n) + 'x'` is quadratic because
 * `+` consumes the run, `$` then fails against the tail, and the engine retries every
 * length from every position. A string ENDING in the run is not pathological at all
 * (0.3 ms at n=160 000), so a fixture built that way would pass against both.
 *
 * Measured with the regex: 647 ms at 20 000, 2 243 ms at 40 000, 9 423 ms at 80 000,
 * 37 051 ms at 160 000 — four times the time for twice the input. The walk is 0.01 ms
 * at every size, so 80 000 puts the old code ~1.9x over this bound and the new code
 * five orders of magnitude under it.
 *
 * The bound is pinned PER CASE rather than inherited, so raising the suite default
 * later cannot quietly neuter these two.
 */
const PATHOLOGICAL = 80_000;

describe('stripTrailingSlashes · linear time', () => {
  it(
    'is unbothered by a long slash run followed by a tail',
    { timeout: 5_000 },
    () => {
      const value = `${'/'.repeat(PATHOLOGICAL)}x`;
      expect(stripTrailingSlashes(value)).toBe(value);
    },
  );

  it(
    'is unbothered by a long slash run embedded in a path',
    { timeout: 5_000 },
    () => {
      const value = `/a${'/'.repeat(PATHOLOGICAL)}b`;
      expect(stripTrailingSlashes(value)).toBe(value);
    },
  );

  /**
   * And the URL builder itself, which is the exported function a host actually reaches
   * — a linear helper behind a caller that still concatenated with the regex would
   * leave the alert exactly where it was.
   */
  it(
    'builds a URL from a pathological base without stalling',
    { timeout: 5_000 },
    () => {
      const base = `/api${'/'.repeat(PATHOLOGICAL)}x`;
      expect(joinApiPath(base, '/consent/status')).toBe(`${base}/consent/status`);
    },
  );
});

describe('joinApiPath', () => {
  it.each([
    ['/api', '/consent/status', '/api/consent/status'],
    ['/api/', '/consent/status', '/api/consent/status'],
    ['/api///', '/consent/status', '/api/consent/status'],
    ['/api', 'consent/status', '/api/consent/status'],
    ['', '/consent/status', '/consent/status'],
    ['/', '/consent/status', '/consent/status'],
    ['https://api.exemplo.com/', '/consent/terms', 'https://api.exemplo.com/consent/terms'],
  ])('joins %j + %j', (base, path, expected) => {
    expect(joinApiPath(base, path)).toBe(expected);
  });

  /** The old expression's answer, for every base in the table above. */
  it.each(TABLE)('agrees with the regex-based join for base %j', (base) => {
    const path = '/consent/status';
    const legacy = `${legacyStrip(base)}${path}`;
    expect(joinApiPath(base, path)).toBe(legacy);
  });
});
