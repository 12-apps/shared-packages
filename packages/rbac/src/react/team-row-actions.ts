import type { RowAction } from '@12-apps/ui/data-display/DataViews';

import type { TeamRowMenuCopy } from './copy';
import type { TeamRow } from './team-grid-config';

/** What the ⋮ kebab entries call — all owned by the screen. */
export interface TeamRowActionHandlers {
  openRoleEdit: (row: TeamRow) => void;
  toggleActive: (row: TeamRow) => void;
  /**
   * Remove a member. Takes the ROW rather than an id: the act is confirm-gated
   * and the popup names the person whose access it is about to revoke.
   */
  remove: (row: TeamRow) => void;
  /** Cancel a pending accountless invite. Takes the row, for the same reason. */
  cancelInvite: (row: TeamRow) => void;
  /**
   * Mail a pending invite a fresh link. OPTIONAL: present only when the host's
   * invites port can resend (`invitesResendable` on the team context), so a
   * host without it is never offered an entry whose only outcome is an error.
   */
  resendInvite?: (row: TeamRow) => void;
}

/**
 * The per-row ⋮ kebab. Real members get edit-roles / enable-disable / remove; a
 * pending invite gets resend (when the host can) and cancel. An owner-tier member is owner-protected —
 * never disabled or removed from here, matching what the endpoints refuse.
 *
 * @param ownerRoles The protected tier, from the host's governance catalog.
 * REQUIRED with no `['OWNER']` fallback: a default would render destructive
 * affordances on rows the server then refuses, which is the screen and the
 * endpoints disagreeing about who an owner is.
 */
export function buildTeamRowActions(
  handlers: TeamRowActionHandlers,
  ownerRoles: ReadonlySet<string>,
  copy: TeamRowMenuCopy,
  /**
   * Which entries this host offers, by id. Absent, all of them — every adopter
   * before this existed.
   *
   * A host whose model has no equivalent for an action must be able to withhold
   * it: `toggle-active` writes `PATCH /team/:userId/status`, and a host with no
   * status column has nothing to toggle. Rendering it anyway offers a control
   * whose only outcome is an error on screen.
   */
  allowed?: readonly string[],
): RowAction<TeamRow>[] {
  const offered = allowed === undefined ? null : new Set(allowed);
  const isMember = (row: TeamRow): boolean => row.status !== 'PENDING';
  // Set-aware: ANY owner role the person holds protects the row. Reading the
  // base field alone would hand an env superadmin its destructive entries back
  // the moment that field stops being where the owner role lives.
  const editable = (row: TeamRow): boolean =>
    isMember(row) && !row.roles.some((name) => ownerRoles.has(name));
  const entries: RowAction<TeamRow>[] = [
    {
      id: 'edit-roles',
      label: copy.editRoles,
      bulk: false,
      isVisible: editable,
      onSelect: (rows) => rows.forEach(handlers.openRoleEdit),
    },
    {
      id: 'toggle-active',
      label: copy.deactivate,
      bulk: false,
      isVisible: editable,
      rowLabel: (row) => (row.status === 'DISABLED' ? copy.activate : copy.deactivate),
      onSelect: (rows) => rows.forEach(handlers.toggleActive),
    },
    {
      id: 'remove',
      label: copy.remove,
      color: 'danger',
      bulk: false,
      isVisible: editable,
      onSelect: (rows) => rows.forEach(handlers.remove),
    },
    {
      id: 'resend-invite',
      label: copy.resendInvite,
      bulk: false,
      isVisible: (row) => !isMember(row) && handlers.resendInvite !== undefined,
      onSelect: (rows) => rows.forEach((row) => row.inviteId && handlers.resendInvite?.(row)),
    },
    {
      id: 'cancel-invite',
      label: copy.cancelInvite,
      color: 'danger',
      bulk: false,
      isVisible: (row) => !isMember(row),
      onSelect: (rows) => rows.forEach((row) => row.inviteId && handlers.cancelInvite(row)),
    },
  ];
  return entries.filter((action) => offered === null || offered.has(action.id));
}
