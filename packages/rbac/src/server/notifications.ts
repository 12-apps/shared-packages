/**
 * The team invite as a NOTIFICATION BLUEPRINT and the port that fires it —
 * the RFC's founding incident, closed.
 *
 * ## The incident, verbatim
 *
 * `RbacInvitesPort.invite()` records a row and returns `{ status: 'invited' }`.
 * Nobody tells the invitee. Not because a host chose silence, but because this
 * package had no way to ASK for a notification: every channel in the estate
 * was either a bespoke callback a host invented at the mount, or nothing. The
 * roster screen shows a pending invite, the invitee's inbox shows nothing, and
 * no test in either repo fails.
 *
 * Two halves close it, and they are deliberately separate capabilities:
 *
 * - **What to say** — {@link createTeamInvitedBlueprint}, the content this
 *   package's event renders into. Declared by the package that owns the event.
 * - **How to say it** — {@link RbacNotifyPort}, an OPTIONAL host port. Bound,
 *   the invitee is told with zero new host code. Unbound, the capability is a
 *   written decline in the wiring report instead of an invisible silence.
 *
 * ## Why the blueprint is a factory over host copy
 *
 * Every user-facing sentence is host vocabulary — the doctrine this package
 * already follows for `RbacMessages`, and the same carve-out
 * `createResearchBudgetBlueprint` documents one package over. A blueprint
 * pre-worded here would be a silent pt-BR default shipped inside a library,
 * which is exactly what the copy gate refuses. So the host passes its words
 * (`PT_BR_TEAM_INVITED_COPY` in `./pt-BR` carries the origin host's) and
 * feeds the result to its notifications mount — a line in the host's diff,
 * which is the point.
 *
 * The manifest therefore declares no STATIC `notifications` capability; the
 * factory is the capability, and `../manifest` says so in writing.
 *
 * ## Why the twins are local
 *
 * `RbacNotifyPort` and the blueprint types are structural twins of
 * `@12-apps/wiring`'s `NotifyPort` / `WireNotificationBlueprint`, restated
 * here with no import. `@12-apps/wiring` is an OPTIONAL peer, so a host that
 * installs rbac without adopting the contract must still be able to typecheck
 * `./server` — and a `import type` of an uninstalled package in a shipped
 * `.d.ts` breaks exactly that host. The assignability is pinned instead by
 * `__tests__/wiring-twins.test.ts`, which is the trade the contract's own
 * "twins stay twins" rule prescribes.
 */

/** The wire type; the host's taxonomy maps or vetoes the suggested category. */
export const TEAM_INVITED_NOTIFICATION_TYPE = 'rbac.team.invited';

/** What happened, so the copy can say the right one of two things. */
export interface TeamInvitedPayload {
  /** The tenant the person was invited to. */
  tenantId: string;
  /** The address the roster invited, already normalised (trimmed, lowercased). */
  email: string;
  /**
   * `added` — the address already had an account and membership was granted
   * immediately; `invited` — no account existed and a pending invite is
   * waiting on signup. The two are different sentences to the reader: one is
   * "you now have access", the other is "finish signing up".
   */
  status: 'added' | 'invited';
  /** Who invited them, when the caller had a user row. */
  invitedByUserId?: string;
}

/** Twin of the wiring contract's `WireNotificationContent`. */
export interface RbacNotificationContent {
  title: string;
  body: string;
  link?: string;
  data?: Readonly<Record<string, unknown>>;
}

/** Twin of the wiring contract's `WireNotificationBlueprint`. */
export interface RbacNotificationBlueprint {
  type: string;
  /** SUGGESTED preference category; the host's taxonomy decides. */
  category: string;
  generate(payload: TeamInvitedPayload): RbacNotificationContent;
}

/** The host's words for the invite notice, and where its CTA lands. */
export interface TeamInvitedCopy {
  title(payload: TeamInvitedPayload): string;
  body(payload: TeamInvitedPayload): string;
  /** Relative link into the host's own UI — the tenant's home, typically. */
  link(payload: TeamInvitedPayload): string;
}

/**
 * Build the blueprint with a host's copy. `category` suggests `system` — an
 * account/access notice rather than an order or payment event — and stays the
 * host taxonomy's to map or veto at adoption.
 */
export function createTeamInvitedBlueprint(copy: TeamInvitedCopy): RbacNotificationBlueprint {
  return {
    type: TEAM_INVITED_NOTIFICATION_TYPE,
    category: 'system',
    generate: (payload) => ({
      title: copy.title(payload),
      body: copy.body(payload),
      link: copy.link(payload),
      data: {
        tenantId: payload.tenantId,
        email: payload.email,
        status: payload.status,
        ...(payload.invitedByUserId ? { invitedByUserId: payload.invitedByUserId } : {}),
      },
    }),
  };
}

/** Twin of the wiring contract's `NotifyRecipient`. */
export type RbacNotifyRecipient =
  | { userId: string }
  | { tenantId: string; permission: string };

/** Twin of the wiring contract's `NotifyEvent`. */
export interface RbacNotifyEvent<TPayload = unknown> {
  type: string;
  recipient: RbacNotifyRecipient;
  payload: TPayload;
}

/** Twin of the wiring contract's `NotifyOutcome`. */
export interface RbacNotifyOutcome {
  accepted: boolean;
  reason?: string;
}

/**
 * Twin of the wiring contract's `NotifyPort`. NEVER throws — an emit is an
 * outcome, so a notification pipeline having a bad day cannot fail the invite
 * that already committed. This package relies on that: it emits AFTER the
 * write and does not wrap the call in its own rescue.
 */
export interface RbacNotifyPort {
  emit(event: RbacNotifyEvent): Promise<RbacNotifyOutcome>;
}
