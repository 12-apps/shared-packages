/**
 * What a caller may say about ONE `gateway.refreshCharge` (FUT-4268). The
 * buyer's status poll passes nothing and behaves as it always has; the
 * pending-charge sweep passes both.
 */
export interface RefreshOptions {
  /** The caller's deadline. The call is abandoned (and its socket destroyed) when it fires. */
  signal?: AbortSignal;
  /**
   * How a failure with NO HTTP answer (a transport error, or `signal` firing)
   * is reported. Unset: as before (a provider-failure report). `quiet`: not
   * reported at all — the caller retries on its next tick and logs it itself.
   * `final`: reported once, under its own path, because the caller will not
   * ask about this charge again.
   */
  transport?: 'quiet' | 'final';
}

/**
 * Per-call options of a read-only provider call (FUT-4268). `signal` is a
 * deadline the caller owns: an adapter that can pass it to its HTTP call does,
 * so the socket is destroyed with it. One that cannot simply ignores it — the
 * caller's own race still frees it.
 */
export interface ProviderReadOptions {
  signal?: AbortSignal;
}
