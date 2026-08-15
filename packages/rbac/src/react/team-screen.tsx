import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { Alert } from '@12-apps/ui/data-display/Alert';

import { useCan } from './context';

import type { RbacApiClient, TeamContextWire } from './api';
import type { RbacLabels } from './labels';
import { ConfirmDialog } from './confirm-dialog';
import { SearchField } from './search-field';
import { useConfirmable } from './use-confirmable';
import {
  applyRoleChanges,
  splitRoleSelection,
  RoleEditDialog,
  type MemberWithRoles,
} from './team-role-dialog';
import { TeamTable } from './team-table';

/**
 * Equipe — the staff roster (12-13), ported from the origin host's
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
  /**
   * The owner tier — never disabled/removed from the roster; the rows whose
   * kebab hides "Desativar" and "Remover".
   *
   * REQUIRED, with no `['OWNER']` fallback. `createWebRbac` passes
   * `catalog.governance.ownerRoles`, but a host is invited to route this
   * screen itself, and a default meant such a host rendered destructive
   * affordances on rows the server then refuses — the screen and the endpoints
   * disagreeing about who an owner is, which is precisely what one composed
   * catalog exists to prevent.
   */
  ownerRoles: readonly string[];
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

/**
 * The role-edit popup's state + save orchestration — the origin host's
 * `use-role-editor.ts`, hookified against the packaged api client: the base
 * change and the custom-role diff map onto the EXISTING endpoints, so no new
 * server surface exists for the dialog.
 */
function useRoleEditor(
  api: RbacApiClient,
  systemSet: ReadonlySet<string>,
  refresh: () => void,
): {
  editing: MemberWithRoles | null;
  busy: boolean;
  error: string | null;
  open: (member: MemberWithRoles) => void;
  close: () => void;
  save: (roleNames: string[]) => Promise<void>;
} {
  const [editing, setEditing] = useState<MemberWithRoles | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    editing,
    busy,
    error,
    open: setEditing,
    close: () => setEditing(null),
    async save(roleNames) {
      if (!editing) return;
      const { base, customRoles } = splitRoleSelection(roleNames, systemSet);
      if (!base) return; // the dialog blocks a save without exactly one system role
      setBusy(true);
      setError(null);
      const failure = await applyRoleChanges(api, editing, base, customRoles);
      setBusy(false);
      setError(failure);
      if (!failure) {
        setEditing(null);
        refresh();
      }
    },
  };
}

/** The confirm step for the roster's one destructive act. */
function RemoveConfirm({
  removal,
}: {
  removal: ReturnType<typeof useConfirmable<MemberWithRoles>>;
}): JSX.Element {
  return (
    <ConfirmDialog
      open={removal.pending !== null}
      title="Remover da equipe?"
      body="A pessoa perde o acesso ao painel imediatamente."
      confirmLabel="Remover"
      busy={removal.busy}
      onConfirm={() => void removal.confirm()}
      onCancel={removal.cancel}
    />
  );
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
  const [toggleError, setToggleError] = useState<string | null>(null);
  const removal = useConfirmable<MemberWithRoles>(
    (member) => api.removeMember(member.userId),
    refresh,
  );
  const actionError = removal.error ?? toggleError;

  const toggleActive = async (member: MemberWithRoles): Promise<void> => {
    const result = await api.setMemberActive(member.userId, !member.active);
    // A refused flip (e.g. "Não é possível desativar um proprietário.")
    // must SAY so, not render nothing.
    setToggleError(result.ok ? null : result.error);
    if (result.ok) refresh();
  };

  const ownerRoles = useMemo(() => new Set(props.ownerRoles), [props.ownerRoles]);
  const systemSet = useMemo(() => new Set(systemRoles), [systemRoles]);
  const availableCustomRoles = useMemo(
    () => (context?.assignableRoles ?? []).filter((name) => !systemSet.has(name)),
    [context, systemSet],
  );
  const editor = useRoleEditor(api, systemSet, refresh);

  return (
    <Stack spacing={2}>
      <Text variant="heading" size="lg" as="h1">
        Equipe
      </Text>
      <SearchField placeholder="Buscar membro" testId="team-search-all" onCommit={setQuery} />
      {loadError && <Text as="p">{loadError}</Text>}
      {actionError && (
        <Alert variant="danger" description={actionError} data-testid="team-error" />
      )}
      {rows && (
        <TeamTable
          rows={rows}
          labels={labels}
          canManage={canManage}
          ownerRoles={ownerRoles}
          onEditRoles={editor.open}
          onToggleActive={(member) => void toggleActive(member)}
          onRemove={removal.request}
        />
      )}
      <PendingInvites context={context} labels={labels} />
      <RemoveConfirm removal={removal} />
      <RoleEditDialog
        member={editor.editing}
        systemRoles={systemRoles}
        availableCustomRoles={availableCustomRoles}
        labels={labels}
        busy={editor.busy}
        error={editor.error}
        onClose={editor.close}
        onSave={(roleNames) => void editor.save(roleNames)}
      />
    </Stack>
  );
}
