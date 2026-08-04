/**
 * Admin allowlist helpers (FUT-9).
 *
 * Authorization model: there are no roles. Admin access is granted by an email
 * allowlist supplied via the `ADMIN_EMAILS` environment variable (a
 * comma-separated list). These helpers are intentionally dependency-free — they
 * import neither `@auth/core` nor any framework — so they can run unchanged in the Node
 * server, the Edge middleware, and unit tests without constructing a NextAuth
 * instance.
 */

/**
 * Parse a raw `ADMIN_EMAILS` value into a normalized allowlist.
 *
 * Entries are trimmed, lower-cased, and empty segments are dropped, so values
 * like `" Admin@Example.com , ,owner@example.com "` parse cleanly.
 */
export function parseAdminEmails(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/**
 * Determine whether `email` is on the admin allowlist.
 *
 * @param email The candidate email (typically `session.user.email`).
 * @param raw   The raw allowlist; defaults to `process.env.ADMIN_EMAILS` so
 *              runtime callers can omit it while tests pass it explicitly.
 * @returns `true` only when a non-empty allowlist contains the (normalized)
 *          email. An empty/missing allowlist or email yields `false` (deny).
 */
export function isAdminEmail(
  email?: string | null,
  raw: string | undefined | null = process.env.ADMIN_EMAILS,
): boolean {
  if (!email) return false;
  const allowlist = parseAdminEmails(raw);
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}
