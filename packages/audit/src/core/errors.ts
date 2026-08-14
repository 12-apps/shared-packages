/**
 * The two failures this package raises, kept apart because they are found by
 * different people at different times.
 *
 * An {@link AuditConfigError} is a WIRING bug: the host declared a vocabulary,
 * a retention window or a page size that cannot be used safely. It is thrown
 * once, at ASSEMBLY, at boot — never on a request — so an adopter who starts
 * the process has already found it.
 *
 * An {@link AuditVocabularyError} is a DATA failure: a write named an action or
 * a resource type the vocabulary does not declare. It happens per mutation,
 * inside the caller's transaction, so the mutation it described rolls back with
 * it.
 *
 * Collapsing them into one class is what makes the second look like the first:
 * a request-time throw with a config-shaped message reads like an outage in the
 * logs, and the boot-time one reads like a caller's typo.
 */

/**
 * The host declared something this package cannot honour.
 *
 * `path` names the spec field, so an adopter is told which key to edit rather
 * than being handed a sentence to search their assembly code for.
 */
export class AuditConfigError extends Error {
  /**
   * The spec field at fault — `actions`, `resources`, `retention.floorDays`,
   * `pagination.maxPageSize`, or a nested position such as
   * `resources["post"].fields`.
   */
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'AuditConfigError';
    this.path = path;
    Object.setPrototypeOf(this, AuditConfigError.prototype);
  }
}

/** Thrown when a write names an action or resource the vocabulary lacks. */
export class AuditVocabularyError extends Error {
  /** Which axis refused it. */
  readonly kind: 'action' | 'resourceType';

  /** What was actually received — kept `unknown`, never interpolated raw. */
  readonly received: unknown;

  constructor(kind: 'action' | 'resourceType', value: unknown) {
    super(
      `Unknown audit ${kind} ${describe(value)}. Declare it in the vocabulary ` +
        'passed to defineAuditVocabulary — an unknown value cannot be redacted, ' +
        'filtered or labelled.',
    );
    this.name = 'AuditVocabularyError';
    this.kind = kind;
    this.received = value;
    Object.setPrototypeOf(this, AuditVocabularyError.prototype);
  }
}

/**
 * A short, quotable rendering of an untrusted value for an error message.
 *
 * Strings are quoted and TRUNCATED: the value reaching a writer comes from
 * caller code that may have read it off a request body, so an unbounded
 * interpolation puts arbitrary bytes into a log line. Everything else is
 * reported by type only — an object's contents are not this package's to print.
 */
export function describe(value: unknown): string {
  if (typeof value !== 'string') return `a ${value === null ? 'null' : typeof value}`;
  return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
}
