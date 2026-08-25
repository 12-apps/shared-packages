'use client';

import type { JSX } from 'react';

import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';

import type { RoleMenuContext } from './role-actions-menu';
import { RoleForm, type RoleFormValue } from './role-form';

/**
 * The compose/edit popup — ONE component for both flows.
 *
 * The catalog opens this to create a role and the row menu opens it to edit
 * one, and for a while those were two components: the same `Dialog`, the same
 * `RoleForm`, the same seven props threaded through, differing only in a title
 * and whether `initial` was null. Forty-two duplicated lines whose failure mode
 * is the quiet one — a prop added to one call site and not the other, so the
 * create form and the edit form slowly stop being the same form.
 *
 * What actually varies is the title and the initial value, so that is what the
 * props are.
 */
export function RoleFormDialog({
  open,
  title,
  context,
  initial,
  template,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  /** The registry, governance, labels and copy the form reads. */
  context: Pick<RoleMenuContext, 'permissions' | 'governance' | 'labels' | 'copy'>;
  /** The role being edited, or null when composing a new one. */
  initial: RoleFormValue | null;
  /** True for a SEEDED role: an override, not a free edit. */
  template: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: RoleFormValue) => void;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      showCloseButton
      dataTestId="role-dialog"
    >
      {/* Mounted only while open, so each opening starts from a fresh
          selection rather than the previous role's. */}
      {open && (
        <DialogContent>
          <RoleForm
            permissions={context.permissions}
            governance={context.governance}
            labels={context.labels}
            copy={context.copy.roleForm}
            initial={initial}
            template={template}
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
