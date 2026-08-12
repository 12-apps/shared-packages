import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { useCan } from './context';

import type { RbacApiClient, TeamContextWire } from './api';
import type { RbacLabels } from './labels';
import { SearchField } from './search-field';
import {
  applyRoleChanges,
  splitRoleSelection,
  RoleEditDialog,
  type MemberWithRoles,
} from './team-role-dialog';
import { TeamTable } from './team-table';

/**
 * Equipe — the staff roster (12-13), ported from future-pay's
 * `apps/admin/src/pages/team/*`: the members grid, the unified role-edit
 * dialog (in `team-role-dialog.tsx`), enable/disable and remove. Same test
 * ids (`team-grid`, `team-search-all`, `team-actions-<userId>`,
 * `role-edit-dialog`) so the e2e specs moved with the screen.
 */

export { splitRoleSelection };

interface TeamScreenProps {
  api: RbacApiClient;
  labels: RbacLabels;
  /** The SYSTEM roles assignable as a member's base (owner tier excluded). */
  systemRoles: readonly string[];
  /** The owner tier — never disabled/removed from the roster. */
  ownerRoles?: readonly string[];
  managePermission: string;
}

/** The roster + context read, joined into rows with their custom roles. */
function useTeamPage(api: RbacApiClient, query: string): {
  rows: MemberWithRoles[] | null;
  context: TeamContextWire | null;
  loadError: string | null;
  refresh: () => void;
} {
  const [rows, setRows] = useState<MemberWithRoles[] | null>(null);
  const [context, setContext] = useState<TeamContextWire | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listTeam(query ? { q: query } : {}), api.teamContext()])
      .then(([page, teamContext]) => {
        if (cancelled) return;
        const customByMember = new Map(
          teamContext.customRolesByMember.map((entry) => [entry.userId, entry.roles]),
        );
        setRows(
          page.data.map((member) => ({
            ...member,
            customRoles: customByMember.get(member.userId) ?? [],
          })),
        );
        setContext(teamContext);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar a equipe.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, query, generation]);

  return {
    rows,
    context,
    loadError,
    refresh: useCallback(() => setGeneration((value) => value + 1), []),
  };
}

/** The accountless invites awaiting signup, when the host wires the port. */
function PendingInvites({
  context,
  labels,
}: {
  context: TeamContextWire | null;
  labels: RbacLabels;
}): JSX.Element | null {
  if (!context || context.pendingInvites.length === 0) return null;
  return (
    <Stack spacing={0.5}>
      <Text variant="caption" as="p" color="secondary">
        Convites pendentes
      </Text>
      {context.pendingInvites.map((invite) => (
        <Text key={invite.id} as="p">
          {invite.email} — {labels.roleLabel(invite.role)} (Pendente)
        </Text>
      ))}
    </Stack>
  );
}

export function TeamScreen(props: TeamScreenProps): JSX.Element {
  const { api, labels, systemRoles } = props;
  const can = useCan();
  const canManage = can(props.managePermission);
  const [query, setQuery] = useState('');
  const { rows, context, loadError, refresh } = useTeamPage(api, query);
  const [editing, setEditing] = useState<MemberWithRoles | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const ownerRoles = useMemo(
    () => new Set(props.ownerRoles ?? ['OWNER']),
    [props.ownerRoles],
  );
  const systemSet = useMemo(() => new Set(systemRoles), [systemRoles]);
  const availableCustomRoles = useMemo(
    () => (context?.assignableRoles ?? []).filter((name) => !systemSet.has(name)),
    [context, systemSet],
  );

  const saveRoles = async (roleNames: string[]): Promise<void> => {
    if (!editing) return;
    const { base, customRoles } = splitRoleSelection(roleNames, systemSet);
    if (!base) return; // the dialog blocks a save without exactly one system role
    setBusy(true);
    setEditError(null);
    const error = await applyRoleChanges(api, editing, base, customRoles);
    setBusy(false);
    if (error) {
      setEditError(error);
      return;
    }
    setEditing(null);
    refresh();
  };

  return (
    <Stack spacing={2}>
      <Text variant="heading" size="lg" as="h1">
        Equipe
      </Text>
      <SearchField placeholder="Buscar membro" testId="team-search-all" onCommit={setQuery} />
      {loadError && <Text as="p">{loadError}</Text>}
      {rows && (
        <TeamTable
          rows={rows}
          labels={labels}
          canManage={canManage}
          ownerRoles={ownerRoles}
          onEditRoles={setEditing}
          onToggleActive={(member) => {
            void api.setMemberActive(member.userId, !member.active).then((result) => {
              if (result.ok) refresh();
            });
          }}
          onRemove={(member) => {
            void api.removeMember(member.userId).then((result) => {
              if (result.ok) refresh();
            });
          }}
        />
      )}
      <PendingInvites context={context} labels={labels} />
      <RoleEditDialog
        member={editing}
        systemRoles={systemRoles}
        availableCustomRoles={availableCustomRoles}
        labels={labels}
        busy={busy}
        error={editError}
        onClose={() => setEditing(null)}
        onSave={(roleNames) => void saveRoles(roleNames)}
      />
    </Stack>
  );
}
