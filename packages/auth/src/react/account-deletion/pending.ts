/**
 * The pending deletion a session answer carries, if any (FUT-5322).
 *
 * Its own module, because a host's shell reads it on every page: beside the
 * screens it would carry their form fields onto the first paint.
 */
export function pendingDeletionOf(session: unknown): { purgeAt: string } | null {
  const deletion = (session as { deletion?: { purgeAt?: unknown } } | null)?.deletion;
  return deletion && typeof deletion.purgeAt === "string" ? { purgeAt: deletion.purgeAt } : null;
}
