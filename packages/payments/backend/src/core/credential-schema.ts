import { resolvePaymentsCopy } from '../copy-source';

import type { CredentialFieldSpec } from './types';
import type { PaymentProviderAdapter } from './provider';

/**
 * This adapter's credential form, in the language the caller is being answered.
 *
 * Every reader of `credentialSchema` goes through here — seven of them, and
 * only ONE (`config/service.ts`, which ships the form to the browser) actually
 * reads the labels; the rest read `key`, `required`, `role` and `secret`.
 * Those six pass no locale and get the adapter's configured words, which is
 * correct: a structural question has no reader.
 *
 * Its own module rather than a function in `core/provider.ts`, which is a
 * type-heavy contract file already at the 400-line ceiling — so the accessor
 * would have had to be paid for by deleting rationale from the contract it
 * exists to explain.
 */
export function credentialSchemaOf(
  adapter: Pick<PaymentProviderAdapter, 'credentialSchema'>,
  locale?: string,
): readonly CredentialFieldSpec[] {
  return resolvePaymentsCopy(adapter.credentialSchema, locale);
}
