import type { LifecycleStatus, ResolvedFeatureDef } from './types';

/**
 * The lifecycle-status transform — the seam a billing system writes through
 * WITHOUT this package ever learning what billing is.
 *
 * A host maps its own commercial states into the three generic ones
 * ({@link LifecycleStatus}); this decides whether a status withholds an
 * otherwise-granted feature. Because it is just another layer of the resolver,
 * dunning needs no separate lock mechanism: a delinquent tenant is one
 * `status` write away from restriction, enforced by the same guard as
 * everything else.
 */

/** Why a status withheld a feature, or `null` when the status permits it. */
export type StatusVeto = 'restricted' | 'suspended' | null;

export function vetoByStatus(
  status: LifecycleStatus,
  def: ResolvedFeatureDef,
): StatusVeto {
  // A hard stop admits no exceptions — `retainWhenRestricted` deliberately
  // does NOT apply here, otherwise "suspended" would be negotiable.
  if (status === 'suspended') return 'suspended';
  if (status === 'restricted' && !def.retainWhenRestricted) return 'restricted';
  return null;
}
