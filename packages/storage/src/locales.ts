import { EN_US_STORAGE_MESSAGES, EN_US_STORAGE_UNAUTHENTICATED } from './en-US';
import type { StorageMessageContext, StorageMessages } from './problems';
import { PT_BR_STORAGE_MESSAGES, PT_BR_STORAGE_UNAUTHENTICATED } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * The pack holds FACTORIES rather than tables, because that is what this
 * package's copy already is: `limit` is interpolated so a host that raises
 * `maxBytes` cannot end up with a message naming the old number. `localeCopy`
 * therefore hands back a factory, and the host calls it with its context:
 *
 * ```ts
 * const messages = localeCopy(STORAGE_MESSAGES)({ locale })({ limit });
 * ```
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const STORAGE_MESSAGES = {
  'pt-BR': PT_BR_STORAGE_MESSAGES,
  'en-US': EN_US_STORAGE_MESSAGES,
} as const satisfies LocalePack<(context: StorageMessageContext) => StorageMessages>;

export const STORAGE_UNAUTHENTICATED = {
  'pt-BR': PT_BR_STORAGE_UNAUTHENTICATED,
  'en-US': EN_US_STORAGE_UNAUTHENTICATED,
} as const satisfies LocalePack<string>;
