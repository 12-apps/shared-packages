import { EN_US_AUDIT_LABELS } from './en-US';
import type { AuditLabels } from './labels';
import { PT_BR_AUDIT_LABELS } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 * `LocalePack` is mirrored rather than imported, so the package stays liftable
 * into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const AUDIT_LABELS = {
  'pt-BR': PT_BR_AUDIT_LABELS,
  'en-US': EN_US_AUDIT_LABELS,
} as const satisfies LocalePack<AuditLabels>;
