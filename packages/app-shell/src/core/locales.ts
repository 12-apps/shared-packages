import { EN_US_REST_RESULT_FALLBACKS } from './en-US';
import { PT_BR_REST_RESULT_FALLBACKS } from './pt-BR';
import type { RestResultFallbacks } from './rest-result';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 * `LocalePack` is mirrored rather than imported, so the package stays liftable
 * into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const REST_RESULT_FALLBACKS = {
  'pt-BR': PT_BR_REST_RESULT_FALLBACKS,
  'en-US': EN_US_REST_RESULT_FALLBACKS,
} as const satisfies LocalePack<RestResultFallbacks>;
