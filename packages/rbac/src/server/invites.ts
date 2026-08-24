/**
 * The OPTIONAL invites seam.
 *
 * Its own module because `context.ts` is at the package's 400-line ceiling and
 * this is the one seam with a shape rather than a signature: two interfaces, a
 * status union and the reachability contract the invite notification reads.
 * `context.ts` re-exports both, so nothing downstream imports a new path.
 */

/** A pending accountless invite, when the host wires the invites seam. */
export interface RbacPendingInvite {
  id: string;
  email: string;
  role: string;
}

/**
 * OPTIONAL invite seam. Accountless invites need a table and a signup hook
 * this package does not own, so a host that wants the roster's invite surface
 * plugs its own storage in; without it the two invite routes answer 501 and
 * the packaged screen hides the affordance.
 */
export interface RbacInvitesPort {
  /**
   * Grant-or-invite by e-mail; the host decides which happened.
   *
   * `userId` is the account membership was granted to, when there was one —
   * the `added` branch. It is what makes the invitee REACHABLE: a notification
   * needs a recipient, and this port is the only thing that knows whether the
   * address resolved to an account. Optional, so an existing implementation
   * keeps compiling; omitted, the invite notification is skipped with a
   * written reason rather than sent to nobody.
   */
  invite(
    tenantId: string,
    email: string,
  ): Promise<{ status: 'added' | 'invited'; userId?: string }>;
  listPending(tenantId: string): Promise<RbacPendingInvite[]>;
  /** Cancel a pending invite by id. Idempotent. */
  cancel(tenantId: string, inviteId: string): Promise<void>;
}
