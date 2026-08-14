import type { ImpersonationKind } from './types';

/**
 * MAY THIS SESSION WRITE AT ALL — the per-kind rule, with no route in it.
 *
 * Split from the request-bound gate because it is a different question with a
 * different shape: this one has no request, and the BANNER asks it too, with
 * nothing but a decoded state to hand.
 *
 * THE RULE, per kind:
 *
 *   kind                | writes
 *   --------------------|-----------------------------------------------------
 *   operator            | only with `allowWrites`, asked for explicitly at start
 *   preview, member     | NEVER — read-only unconditionally
 *   preview, role       | allowed: the subject IS the actor, merely narrowed
 *
 * The role-preview row is not a hole. A role preview substitutes no one:
 * `subjectUserId` stays the actor and the previewed role only ever INTERSECTS
 * their own set, so every write it permits is a write they could already have
 * made, under their own name, with the preview off. A member preview is the
 * opposite — it resolves as somebody else — and is therefore refused whatever
 * the cookie says, which is why `allowWrites` is false on both preview variants
 * at mint time and this function re-derives the role case from `kind` +
 * `previewRoleName` rather than trusting a single boolean.
 */

/**
 * "Is this a role preview?" is re-derived from BOTH fields rather than one.
 * `previewRoleName` is `null` on every operator session today, so `kind` is
 * redundant — right up until someone adds a field to the cookie and it is not.
 * Requiring both means an unexpected combination falls through to the refusal,
 * not past it.
 *
 * The parameter is structural (the three fields the rule reads) so the banner
 * can ask it off a wire payload without first collapsing one.
 */
export function impersonationPermitsWrites(impersonation: {
  kind: ImpersonationKind;
  previewRoleName: string | null;
  allowWrites: boolean;
}): boolean {
  const isRolePreview =
    impersonation.kind === 'preview' && impersonation.previewRoleName !== null;
  return isRolePreview || impersonation.allowWrites;
}

/**
 * THE TENANT BOUND — is this decision being made in a DIFFERENT tenant than the
 * one the session was started (and audited) for?
 *
 * A host asks this wherever it resolves an authorization scope, and refuses
 * everything when it answers true. Acting as someone in a tenant nobody
 * consented to and nothing audited is the capability the cookie's mandatory
 * `tenantId` exists to withhold — impersonating in a second tenant is a second
 * start.
 *
 * It ships here rather than being left to each host because it is three lines
 * that every host must get right, and getting it wrong is silent: the write gate
 * checks the PATH and the KIND, never the scope, so a session bounded to tenant
 * A reads tenant B with nothing to see in a log.
 *
 * `exemptScopes` are the scopes that are not a tenant at all — a host's global
 * or organisation scope, used by the app shell's own reads ("which tenants does
 * this person belong to"). Those resolve against the SUBJECT's own grants like
 * everything else, and refusing them would break the chrome around an otherwise
 * valid session. A tenant-level decision always passes a real tenant id, so the
 * exemption is never taken on that path.
 */
export function outsideBoundedTenant(
  impersonation: { tenantId: string },
  scope: string,
  exemptScopes: (scope: string) => boolean = () => false,
): boolean {
  if (exemptScopes(scope)) return false;
  return scope !== impersonation.tenantId;
}

/**
 * WHAT THE PACKAGE CANNOT DO FOR YOU: the permission CEILING.
 *
 * A preview may only ever NARROW. The host resolves the ceiling from its own
 * engine and intersects it with the permission set it would otherwise grant:
 *
 *   kind                | ceiling
 *   --------------------|----------------------------------------------------
 *   operator            | none — be exactly the target
 *   preview, member     | the ACTOR's own set, re-read on every request
 *   preview, role       | the previewed ROLE's set, from the tenant's own row
 *
 * This is not shipped because it needs the host's engine, its role storage and
 * its scope vocabulary — none of which this package has. It is stated here, and
 * in ADOPTING, because a host that skips it gets a member preview granting the
 * previewer their OWN full rights while the banner says otherwise, and nothing
 * in this package would notice.
 *
 * Two rules for whoever writes it: an unknown or archived role must resolve to
 * the EMPTY set (deny by default, visibly wrong to the operator, rather than a
 * fallback that grants more than the row says), and the ceiling must be resolved
 * WITHOUT the caller's attribute bag, so an omitted attribute drops a permission
 * from the ceiling rather than adding one. A ceiling that errs is required to
 * err narrow.
 */
export function previewCeilingKind(impersonation: {
  kind: ImpersonationKind;
  previewRoleName: string | null;
}): 'none' | 'role' | 'actor' {
  if (impersonation.kind === 'operator') return 'none';
  return impersonation.previewRoleName !== null ? 'role' : 'actor';
}
