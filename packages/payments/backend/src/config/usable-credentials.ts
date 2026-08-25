import type { PaymentProviderAdapter } from '../core/provider';
import { credentialSchemaOf } from '../core/provider';

/**
 * Whether a stored credential set is actually USABLE for its adapter — not
 * merely non-empty (ported from the first adopting host, FUT-761).
 *
 * Two ways "non-empty" lies: a host-stamped extra field (a `notificationUrl`
 * that belongs to no schema) survives a CLEARED token, and a set holding a
 * token but missing a required sibling raises charges nothing can confirm.
 * Reading the adapter's own `credentialSchema` keeps the answer honest as
 * providers gain fields — the alternative is a table of key names kept by
 * hand, which is only ever wrong silently. A provider that declares nothing
 * required (an OAuth connection, say) still has to carry SOMETHING, or an
 * empty row would read as ready to charge.
 */
export function hasUsableCredentials(
  adapter: PaymentProviderAdapter,
  fields: Record<string, string> | undefined,
): boolean {
  const present = (key: string): boolean => {
    const value = fields?.[key];
    return typeof value === 'string' && value !== '';
  };
  const required = credentialSchemaOf(adapter).filter((spec) => spec.required);
  return required.length > 0
    ? required.every((spec) => present(spec.key))
    : credentialSchemaOf(adapter).some((spec) => present(spec.key));
}
