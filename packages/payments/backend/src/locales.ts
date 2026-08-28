import { EN_US_ACTIVATION_COPY } from './activation/en-US';
import type { ActivationCopy } from './activation/copy';
import { PT_BR_ACTIVATION_COPY } from './activation/pt-BR';
import type { ConnectApplicationCopy } from './platform/connect-application';
import { EN_US_CONNECT_APPLICATION_COPY } from './platform/en-US';
import { PT_BR_CONNECT_APPLICATION_COPY } from './platform/pt-BR';
import type { CheckoutCopy } from './checkout/copy';
import { EN_US_CHECKOUT_COPY } from './checkout/copy-en-US';
import { PT_BR_CHECKOUT_COPY } from './checkout/copy-pt-BR';
import type { ProviderCopyPacks } from './providers/copy';
import { EN_US_PROVIDER_COPY } from './providers/en-US';
import { PT_BR_PROVIDER_COPY } from './providers/pt-BR';

/**
 * Every surface this half renders, in both languages, keyed by tag — what a
 * host hands to `@12-apps/i18n` when the reader's language is a property of
 * the request rather than of the deployment.
 *
 * `LocalePack` is declared here rather than imported, and in THIS package that
 * is not merely a preference: `payments/no-host-imports` forbids
 * `packages/payments/**` from importing a sibling workspace package at all, so
 * the mirror is the only shape available. It gives the same key-checking, and
 * `scripts/locale-coverage-gate.mjs` is what keeps it agreeing with the
 * canonical list.
 *
 * `PT_BR_HOMOLOGACAO_ANSWERS` has no entry here and no English twin. It is a
 * SUBMISSION to PagBank's own Portuguese form, several of whose fields are
 * multiple-choice options — see `platform/en-US.ts`, which sets out why an
 * English "translation" of it would be a pack that looks adoptable and cannot
 * be submitted.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const ACTIVATION_COPY = {
  'pt-BR': PT_BR_ACTIVATION_COPY,
  'en-US': EN_US_ACTIVATION_COPY,
} as const satisfies LocalePack<ActivationCopy>;

/**
 * The buyer's whole refusal vocabulary (FUT-764).
 *
 * A pack, not the DEFAULT this package deleted in FUT-740: `CheckoutCopy` is
 * still required and `checkoutRefusalFor` reads nothing from here. The full
 * argument, and the two keys a host answers for itself, are in
 * `./checkout/copy-pt-BR.ts`.
 */
export const CHECKOUT_COPY = {
  'pt-BR': PT_BR_CHECKOUT_COPY,
  'en-US': EN_US_CHECKOUT_COPY,
} as const satisfies LocalePack<CheckoutCopy>;

export const CONNECT_APPLICATION_COPY = {
  'pt-BR': PT_BR_CONNECT_APPLICATION_COPY,
  'en-US': EN_US_CONNECT_APPLICATION_COPY,
} as const satisfies LocalePack<ConnectApplicationCopy>;

export const PROVIDER_COPY = {
  'pt-BR': PT_BR_PROVIDER_COPY,
  'en-US': EN_US_PROVIDER_COPY,
} as const satisfies LocalePack<ProviderCopyPacks>;

/**
 * ONE adapter's words as a pack, plucked across every language.
 *
 * {@link PROVIDER_COPY} pairs the whole BAG — `{ 'pt-BR': { pagbank, stone, … } }`
 * — but a factory takes one provider's copy, so what a host actually needs is
 * the transpose: `{ 'pt-BR': …pagbank, 'en-US': …pagbank }`. Without this, every
 * host builds that object inline, once per adapter, and the four copies grow a
 * fifth the day a fifth adapter lands.
 *
 * It lives here rather than in a host because the shape being transposed is
 * this package's: `ProviderCopyPacks` names the four keys, so a new adapter
 * gets a pack from the same `satisfies` that already refuses one without copy,
 * and no host is asked to notice.
 *
 * The result is what a `PaymentsCopySource` resolver reads — see
 * `src/copy-source.ts` for why the factories take a source rather than a value.
 */
export function providerCopyPack<K extends keyof ProviderCopyPacks>(
  provider: K,
): LocalePack<ProviderCopyPacks[K]> {
  return {
    'pt-BR': PT_BR_PROVIDER_COPY[provider],
    'en-US': EN_US_PROVIDER_COPY[provider],
  };
}
