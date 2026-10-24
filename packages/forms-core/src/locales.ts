import { EN_US_FORMS_MESSAGES } from './en-US';
import type { FormsMessages } from './messages';
import { PT_BR_FORMS_MESSAGES } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 * `LocalePack` is mirrored rather than imported, so the package stays liftable
 * into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const FORMS_MESSAGES = {
  'pt-BR': PT_BR_FORMS_MESSAGES,
  'en-US': EN_US_FORMS_MESSAGES,
} as const satisfies LocalePack<FormsMessages>;
