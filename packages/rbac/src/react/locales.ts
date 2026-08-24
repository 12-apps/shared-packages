import type { RbacWebCopy } from './copy';
import { EN_US_RBAC_WEB_COPY } from './en-US';
import { PT_BR_RBAC_WEB_COPY } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const RBAC_WEB_COPY = {
  'pt-BR': PT_BR_RBAC_WEB_COPY,
  'en-US': EN_US_RBAC_WEB_COPY,
} as const satisfies LocalePack<RbacWebCopy>;
