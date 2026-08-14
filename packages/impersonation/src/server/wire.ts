import { z } from 'zod';

import type {
  ImpersonationMintPolicy,
} from './ports';

/**
 * The request bodies this surface accepts, built from the host's mint policy.
 *
 * Built rather than declared, because two of the constraints are the host's: the
 * apps a session may land in, and how long a justification must be. A schema
 * with those baked in would either be one product's list or no list at all — and
 * "no list" means an operator lands on a 404 wearing somebody else's account.
 */

/** `POST` on the platform surface: start an operator session. */
export function startOperatorBody(policy: ImpersonationMintPolicy) {
  return z.object({
    targetUserId: z.string().min(1).max(64),
    /**
     * Narrowed to the host's own apps. `z.enum` needs a non-empty tuple, so a
     * host declaring none gets a schema nothing satisfies — which is the honest
     * outcome: a session with nowhere to land should not be mintable.
     */
    targetApp: z.string().refine((value) => policy.targetApps.includes(value), {
      message: 'unknown app',
    }),
    tenantId: z.string().min(1).max(64),
    reason: z.string().min(policy.reasonLength.min).max(policy.reasonLength.max),
    /**
     * Optional, defaulting to FALSE. A session that can write is the exceptional
     * case and has to be asked for explicitly — a required boolean would let a
     * caller that forgot the field fail closed only by accident of the parser.
     */
    allowWrites: z.boolean().optional().default(false),
  });
}

/**
 * `POST` on the tenant surface: start a preview.
 *
 * There is NO `allowWrites` here, and it is not an omission. A member preview is
 * read-only unconditionally and a role preview may write because it substitutes
 * nobody — both facts are derived from the SHAPE of the session, never from a
 * flag a caller could set, so there is no parameter for this surface to take.
 */
export const startPreviewBody = z.discriminatedUnion('as', [
  z.object({ as: z.literal('role'), roleName: z.string().min(1).max(120) }),
  z.object({ as: z.literal('member'), memberUserId: z.string().min(1).max(64) }),
]);

export type StartPreviewBody = z.infer<typeof startPreviewBody>;
export type StartOperatorBody = z.infer<ReturnType<typeof startOperatorBody>>;
