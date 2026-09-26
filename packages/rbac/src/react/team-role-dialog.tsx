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
 * The role-edit popup (12-13): one checklist over EVERY role the tenant can
 * assign, system and custom alike.
 *
 * Person × role × tenant is a plain N×M×J relation. A member may hold any
 * number of roles — every system role at once, if that is what the store
 * decides — and nothing here ranks one of them as a "base". The save is a pure
 * grant/revoke diff over the per-role endpoints, so there is no new server
 * surface for it. Every sentence comes from the host's {@link TeamRoleDialogCopy}.
 */

export interface MemberWithRoles extends TeamMemberWire {
  customRoles: string[];
  /** Every role held — the set the editor opens on and diffs against. */
  roles: string[];
}

/**
 * Apply a selection as a pure diff over the per-role endpoints.
 *
 * Grants run BEFORE revokes: a member moving from one set to another is never
 * left, even for one request, holding fewer roles than either end state — which
 * is what keeps an owner-protection rule on the server from seeing a transient
 * member with no owner role.
 */
export async function applyRoleSet(
  api: RbacApiClient,
  member: MemberWithRoles,
  roleNames: readonly string[],
): Promise<string | null> {
  const toAdd = roleNames.filter((role) => !member.roles.includes(role));
  const toRemove = member.roles.filter((role) => !roleNames.includes(role));
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

/**
 * Whether a selection is savable.
 *
 * Any non-empty set is — one role, two, or all of them. Clearing the last role
 * would leave a person with no access at all, which is a REMOVAL rather than a
 * role edit, and the roster has its own affordance for that. Roles the editor
 * does not offer (an owner role, which only its own flow grants) still count:
 * they are held, and the save leaves them exactly as they are.
 */
function isSelectionValid(selected: ReadonlySet<string>, kept: readonly string[]): boolean {
  return selected.size > 0 || kept.length > 0;
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

/**
 * The editor's selection over the roles it OFFERS.
 *
 * Only what this editor offers is toggled here. Everything else the member
 * holds — an owner role, a name the host keeps out of the roster — is `kept`
 * and carried through the save untouched rather than silently revoked.
 */
function useRoleSelection(
  held: readonly string[],
  systemRoles: readonly string[],
  availableCustomRoles: readonly string[],
): {
  selected: ReadonlySet<string>;
  kept: readonly string[];
  valid: boolean;
  toggle: (name: string, checked: boolean) => void;
} {
  const offered = useMemo(
    () => new Set([...systemRoles, ...availableCustomRoles]),
    [systemRoles, availableCustomRoles],
  );
  const kept = useMemo(() => held.filter((name) => !offered.has(name)), [held, offered]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(held.filter((name) => offered.has(name))),
  );
  const valid = useMemo(() => isSelectionValid(selected, kept), [selected, kept]);
  const toggle = (name: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };
  return { selected, kept, valid, toggle };
}

/** The editor body — owns the selection state; mounts fresh per member. */
function RoleEditBody(props: RoleEditBodyProps): JSX.Element {
  const { member, systemRoles, availableCustomRoles, labels, copy, busy, error } = props;
  const { selected, kept, valid, toggle } = useRoleSelection(
    member.roles,
    systemRoles,
    availableCustomRoles,
  );

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
            description={copy.atLeastOneRole}
            data-testid="role-edit-invalid"
          />
        )}
        {error && <Alert variant="danger" description={error} data-testid="role-edit-error" />}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="text" onClick={props.onClose} disabled={busy}>
            {copy.cancelAction}
          </Button>
          <Button
            onClick={() => props.onSave([...kept, ...selected])}
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
