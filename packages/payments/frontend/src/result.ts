/**
 * Minimal `Result` shape for the browser payment surfaces. Lives in this
 * package (moved from `@12-apps/spa-shared` with the checkout, FUT-564) so the
 * portable frontend never reaches back into a repo-specific package for a
 * ten-line type.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T,>(data: T): Result<T> => ({ ok: true, data });

export const err = <T,>(error: string): Result<T> => ({ ok: false, error });
