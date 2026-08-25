'use client';

import { useState } from 'react';

import { useRowConfirm, type RowConfirm } from '@12-apps/ui/data-display/CardKit';

import type { RbacApiClient } from './api';
import type { RbacWebCopy } from './copy';
import type { InviteFormValues } from './team-invite-form';
import type { TeamRow } from './team-grid-config';
import {
  applyRoleChanges,
  splitRoleSelection,
  type MemberWithRoles,
} from './team-role-dialog';

/**
 * Everything the roster WRITES, and the state those writes drive — extracted
 * from the screen so the component file stays inside the size gate, and because
 * these are the parts a host might reasonably want to drive itself.
 */

/** The roster's mutations plus the banner + dialog state they drive. */
export interface TeamActions {
  error: string | null;
  setError: (value: string | null) => void;
  /** The banner for a DEFERRED grant (an accountless address); null otherwise. */
  notice: boolean;
  dismissNotice: () => void;
  showForm: boolean;
  toggleForm: () => void;
  formKey: number;
  invite: (values: InviteFormValues) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  toggleActive: (row: TeamRow) => Promise<void>;
  cancelInvite: (inviteId: string) => Promise<void>;
}

export function useTeamActions(
  api: RbacApiClient,
  copy: RbacWebCopy,
  refresh: () => void,
): TeamActions {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function invite(values: InviteFormValues): Promise<void> {
    setError(null);
    setNotice(false);
    const result = await api.inviteMember(values.email);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // A live grant appears in the roster on refresh; a deferred one does NOT
    // (there is no membership yet), so the dialog closing on an unchanged table
    // would read as nothing having happened.
    setNotice(result.data.status === 'invited');
    refresh();
    setFormKey((key) => key + 1);
    setShowForm(false);
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
    notice,
    dismissNotice: () => setNotice(false),
    showForm,
    toggleForm: () => setShowForm((open) => !open),
    formKey,
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
  systemSet: ReadonlySet<string>,
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
      }),
    close: () => setEditing(null),
    async save(roleNames) {
      if (!editing) return;
      const { base, customRoles } = splitRoleSelection(roleNames, systemSet);
      // The dialog blocks a save without exactly one system role.
      if (!base) return;
      setBusy(true);
      onError(null);
      const failure = await applyRoleChanges(api, editing, base, customRoles);
      setBusy(false);
      onError(failure);
      if (!failure) {
        setEditing(null);
        refresh();
      }
    },
  };
}

