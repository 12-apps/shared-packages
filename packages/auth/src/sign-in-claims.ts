/**
 * Claims a host stamps into the session token ONCE, at sign-in (FUT-3906).
 *
 * Whatever a request needs to know about the person and cannot change without
 * a new sign-in — the host's own user id, say — read from the token instead of
 * a database on every request. Values are strings: the token is a cookie, and
 * a claim is an identifier, not a cache of the host's data. Data that changes
 * while the person stays signed in (their roles, their reach) belongs in the
 * host's own store, keyed by such a claim.
 */
export type SignInClaims = (params: {
  email: string;
  provider: string | null;
}) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;

/** The claims a token carries; anything that is not a string map reads as none. */
export function tokenClaims(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
