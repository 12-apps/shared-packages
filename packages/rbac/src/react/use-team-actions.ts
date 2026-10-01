'use client';

import { useCallback, useState } from 'react';

import { useRowConfirm, type RowConfirm } from '@12-apps/ui/data-display/CardKit';

import type { InviteResultWire, RbacApiClient } from './api';
import type { RbacWebCopy } from './copy';
import type { InviteSelection } from './team-invite-form';
import type { TeamRow } from './team-grid-config';
import { applyRoleSet, type MemberWithRoles } from './team-role-dialog';
import type { RbacRefusal } from './transport';

/**
 * Everything the roster WRITES, and the state those writes drive — extracted
 * from the screen so the component file stays inside the size gate, and because
 * these are the parts a host might reasonably want to drive itself.
 */

/**
 * Who a LIVE grant just added — the confirmation's subject (FUT-3135).
 *
 * `userId` is present when the server reported it, and is what lets the banner
 * open the member's profile: the roster is sorted, so the new row may be on a
 * page the operator is not looking at.
 */
export interface AddedMember {
  email: string;
  userId?: string;
}

/** The roster's mutations plus the banner + dialog state they drive. */
export interface TeamActions {
  error: string | null;
  setError: (value: string | null) => void;
  /** The banner for a DEFERRED grant (an accountless address); null otherwise. */
  notice: boolean;
  dismissNotice: () => void;
  /** The banner for a LIVE grant — who was added; null otherwise. */
  added: AddedMember | null;
  dismissAdded: () => void;
  showForm: boolean;
  toggleForm: () => void;
  /** Open the invite dialog (never closes it) — what a host's own "invite" entry calls. */
  openForm: () => void;
  formKey: number;
  /**
   * Why the last invite was refused, shown INSIDE the dialog (FUT-3137); null
   * otherwise. Its own field rather than `error`: the page banner sits behind
   * the modal, so a refusal routed there was never seen. Cleared by the next
   * attempt and whenever the dialog opens or closes. Carries the server's
   * status and body, so a host can offer the way out (an upgrade for a plan
   * denial) beside the sentence.
   */
  inviteRefusal: RbacRefusal | null;
  invite: (selection: InviteSelection) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  toggleActive: (row: TeamRow) => Promise<void>;
  cancelInvite: (inviteId: string) => Promise<void>;
}

/** The address as the server keys it — the route trims and lowercases too. */
function addedMember(email: string, userId: string | undefined): AddedMember {
  return { email: email.trim().toLowerCase(), ...(userId ? { userId } : {}) };
}

/**
 * What the last invite came to, as the two banners read it — at most one of
 * them set. Its own hook because the two are one piece of state with one rule,
 * and because `useTeamActions` sits on the 80-line ceiling.
 */
function useInviteOutcome(): {
  banners: Pick<TeamActions, 'notice' | 'dismissNotice' | 'added' | 'dismissAdded'>;
  clear: () => void;
  record: (email: string, result: InviteResultWire) => void;
} {
  const [notice, setNotice] = useState(false);
  const [added, setAdded] = useState<AddedMember | null>(null);
  return {
    banners: {
      notice,
      dismissNotice: () => setNotice(false),
      added,
      dismissAdded: () => setAdded(null),
    },
    clear: () => {
      setNotice(false);
      setAdded(null);
    },
    // Both outcomes are SAID, because neither shows reliably in the table: a
    // deferred grant has no membership yet, and a live one lands wherever the
    // roster's sort puts it — often another page (FUT-3135). Every status but
    // `invited` is a live grant; see `InviteResultWire`.
    record: (email, result) => {
      if (result.status === 'invited') setNotice(true);
      else setAdded(addedMember(email, result.userId));
    },
  };
}

/**
 * The invite dialog's own state: open or not, the form's remount key, and the
 * refusal it shows (FUT-3137). Its own hook for the reason `useInviteOutcome`
 * is — `useTeamActions` sits on the 80-line ceiling.
 */
function useInviteDialog(): Pick<
  TeamActions,
  'showForm' | 'toggleForm' | 'openForm' | 'formKey' | 'inviteRefusal'
> & { fail: (refusal: RbacRefusal) => void; succeed: () => void; clearError: () => void } {
  const [showForm, setShowForm] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [inviteRefusal, setInviteRefusal] = useState<RbacRefusal | null>(null);
  // Stable, so a host effect that depends on it runs when the REQUEST changes.
  const openForm = useCallback(() => {
    setInviteRefusal(null);
    setShowForm(true);
  }, []);
  return {
    showForm,
    formKey,
    inviteRefusal,
    openForm,
    toggleForm: () => {
      setInviteRefusal(null);
      setShowForm((open) => !open);
    },
    fail: ({ error, status, body }) => setInviteRefusal({ error, status, body }),
    clearError: () => setInviteRefusal(null),
    // A fresh form for the next invite: the key remounts it empty.
    succeed: () => {
      setFormKey((key) => key + 1);
      setShowForm(false);
    },
  };
}

