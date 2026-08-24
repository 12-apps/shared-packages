import type { OnboardingMessages } from './context';
import { EN_US_ONBOARDING_MESSAGES, EN_US_ONBOARDING_UNAUTHENTICATED } from './en-US';
import { PT_BR_ONBOARDING_MESSAGES, PT_BR_ONBOARDING_UNAUTHENTICATED } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `LocalePack` is mirrored here rather than imported: this package must stay
 * liftable into a repo that has never heard of `@12-apps/i18n`, and the mirror
 * buys the same key-checking for one line.
 *
 * The 401 body gets its OWN pack rather than being folded into the messages
 * object, because that is how the package already exports it: it is answered by
 * the mounted router before any context exists, so it cannot travel with the
 * config the context carries.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const ONBOARDING_MESSAGES = {
  'pt-BR': PT_BR_ONBOARDING_MESSAGES,
  'en-US': EN_US_ONBOARDING_MESSAGES,
} as const satisfies LocalePack<OnboardingMessages>;

export const ONBOARDING_UNAUTHENTICATED = {
  'pt-BR': PT_BR_ONBOARDING_UNAUTHENTICATED,
  'en-US': EN_US_ONBOARDING_UNAUTHENTICATED,
} as const satisfies LocalePack<string>;
