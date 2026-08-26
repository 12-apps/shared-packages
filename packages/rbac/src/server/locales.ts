import type { RbacMessages } from './context';
import { EN_US_RBAC_MESSAGES, EN_US_TEAM_INVITED_COPY } from './en-US';
import type { TeamInvitedCopy } from './notifications';
import { PT_BR_RBAC_MESSAGES, PT_BR_TEAM_INVITED_COPY } from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const RBAC_MESSAGES = {
  'pt-BR': PT_BR_RBAC_MESSAGES,
  'en-US': EN_US_RBAC_MESSAGES,
} as const satisfies LocalePack<RbacMessages>;

/**
 * The invite notice's words, both languages — what a host hands
 * `createTeamInvitedBlueprint` once its readers do not share a language.
 *
 * A notification is stored as rendered TEXT, so the language is fixed when the
 * row is written; the blueprint resolves this pack at that moment, against the
 * RECIPIENT's tag. Which is the invitee's — not the administrator's who
 * triggered it, and not the deployment's.
 */
export const TEAM_INVITED_COPY = {
  'pt-BR': PT_BR_TEAM_INVITED_COPY,
  'en-US': EN_US_TEAM_INVITED_COPY,
} as const satisfies LocalePack<TeamInvitedCopy>;
