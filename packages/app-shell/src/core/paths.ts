/**
 * Trailing-slash normalisation, in linear time.
 *
 * ## Why this is not `replace(/\/+$/, '')`
 *
 * That expression is **polynomial ReDoS** (`js/polynomial-redos`, CodeQL alerts 36
 * and 37 on this package's first push), and the reason is the ANCHOR rather than the
 * quantifier. On a string whose slash run is followed by anything else, `+` matches
 * the whole run, `$` then fails, and the engine backtracks through every length of
 * the run — and repeats that from every starting position inside it. Measured here,
 * on `'/'.repeat(n) + 'x'`:
 *
 * | n | `replace(/\/+$/, '')` | this function |
 * |---|---|---|
 * | 20 000 | 647 ms | 0.08 ms |
 * | 40 000 | 2 243 ms | 0.01 ms |
 * | 80 000 | 9 423 ms | 0.01 ms |
 * | 160 000 | 37 051 ms | 0.01 ms |
 *
 * Four times the time for twice the input, which is the signature. Note what is NOT
 * pathological: a string ENDING in the slash run (`'/api' + '/'.repeat(160000)`) is
 * 0.3 ms even with the regex, because the first attempt succeeds and nothing
 * backtracks. A regression test built on that shape would prove nothing — it is the
 * mistake a previous round in this series made, so the fixtures in
 * `__tests__/paths.test.ts` are the tail-bearing kind.
 *
 * The fix is a single backward scan. No quantifier, no anchor, no backtracking, and
 * nothing to tune: neither a timeout nor an input-length cap, both of which leave the
 * quadratic in place and merely move where it hurts.
 *
 * ## It must remain byte-identical to the expression it replaces
 *
 * These functions decide the URL a request is sent to and the path a consent gate
 * compares against, so a one-character drift either points a call somewhere else or
 * silently stops suppressing a dialog on the page it is about. The differential
 * table in `__tests__/paths.test.ts` pins the two implementations against each other
 * over trailing, duplicated and embedded runs, `host:port`, a real callback URL,
 * whitespace padding, the empty string, newline cases and the slash LOOK-ALIKES.
 *
 * Two subtleties the walk inherits deliberately:
 *
 *  - **Only U+002F counts.** `／` (U+FF0F FULLWIDTH SOLIDUS) and `∕` (U+2215 DIVISION
 *    SLASH) are ordinary characters to `\/`, and they stay ordinary characters here.
 *    A path ending in one keeps it.
 *  - **A trailing newline is not an end.** ECMAScript's `$` without the `m` flag
 *    matches at end of input only — it does not match before a final `\n` the way
 *    Perl's does — so `'a/\n'` is untouched by both, and `charCodeAt` agrees for
 *    free.
 */

/** U+002F SOLIDUS. The only character either implementation strips. */
const SOLIDUS = 47;

/**
 * `value` with every trailing `/` removed.
 *
 * Returns the SAME string object when there is nothing to strip, which is the common
 * case for a configured mount like `/api`.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SOLIDUS) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Join a mount base with a surface-relative path, without doubling the slash.
 *
 * Small, and shared on purpose: the browser half and the wire module both build URLs
 * off the host's `apiBase`, and two spellings of "does the base end in a slash" is how
 * a surface starts answering 404 for one of them.
 */
export function joinApiPath(base: string, path: string): string {
  const trimmedBase = stripTrailingSlashes(base);
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
