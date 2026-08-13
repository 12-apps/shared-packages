/**
 * The upload ceiling, and the one rule about it: there is exactly ONE number.
 *
 * A cap that differed by entrance would mean a file the app accepts from a
 * browser and refuses from an agent, for no reason the person uploading could
 * see. So this module owns the number and everything derived from it, and
 * {@link createApiStorage} takes `maxBytes` as a REQUIRED config value rather
 * than defaulting quietly — a permissive default is the failure that cannot be
 * noticed from inside the host that has it.
 *
 * {@link DEFAULT_MAX_UPLOAD_BYTES} is the recommended value, exported so a host
 * can hand the SAME constant to its upload mount and to any tool schema that
 * advertises the ceiling. That is the anti-drift seam the extraction exists for:
 * `createApiStorage(…).limits` echoes back what the mount actually enforces, so
 * a schema built from it cannot describe a limit the endpoint does not have.
 */

/** The recommended upload cap: 8 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling for a base64-encoded field carrying `maxBytes` of file.
 *
 * 4 characters carry 3 bytes, plus room for a `data:` URL wrapper and for line
 * wrapping. Used as a schema `max`, so an oversize payload is refused by
 * validation before a handler ever allocates it.
 */
export function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024;
}

/** `8 MB`, `1,5 MB` — pt-BR decimal comma, for a message a store owner reads. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  const rendered = Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace('.', ',');
  return `${rendered} MB`;
}
