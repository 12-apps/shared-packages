/**
 * Which roles an invite may hand out, and who may hand them out.
 *
 * Its own module for the same reason `./invite-announce` is one: `./routes-team`
 * is the roster's route descriptors and sits at the package's 400-line ceiling,
 * and this is a RULE those descriptors apply rather than a route.
 *
 * It also stops the rule being stated twice. `PATCH /team/:userId` has always
 * narrowed the base role to a closed set before governance runs, because the
 * origin host carries a DB CHECK on `memberships.role` and a name outside it is
 * a 500 from Postgres where this layer answers a 400 at the wire. `POST /team`
 * now writes the same column through its port, so it needs the same gate — and
 * a second copy of it is a second thing to forget when a host narrows its
 * assignable set.
 */

import { RbacApiError, type RbacActor, type RbacMessages, type RbacServerConfig } from './context';
import type { GrantGovernance } from './grant-governance';
import type { RbacInviteRoles } from './invites';

/**
 * The base roles this host's roster may assign.
 *
 * `assignableBaseRoles` when the host stated one; otherwise every template the
 * catalog carries except the grant-protected ones. The exclusion reads
 * `governance.ownerRoles` — the grant-protection set — and NOT the narrower
 * disable/removal-invariant `ownerRoles` knob: this layer exists to refuse
 * BEFORE governance, so its default must exclude everything governance would.
 */
function assignableBaseRoles<P extends string>(
  config: RbacServerConfig<P>,
): readonly string[] {
  return (
    config.assignableBaseRoles ??
    config.catalog.roleTemplates
      .filter((role) => !config.catalog.governance.ownerRoles.includes(role.name))
      .map((role) => role.name)
  );
}

/** Narrow a base role to that set, or throw the 400 the wire promises. */
export function assertAssignableBaseRole<P extends string>(
  config: RbacServerConfig<P>,
  role: string,
  messages: RbacMessages,
): void {
  if (!assignableBaseRoles(config).includes(role)) {
    throw new RbacApiError(400, messages.baseRoleNotAssignable);
  }
}

/**
 * The roles one invite grants, judged before anything is written.
 *
 * `undefined` when the body named none — a screen that predates the picker, or
 * a host that decides the role inside its own port. The port's `roles` argument
 * is optional for exactly that reason, so this returning nothing is a legal
 * outcome and not a fallback.
 *
 * Governance runs for the base role AND for every custom one, with no target
 * user id: at invite time the address may have no account at all, and
 * `assertCanGrantRole` already takes the target as optional. That is not a
 * weaker check — escalation, the scope ceiling, SoD and the owner markers are
 * all properties of the GRANTER and the role, and the only rule a target would
 * add is one about who already holds what, which nobody does yet.
 *
 * Every role is judged BEFORE the port is called, so a refused custom role
 * leaves no membership, no invite row and no half-applied grant behind.
 */
export async function resolveInviteRoles<P extends string>(
  deps: { config: RbacServerConfig<P>; governance: GrantGovernance },
  actor: RbacActor,
  input: { role?: string; customRoles?: readonly string[] },
  messages: RbacMessages,
): Promise<RbacInviteRoles | undefined> {
  if (input.role === undefined) return undefined;
  assertAssignableBaseRole(deps.config, input.role, messages);
  const customRoles = input.customRoles ?? [];
  for (const role of [input.role, ...customRoles]) {
    await deps.governance.assertCanGrantRole(actor, role);
  }
  return { role: input.role, customRoles };
}
