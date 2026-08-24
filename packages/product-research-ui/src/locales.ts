import { EN_US_RESEARCH_MESSAGES } from './en-US';
import type { ResearchMessages } from './messages';
import { PT_BR_RESEARCH_MESSAGES } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const RESEARCH_MESSAGES = {
  'pt-BR': PT_BR_RESEARCH_MESSAGES,
  'en-US': EN_US_RESEARCH_MESSAGES,
} as const satisfies LocalePack<ResearchMessages>;
