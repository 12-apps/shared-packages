import { EN_US_WEB_STORAGE_MESSAGES } from './en-US';
import type { WebStorageMessageContext, WebStorageMessages } from './failures';
import { PT_BR_WEB_STORAGE_MESSAGES } from './pt-BR';

/**
 * Both languages of the browser half, keyed by tag. Factories, for the reason
 * the server pack's docstring gives: the ceiling is interpolated so copy cannot
 * name a limit the host has since changed.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const WEB_STORAGE_MESSAGES = {
  'pt-BR': PT_BR_WEB_STORAGE_MESSAGES,
  'en-US': EN_US_WEB_STORAGE_MESSAGES,
} as const satisfies LocalePack<(context: WebStorageMessageContext) => WebStorageMessages>;
