import { useMemo, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Checkbox } from '@12-apps/ui/form/Checkbox';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { RbacApiClient, TeamMemberWire } from './api';
import type { TeamRoleDialogCopy } from './copy';
import type { RbacLabels } from './labels';

/**
 * The unified role-edit popup (12-13) — ported from the origin host's
 * `role-edit-dialog.tsx` + `use-role-editor.ts`. One checklist over ALL
 * roles: exactly one SYSTEM role is the member's base, any custom picks are
 * additive; the save maps the diff onto the existing set-role +
 * grant/revoke endpoints, so no new server surface exists for it. Every
 * sentence comes from the host's {@link TeamRoleDialogCopy}.
 */

export interface MemberWithRoles extends TeamMemberWire {
  customRoles: string[];
}

/** Split a unified selection into the single base role + additive customs. */
export function splitRoleSelection(
  roleNames: readonly string[],
  systemRoles: ReadonlySet<string>,
): { base: string | null; customRoles: string[] } {
  const system = roleNames.filter((name) => systemRoles.has(name));
  const customRoles = roleNames.filter((name) => !systemRoles.has(name));
  return { base: system.length === 1 ? (system[0] as string) : null, customRoles };
}

/** Apply a selection onto the existing endpoints: base set + custom diff. */
export async function applyRoleChanges(
  api: RbacApiClient,
  member: MemberWithRoles,
  base: string,
  customRoles: string[],
): Promise<string | null> {
  if (base !== member.role) {
    const result = await api.setMemberRole(member.userId, base);
    if (!result.ok) return result.error;
  }
  const toAdd = customRoles.filter((role) => !member.customRoles.includes(role));
  const toRemove = member.customRoles.filter((role) => !customRoles.includes(role));
  for (const role of toAdd) {
    const result = await api.grantMemberRole(member.userId, role);
    if (!result.ok) return result.error;
  }
  for (const role of toRemove) {
    const result = await api.revokeMemberRole(member.userId, role);
    if (!result.ok) return result.error;
  }
  return null;
}

interface RoleEditBodyProps {
  member: MemberWithRoles;
  systemRoles: readonly string[];
  availableCustomRoles: readonly string[];
  labels: RbacLabels;
  copy: TeamRoleDialogCopy;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (roleNames: string[]) => void;
}

/** The editor body — owns the selection state; mounts fresh per member. */
function RoleEditBody(props: RoleEditBodyProps): JSX.Element {
  const { member, systemRoles, availableCustomRoles, labels, copy, busy, error } = props;
  const systemSet = useMemo(() => new Set(systemRoles), [systemRoles]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([member.role, ...member.customRoles]),
  );
  const valid = useMemo(
    () => [...selected].filter((name) => systemSet.has(name)).length === 1,
    [selected, systemSet],
  );

  const toggle = (name: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const group = (
    title: string,
    names: readonly string[],
    labelFor: (name: string) => string,
  ): JSX.Element => (
    <div>
      <Text variant="caption" as="p" color="secondary">
        {title}
      </Text>
      <Stack>
        {names.map((name) => (
          <Checkbox
            key={name}
            label={labelFor(name)}
            checked={selected.has(name)}
            disabled={busy}
            data-testid={`role-opt-${name}`}
            onChange={(_event, checked) => toggle(name, checked)}
          />
        ))}
      </Stack>
    </div>
  );

  return (
    <DialogContent>
      <Stack spacing={2}>
        {group(copy.systemGroupTitle, systemRoles, labels.roleLabel)}
        {availableCustomRoles.length > 0 &&
          group(copy.customGroupTitle, availableCustomRoles, (name) => name)}
        {!valid && (
          <Alert
            variant="warning"
            description={copy.exactlyOneSystemRole}
            data-testid="role-edit-invalid"
          />
        )}
        {error && <Alert variant="danger" description={error} data-testid="role-edit-error" />}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="text" onClick={props.onClose} disabled={busy}>
            {copy.cancelAction}
          </Button>
          <Button
            onClick={() => props.onSave([...selected])}
            disabled={!valid || busy}
            dataTestId="role-edit-save"
          >
            {copy.saveAction}
          </Button>
        </Stack>
      </Stack>
    </DialogContent>
  );
}

interface RoleEditDialogProps extends Omit<RoleEditBodyProps, 'member'> {
  /** The member being edited, or null when the dialog is closed. */
  member: MemberWithRoles | null;
}

export function RoleEditDialog(props: RoleEditDialogProps): JSX.Element {
  const { member, copy, onClose } = props;
  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={member ? copy.title(member.name ?? member.email) : copy.fallbackTitle}
      size="sm"
      showCloseButton
      dataTestId="role-edit-dialog"
    >
      {member && <RoleEditBody {...props} member={member} />}
    </Dialog>
  );
}
