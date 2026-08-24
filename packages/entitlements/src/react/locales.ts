import type { EntitlementsWebCopy } from './copy';
import { EN_US_ENTITLEMENTS_WEB_COPY } from './en-US';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from './pt-BR';

/**
 * Both languages of the plan screens, keyed by tag.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const ENTITLEMENTS_WEB_COPY = {
  'pt-BR': PT_BR_ENTITLEMENTS_WEB_COPY,
  'en-US': EN_US_ENTITLEMENTS_WEB_COPY,
} as const satisfies LocalePack<EntitlementsWebCopy>;
