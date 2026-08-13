import type { RbacServerConfig } from './context';

/**
 * The two ROLE-NAME questions the roster asks that the permission engine
 * cannot answer: which roles this host protects as owners, and how a PLATFORM
 * operator is recognised. Both used to be answered with a literal from the
 * application this package was extracted from.
 */

/**
 * The roles the disable/removal invariants protect, in force: the host's
 * override when it states one, otherwise the composed catalog's own
 * `ownerRoles`. There is no package-side default — the words `OWNER` and
 * `ADMIN` belong to whichever host chose them.
 *
 * Deriving rather than defaulting is the point: the host already had to state
 * that set to assemble its catalog, so the roster invariants and the grant
 * protection cannot name different sets by accident. `['OWNER']` as a fallback
 * meant a host whose owner is `DIRECTOR` ran both invariants over the empty
 * set — no last owner, and anyone could remove an owner.
 */
export function ownerRolesOf<P extends string>(
  config: Pick<RbacServerConfig<P>, 'catalog' | 'ownerRoles'>,
): readonly string[] {
  return config.ownerRoles ?? config.catalog.governance.ownerRoles;
}

/**
 * What the roster knows about the CALLER once the admin tier has admitted
 * them, and the reason it is two fields rather than one role string.
 *
 * A platform operator has no membership row, so the roster used to synthesize
 * the literal `'SUPERADMIN'` for them and the ownership rules compared against
 * that string. Downstream nothing could tell that sentinel from a member whose
 * REAL role is spelled `SUPERADMIN`: a host with such a role in `adminRoles`
 * but not `ownerRoles` inherited an owner-removal bypass, and a host naming
 * its platform tier anything else got a sentinel that matched nothing. The
 * discriminator says which one it is, so no role NAME has to carry that
 * meaning.
 */
export interface RbacActorTier {
  /** The caller's real membership role, or `null` for a platform operator. */
  readonly role: string | null;
  /** The host resolved this caller as a platform operator (`isSuper`). */
  readonly isPlatformActor: boolean;
}
