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
