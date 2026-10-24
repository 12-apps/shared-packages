/**
 * A component's labels: the caller's `labels` laid over the pack's defaults,
 * key by key, ignoring keys the caller left `undefined` (FUT-3860).
 *
 * `Partial<T>` is what keeps a new key non-breaking: every label prop is
 * optional, and the English pack answers for whatever a caller does not name.
 */
export function resolveLabels<T extends object>(defaults: T, overrides?: Partial<T>): T {
  if (!overrides) return defaults;
  const defined = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return { ...defaults, ...Object.fromEntries(defined) } as T;
}
