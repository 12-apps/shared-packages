/**
 * Minimal `Result` shape for the browser payment surfaces. Lives in this
 * package (moved from `@12-apps/spa-shared` with the checkout, FUT-564) so the
 * portable frontend never reaches back into a repo-specific package for a
 * ten-line type.
 */
export type Result<T> =
  | { ok: true; data: T }
  /**
   * `code` is the API envelope's machine code, when the failure came from one
   * (`PAYMENT_UNRESOLVED`, `GATEWAY_UNAVAILABLE`, …). Optional because a
   * browser-side failure — a tokenizer bail, a dropped connection — has none.
   * The MESSAGE is what the buyer reads; the code is what the surface uses to
   * decide how to PRESENT it, which a message cannot be parsed for.
   */
  | { ok: false; error: string; code?: string };

export const ok = <T,>(data: T): Result<T> => ({ ok: true, data });

export const err = <T,>(error: string, code?: string): Result<T> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
});
