/**
 * The caller's own `aria-describedby` (a hint, say), with the error message's
 * id after it while the field shows one. The error is how a screen reader
 * learns WHY the field is invalid; `aria-invalid` alone only says that it is.
 */
export function describedByWith(callerIds: unknown, messageId: string | undefined): string | undefined {
  const ids = [typeof callerIds === 'string' ? callerIds.trim() : '', messageId ?? ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}
