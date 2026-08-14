/**
 * The two failures this package raises, kept apart because they are fixed by
 * different people at different times.
 *
 * A {@link StockDomainConfigError} is a WIRING bug: the host declared a
 * vocabulary that cannot be used safely, and the only fix is an edit to the
 * host's assembly code. It is thrown once, at assembly, at boot — never on a
 * request — so an adopter who boots the app has already found it.
 *
 * A {@link StockValueError} is a DATA failure: some untrusted string — a form
 * field, a query parameter, a column — is not in the vocabulary. It happens per
 * request, and a host translates it into whatever a rejected input means on
 * that surface (a 422, typically).
 *
 * Collapsing them into one class is the thing that makes the second look like
 * the first: a request-time throw with a config-shaped message reads like an
 * outage in the logs, and the deploy-time one reads like a user typo.
 */

/**
 * The host declared something this package cannot honour.
 *
 * `path` names the spec field, so an adopter is told which key to edit rather
 * than being handed a sentence to search their assembly code for.
 */
export class StockDomainConfigError extends Error {
  /**
   * The spec field at fault. One of `name`, `kinds`, `categories`,
   * `categoryAppliesTo`, or — once an axis has a label to be named by —
   * `<axis name>.values` / `<axis name>.fallback`, e.g.
   * `movement direction.values`.
   */
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'StockDomainConfigError';
    this.path = path;
  }
}

/** An untrusted value is not in the vocabulary it was checked against. */
export class StockValueError extends Error {
  /** The vocabulary that refused it, by the name the host gave that axis. */
  readonly vocabulary: string;

  /** What was actually received — kept unknown, and never interpolated raw. */
  readonly received: unknown;

  constructor(vocabulary: string, received: unknown) {
    super(`${vocabulary}: ${describe(received)} is not one of its values.`);
    this.name = 'StockValueError';
    this.vocabulary = vocabulary;
    this.received = received;
  }
}

/**
 * A short, quotable rendering of an untrusted value for an error message.
 *
 * Strings are quoted and TRUNCATED: the value reaching `parse` comes from a
 * request body, so an unbounded interpolation puts caller-controlled bytes of
 * arbitrary length into a log line. Everything else is reported by type only —
 * an object's contents are not this package's to print.
 */
function describe(value: unknown): string {
  if (typeof value !== 'string') return `a ${value === null ? 'null' : typeof value}`;
  return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
}
