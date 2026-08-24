import type { EntitlementPermissionLabels } from './contribution';
import type { EntitlementsMessages } from './copy';
import { EN_US_ENTITLEMENTS_MESSAGES, EN_US_ENTITLEMENTS_PERMISSION_LABELS } from './en-US';
import { PT_BR_ENTITLEMENTS_MESSAGES, PT_BR_ENTITLEMENTS_PERMISSION_LABELS } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * The permission labels get their OWN pack rather than folding into the
 * messages, because that is how the package already exports them: they are
 * passed at the CONTRIBUTION seam beside the host's own permission catalog,
 * not behind the mount.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const ENTITLEMENTS_MESSAGES = {
  'pt-BR': PT_BR_ENTITLEMENTS_MESSAGES,
  'en-US': EN_US_ENTITLEMENTS_MESSAGES,
} as const satisfies LocalePack<EntitlementsMessages>;

export const ENTITLEMENTS_PERMISSION_LABELS = {
  'pt-BR': PT_BR_ENTITLEMENTS_PERMISSION_LABELS,
  'en-US': EN_US_ENTITLEMENTS_PERMISSION_LABELS,
} as const satisfies LocalePack<EntitlementPermissionLabels>;