export function useTeamActions(
  api: RbacApiClient,
  copy: RbacWebCopy,
  refresh: () => void,
): TeamActions {
  const [error, setError] = useState<string | null>(null);
  const outcome = useInviteOutcome();
  const dialog = useInviteDialog();

  async function invite(selection: InviteSelection): Promise<void> {
    setError(null);
    outcome.clear();
    dialog.clearError();
    const result = await api.inviteMember(selection.email, {
      role: selection.role,
      customRoles: selection.customRoles,
    });
    if (!result.ok) {
      // Said where the operator is looking: the dialog stays open on what they
      // typed, with the reason above it (FUT-3137).
      dialog.fail(result);
      return;
    }
    outcome.record(selection.email, result.data);
    refresh();
    dialog.succeed();
  }

  /** Rejects on refusal so the confirm popup holds itself open with the reason. */
  async function remove(userId: string): Promise<void> {
    setError(null);
    const result = await api.removeMember(userId);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    refresh();
  }

  async function toggleActive(row: TeamRow): Promise<void> {
    setError(null);
    const result = await api.setMemberActive(row.userId, row.status === 'DISABLED');
    // A refused flip must SAY so rather than render nothing.
    if (result.ok) refresh();
    else setError(result.error);
  }

  /** Rejects on refusal, as `remove` does and for the same reason. */
  async function cancelInvite(inviteId: string): Promise<void> {
    setError(null);
    const result = await api.cancelInvite(inviteId);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    refresh();
  }

  return {
    error,
    setError,
    ...outcome.banners,
    showForm: dialog.showForm,
    toggleForm: dialog.toggleForm,
    openForm: dialog.openForm,
    formKey: dialog.formKey,
    inviteRefusal: dialog.inviteRefusal,
    invite,
    remove,
    toggleActive,
    cancelInvite,
  };
}

/**
 * Removing somebody, confirm-gated: their access is revoked the moment it runs,
 * and undoing it costs a fresh invite they have to accept.
 */
export function useRemoveConfirm(
  actions: TeamActions,
  copy: RbacWebCopy,
): RowConfirm<TeamRow> {
  return useRowConfirm<TeamRow>({
    write: async (rows) => {
      for (const row of rows) await actions.remove(row.userId);
    },
    describe: (rows) => ({
      title: copy.teamScreen.removeConfirm.title,
      entityName: rows[0]?.name ?? rows[0]?.email,
      description: copy.teamScreen.removeConfirm.body,
      confirmText: copy.teamScreen.removeConfirm.confirmLabel,
    }),
    errorText: copy.teamScreen.removeFailed,
    copy: copy.confirmAction,
    dataTestId: 'team-remove-confirm',
  });
}

/** Cancelling a pending invite, confirm-gated: it burns the link already sent. */
export function useCancelInviteConfirm(
  actions: TeamActions,
  copy: RbacWebCopy,
): RowConfirm<TeamRow> {
  const words = copy.teamScreen.cancelInviteConfirm;
  return useRowConfirm<TeamRow>({
    write: async (rows) => {
      for (const row of rows) if (row.inviteId) await actions.cancelInvite(row.inviteId);
    },
    describe: (rows) => ({
      title: words.title,
      entityName: rows[0]?.email,
      description: words.body,
      confirmText: words.confirmLabel,
      // The ACT is a cancellation, so the back-out cannot also read "cancel".
      cancelText: words.cancelLabel,
    }),
    errorText: words.failed,
    copy: copy.confirmAction,
    dataTestId: 'team-cancel-invite-confirm',
  });
}

/** The role-edit popup's state and its save, over the EXISTING endpoints. */
export function useRoleEditor(
  api: RbacApiClient,
  refresh: () => void,
  onError: (message: string | null) => void,
): {
  editing: MemberWithRoles | null;
  busy: boolean;
  open: (row: TeamRow) => void;
  close: () => void;
  save: (roleNames: string[]) => Promise<void>;
} {
  const [editing, setEditing] = useState<MemberWithRoles | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    editing,
    busy,
    open: (row) =>
      setEditing({
        userId: row.userId,
        role: row.role,
        email: row.email,
        name: row.name,
        image: null,
        active: row.status !== 'DISABLED',
        status: row.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
        customRoles: row.customRoles,
        roles: row.roles,
      }),
    close: () => setEditing(null),
    async save(roleNames) {
      if (!editing) return;
      setBusy(true);
      onError(null);
      const failure = await applyRoleSet(api, editing, roleNames);
      setBusy(false);
      onError(failure);
      if (!failure) {
        setEditing(null);
        refresh();
      }
    },
  };
}

