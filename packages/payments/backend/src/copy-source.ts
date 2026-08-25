/**
 * The resolver shape every copy field in this package accepts.
 *
 * Declared here rather than imported from `@12-apps/i18n`, and in THIS package
 * that is not merely a preference: `payments/no-host-imports` forbids
 * `packages/payments/**` from importing a sibling workspace at all, so a
 * structural mirror is the only shape available. `src/locales.ts` declares its
 * own `LocalePack` for the same reason, and `scripts/locale-coverage-gate.mjs`
 * is what keeps both agreeing with the canonical list.
 *
 * The context is deliberately loose — a raw tag off the wire, unnarrowed —
 * because matching it is the host resolver's job, not this package's.
 */
export type PaymentsCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type PaymentsCopySource<T> = T | PaymentsCopyResolver<T>;

/**
 * The copy a field is offering, at the moment it is needed.
 *
 * An adapter is built ONCE, when a deployment names its providers, and then
 * serves every store and every buyer for the life of the process. So a value
 * read where `defineProviders` runs answers all of them in whichever language
 * that deployment started with — and a single-locale host cannot tell the
 * difference, which is what makes the mistake survive review.
 */
export function resolvePaymentsCopy<T>(
  source: PaymentsCopySource<T>,
  locale: string | undefined,
): T {
  return typeof source === 'function'
    ? (source as PaymentsCopyResolver<T>)({ locale })
    : source;
}
