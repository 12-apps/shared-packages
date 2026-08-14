import { impersonationPermitsWrites } from '../core/write-rules';
import type {
  ImpersonationBannerState,
  ImpersonationSession,
  ImpersonationTenant,
  ImpersonationUser,
} from '../core/types';

/**
 * Build the banner's view of a live session — the ONE payload every surface
 * answers with.
 *
 * BOTH kinds, one shape: all of a host's apps mount the same banner, so an
 * operator session and a tenant preview have to be answerable by one call.
 *
 * `readOnly` is the NEGATION of the write rule's own predicate rather than a
 * re-reading of `allowWrites`: a role preview writes as the actor themselves, so
 * a banner computed from the boolean alone would tell someone previewing a role
 * that they cannot save, and they can.
 */
export function bannerState(
  session: ImpersonationSession,
  subject: ImpersonationUser | null,
  tenant: ImpersonationTenant | null,
): ImpersonationBannerState {
  const previewRoleName =
    session.kind === 'preview' && session.previewOf.as === 'role'
      ? session.previewOf.roleName
      : null;
  return {
    active: true,
    kind: session.kind,
    readOnly: !impersonationPermitsWrites({
      kind: session.kind,
      allowWrites: session.kind === 'operator' ? session.allowWrites : false,
      previewRoleName,
    }),
    expiresAt: new Date(session.expiresAt).toISOString(),
    previewRoleName,
    subject,
    tenant,
  };
}

/** The ordinary answer: nobody is wearing anybody else's account. */
export const NO_SESSION: ImpersonationBannerState = { active: false };
