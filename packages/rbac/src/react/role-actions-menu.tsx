'use client';

import { useState, type JSX, type ReactNode } from 'react';

import {
  CardKebab,
  useCardActions,
  useRowConfirm,
  type RowConfirm,
} from '@12-apps/ui/data-display/CardKit';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import type { DropdownMenuItem } from '@12-apps/ui/navigation/DropdownMenu';

import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

import type { RbacApiClient } from './api';
import { useCan } from './context';
import type { RbacWebCopy } from './copy';
import type { RbacLabels } from './labels';
import { RoleForm, type RoleFormValue } from './role-form';
import type { RoleRow } from './role-grid-config';

/**
 * A role's self-contained ⋮ menu: it owns its edit popup, its reset confirm and
 * its delete write, and drives BOTH the table row and the card so the two can
 * never offer different actions for the same role.
 *
 * Renders nothing at all when the actor cannot manage roles, rather than a
 * kebab that opens onto an empty list.
 */

export interface RoleMenuContext {
  api: RbacApiClient;
  permissions: Pick<PermissionRegistry<string>, 'list' | 'kind'>;
  governance: Pick<GovernanceCatalog, 'ownerPermissions' | 'sodPairs'>;
  labels: RbacLabels;
  copy: RbacWebCopy;
  managePermission: string;
  /**
   * The version-history affordance for ONE tenant-composed role, when the host
   * has a lifecycle surface to offer.
   *
   * A slot rather than a dependency: version history is `@12-apps/entity-lifecycle`'s,
   * it is wired per host, and a role catalog that hard-required it would oblige
   * every adopter to mount a second package to render a menu. Absent, the entry
   * simply is not there — which is the honest state for a host with no history.
   */
  renderVersionHistory?: (input: {
    role: RoleRow;
    onClose: () => void;
    onRestored: () => void;
  }) => ReactNode;
}

/**
 * The conditional entries: edit (editable rows), history (custom only — a
 * seeded row is RESET, never versioned), reset (a drifted seeded row), delete
 * (custom only).
 */
function roleMenuItems(
  row: RoleRow,
  copy: RbacWebCopy,
  hasHistory: boolean,
  handlers: { edit: () => void; history: () => void; reset: () => void; remove: () => void },
): DropdownMenuItem[] {
  const words = copy.rolesTable;
  // The test id is derived from the entry's stable id, never its label — see
  // `TeamActionsMenu` for why.
  const entry = (id: string, label: string, onClick: () => void): DropdownMenuItem => ({
    id,
    label,
    onClick,
    dataTestId: `role-action-${id}`,
  });
  const items: DropdownMenuItem[] = [];
  if (row.editable) items.push(entry('edit', words.editAction, handlers.edit));
  if (row.kind === 'custom' && hasHistory) {
    items.push(entry('history', words.historyAction, handlers.history));
  }
  if (row.kind === 'template' && row.overridden) {
    items.push(entry('reset', words.resetAction, handlers.reset));
  }
  if (row.kind === 'custom') {
    items.push({ ...entry('delete', words.deleteAction, handlers.remove), color: 'danger' });
  }
  return items;
}

/** The edit popup, owned by the menu. */
function RoleEditPopup({
  row,
  open,
  context,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: RoleRow;
  open: boolean;
  context: RoleMenuContext;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: RoleFormValue) => void;
}): JSX.Element {
  const { copy } = context;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        row.system
          ? copy.rolesList.dialogTitles.override(row.name)
          : copy.rolesList.dialogTitles.edit(row.name)
      }
      size="md"
      showCloseButton
      dataTestId="role-dialog"
    >
      {open && (
        <DialogContent>
          <RoleForm
            permissions={context.permissions}
            governance={context.governance}
            labels={context.labels}
            copy={copy.roleForm}
            initial={{
              name: row.name,
              description: row.description,
              permissions: row.permissions === '*' ? [] : [...row.permissions],
            }}
            template={row.system}
            busy={busy}
            error={error}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * One destructive role write behind its confirm step. Both entries take the
 * same shape, so they take the same hook — the difference is which call and
 * which words, and nothing else.
 */
function useRoleConfirm(
  row: RoleRow,
  context: RoleMenuContext,
  kind: 'delete' | 'reset',
): RowConfirm<RoleRow> {
  const { api, copy } = context;
  const { onRefresh, notifyError } = useCardActions();
  const words = kind === 'delete' ? copy.rolesList.deleteConfirm : copy.rolesList.resetConfirm;
  return useRowConfirm<RoleRow>({
    write: async () => {
      const result = kind === 'delete' ? await api.deleteRole(row.id) : await api.resetTemplate(row.name);
      if (!result.ok) {
        notifyError(result.error);
        // Throwing holds the popup open carrying the reason.
        throw new Error(result.error);
      }
      onRefresh();
    },
    describe: () => ({
      title: words.title,
      entityName: row.name,
      description: words.body,
      confirmText: words.confirmLabel,
    }),
    errorText: kind === 'delete' ? copy.rolesTable.deleteFailed : copy.rolesTable.resetFailed,
    copy: copy.confirmAction,
    dataTestId: `role-${kind}-confirm`,
  });
}

/** The edit popup's open/busy/error state and its one write. */
function useRoleEdit(
  row: RoleRow,
  context: RoleMenuContext,
): {
  open: boolean;
  busy: boolean;
  error: string | null;
  start: () => void;
  close: () => void;
  submit: (value: RoleFormValue) => Promise<void>;
} {
  const { api } = context;
  const { onRefresh } = useCardActions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    open,
    busy,
    error,
    start: () => setOpen(true),
    close: () => {
      setOpen(false);
      setError(null);
    },
    async submit(value) {
      setBusy(true);
      setError(null);
      // A seeded role is OVERRIDDEN by name; a tenant's own is updated by id.
      // Two endpoints, because they mean two different things to the catalog.
      const result = row.system
        ? await api.overrideTemplate(row.name, {
            description: value.description,
            permissions: value.permissions,
          })
        : await api.updateRole(row.id, value);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onRefresh();
    },
  };
}

export function RoleActionsMenu({
  row,
  context,
}: {
  row: RoleRow;
  context: RoleMenuContext;
}): JSX.Element | null {
  const { copy } = context;
  const { onRefresh } = useCardActions();
  const canManage = useCan()(context.managePermission);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Declared above the `canManage` gate: a hook cannot sit behind a return.
  const remove = useRoleConfirm(row, context, 'delete');
  const reset = useRoleConfirm(row, context, 'reset');
  const edit = useRoleEdit(row, context);

  if (!canManage) return null;

  const items = roleMenuItems(row, copy, Boolean(context.renderVersionHistory), {
    edit: edit.start,
    history: () => setHistoryOpen(true),
    reset: () => reset.request([row]),
    remove: () => remove.request([row]),
  });
  if (items.length === 0) return null;

  return (
    <>
      <CardKebab
        menuLabel={copy.menuLabel}
        items={items}
        dataTestId={`role-actions-${row.id}`}
      />
      {remove.dialog}
      {reset.dialog}
      <RoleEditPopup
        row={row}
        open={edit.open}
        context={context}
        busy={edit.busy}
        error={edit.error}
        onClose={edit.close}
        onSubmit={(value) => void edit.submit(value)}
      />
      {historyOpen &&
        context.renderVersionHistory?.({
          role: row,
          onClose: () => setHistoryOpen(false),
          onRestored: onRefresh,
        })}
    </>
  );
}
