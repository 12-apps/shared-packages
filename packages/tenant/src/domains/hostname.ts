/**
 * Hostname grammar for a tenant's custom domain: lowercase labels, at least
 * one dot, no scheme, no path, no port, no trailing dot, no wildcard.
 *
 * Deliberately strict: this string is concatenated into DNS lookups and
 * compared against a TLS SNI value, so anything exotic is rejected at the door
 * rather than normalised into something surprising.
 */
const HOSTNAME_RE = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** What a person pastes (case, a scheme, a path, a trailing dot) reduced to the bare name. */
function stripped(raw: string): string {
  const noScheme = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  // Everything from the first slash on is a path. A cut, not a `/\/.*$/`
  // replace, which backtracks polynomially on a run of slashes (CodeQL).
  const slash = noScheme.indexOf('/');
  const host = slash === -1 ? noScheme : noScheme.slice(0, slash);
  return host.replace(/\.$/, '');
}

/** The input reduced to the stored hostname, or null when it is not one. */
export function hostnameOrNull(raw: string): string | null {
  const host = stripped(raw);
  return HOSTNAME_RE.test(host) ? host : null;
}

/**
 * The hostname a draft in a form would claim, or null: the server's own
 * reading (scheme, path and case dropped), with a looser grammar, because it
 * only decides whether a preview of the claim is worth showing.
 */
export function draftHostname(raw: string): string | null {
  const host = stripped(raw);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}
