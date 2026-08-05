import type { ProviderRegistry } from '../core/registry';

/**
 * The activation charge's identity (FUT-463) — pure helpers, no I/O.
 *
 * One reference format for both verification phases, so the poll can find
 * what the start minted. Deliberately NOT the order reference format: this is
 * not a sale and must never be mistaken for one in a provider dashboard or a
 * reconciliation.
 */

/** One cent. Small enough to be a rounding error, real enough to prove it. */
const VERIFY_AMOUNT_CENTS = 1;

/**
 * What to charge to prove THIS provider works, and what to tell the owner.
 *
 * One cent, raised to the adapter's own declared floor: the smallest total a
 * provider will actually accept is a fact about ITS API — typically learned
 * from its refusals, which is why the descriptor owns it
 * (`minimumChargeCents`) rather than a host-side table that would drift the
 * moment another vendor disagrees. A floor above a cent is more than a token,
 * so screens must name the real figure everywhere it appears rather than
 * promising a cent — the owner is paying their own account either way.
 */
export function verificationAmountCents(providers: ProviderRegistry, provider: string): number {
  const floor = providers.has(provider) ? providers.get(provider).minimumChargeCents : undefined;
  return Math.max(VERIFY_AMOUNT_CENTS, floor ?? 0);
}

/**
 * One reference for both phases: `verify-<provider>-<merchantId>`, with an
 * optional `--<attempt>` suffix (FUT-679/FUT-541 — the adapters fall back to
 * the reference as the provider idempotency key, and both PagBank and
 * InfinitePay dedupe on it, so a constant reference replayed the FIRST
 * attempt's answer onto every retry).
 */
export function verificationReference(
  provider: string,
  merchantId: string,
  attempt?: string,
): string {
  const base = `verify-${provider}-${merchantId}`;
  return attempt ? `${base}--${attempt}` : base;
}

/** Unique per attempt, and opaque — it only has to differ from last time. */
export const verificationAttemptId = (): string => Date.now().toString(36);

/**
 * Does this reference belong to THIS merchant's connection?
 *
 * The reference used to be constant, and that froze the checkout link:
 * InfinitePay dedupes on `order_nsu`, so every later attempt was handed the
 * FIRST link ever minted — including the `redirect_url` baked into it when it
 * was created. So an attempt id may be appended after `--`, and everything
 * that used to compare for equality asks this instead. It is still a
 * derivation check, not a trust-the-caller: the prefix is rebuilt from the
 * config's own identity (FUT-463), so a reference naming another merchant or
 * another provider is refused exactly as before.
 */
export function ownsVerificationReference(
  reference: string,
  provider: string,
  merchantId: string,
): boolean {
  const base = verificationReference(provider, merchantId);
  return reference === base || reference.startsWith(`${base}--`);
}

/** The identity inside a reference, attempt suffix removed. Null when it is
 * not an activation reference at all. */
export function parseVerificationReference(
  reference: string,
): { provider: string; merchantId: string } | null {
  const match = /^verify-([^-]+)-(.+)$/.exec(reference);
  const provider = match?.[1];
  const rest = match?.[2];
  if (!provider || !rest) return null;
  return { provider, merchantId: rest.split('--')[0] ?? rest };
}
