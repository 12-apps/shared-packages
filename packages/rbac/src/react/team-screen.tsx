'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useServerDataViews } from '@12-apps/app-shell/react';
import { DataViewsCopyProvider } from '@12-apps/ui/data-display/DataViews';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dashboard } from '@12-apps/ui/layout/Dashboard';

import type { RbacApiClient } from './api';
import { useCan } from './context';
import type { RbacWebCopy } from './copy';
import type { RbacLabels } from './labels';
import {
  buildTeamRowActions,
  teamQueryToParams,
  teamSearch,
  teamSyncState,
  type TeamRow,
} from './team-grid-config';
import { RoleEditDialog } from './team-role-dialog';
import type { TeamExtraColumn } from './team-grid-config';
import {
  HeaderControls,
  InviteDialog,
  TeamBanners,
  TeamBody,
  type InviteRoleOptions,
  type RefusalAction,
} from './team-screen-parts';
import {
  useCancelInviteConfirm,
  useRemoveConfirm,
  useRoleEditor,
  useTeamActions,
} from './use-team-actions';
import { useTeamData } from './use-team-data';

/**
 * Equipe — the staff roster, on the shared server-driven grid: the URL params
 * ARE the query, a unified read-only roles column beside status, a ⋮ kebab per
 * row and per card, and the invite flow.
 *
 * Test ids (`team-grid`, `team-actions-<userId>`, `role-edit-dialog`,
 * `invite-dialog`, `status-<userId>`) are the surface the packaged e2e journeys
 * drive, and they are ids rather than sentences precisely so a host that words
 * the screen differently still runs them.
 */

export interface TeamScreenProps {
  api: RbacApiClient;
  labels: RbacLabels;
  /** Columns this package cannot build. See {@link TeamExtraColumn}. */
  extraColumns?: readonly TeamExtraColumn[];
  /**
   * Which ⋮ entries this host offers, by id. Absent, all of them.
   *
   * Ids: `edit-roles`, `toggle-active`, `remove`, `cancel-invite`.
   */
  rowActionIds?: readonly string[];
  /** The SYSTEM roles assignable as a member's base (owner tier excluded). */
  systemRoles: readonly string[];
  /**
   * The owner tier — never disabled or removed from the roster.
   *
   * REQUIRED, with no `['OWNER']` fallback: a default meant a host routing this
   * screen itself rendered destructive affordances on rows the server then
   * refuses, which is the screen and the endpoints disagreeing about who an
   * owner is.
   */
  ownerRoles: readonly string[];
  managePermission: string;
  /**
   * The role ticked when the invite dialog opens (the inviter may tick any
   * number of others).
   *
   * STATED rather than derived from `systemRoles[0]`, because this default
   * decides what access somebody gets when the inviter does not touch the
   * picker — and inferring that from the catalog's array order would move it
   * silently the day a template is reordered. Falls back to the first system
   * role only so a host that has not answered still renders a valid form.
   */
  defaultInviteRole?: string;
  copy: RbacWebCopy;
  /** The crumbs above the title. The host owns its own information hierarchy. */
  breadcrumb?: readonly { label: string; href?: string }[];
  /** Open one member's profile. Absent when the host routes no profile screen. */
  onOpenMember?: (userId: string) => void;
  /**
   * The host asks for the invite dialog — its own "Adicionar à equipe" entry,
   * elsewhere in its chrome, landing here. While true the dialog opens (for a
   * viewer who may manage the team; nobody else has a dialog to open) and
   * {@link onInviteRequestHandled} fires, so the host can drop whatever carried
   * the request (a URL param) and a reload does not reopen it.
   */
  inviteRequested?: boolean;
  onInviteRequestHandled?: () => void;
  /**
   * The way out of a refused add, rendered inside the dialog's refusal
   * (FUT-3137) — e.g. an upgrade button for a plan denial. See
   * {@link RefusalAction}.
   */
  refusalAction?: RefusalAction;
}

/**
 * Honour a host's {@link TeamScreenProps.inviteRequested}. A viewer who may not
 * manage the team gets the request acknowledged and nothing opened: the button
 * is not theirs either.
 */
function useInviteRequest(
  props: TeamScreenProps,
  canManage: boolean,
  actions: ReturnType<typeof useTeamActions>,
): void {
  const { inviteRequested, onInviteRequestHandled } = props;
  const { openForm } = actions;
  useEffect(() => {
    if (!inviteRequested) return;
    if (canManage) openForm();
    onInviteRequestHandled?.();
  }, [inviteRequested, canManage, openForm, onInviteRequestHandled]);
}

/**
 * The roster's derived vocabulary, its role editor, its two confirm popups and
 * the ⋮ entries built from all of them.
 *
 * One hook rather than six statements in the screen, because they are one
 * thing: the actions are what the confirms and the editor are FOR, and the
 * owner and system sets exist only to shape them. Splitting them across the
 * component body was six lines of the size gate spent on plumbing.
 */
function useRosterControls(
  props: TeamScreenProps,
  data: ReturnType<typeof useTeamData>,
  actions: ReturnType<typeof useTeamActions>,
): {
  customRoles: string[];
  inviteRoles: InviteRoleOptions;
  editor: ReturnType<typeof useRoleEditor>;
  removeConfirm: ReturnType<typeof useRemoveConfirm>;
  cancelInviteConfirm: ReturnType<typeof useCancelInviteConfirm>;
  rowActions: ReturnType<typeof buildTeamRowActions>;
} {
  const { copy } = props;
  const systemSet = useMemo(() => new Set(props.systemRoles), [props.systemRoles]);
  const ownerSet = useMemo(() => new Set(props.ownerRoles), [props.ownerRoles]);
  const customRoles = useMemo(
    () => (data.context?.assignableRoles ?? []).filter((name) => !systemSet.has(name)),
    [data.context, systemSet],
  );
  const editor = useRoleEditor(props.api, data.refresh, actions.setError);
  const removeConfirm = useRemoveConfirm(actions, copy);
  const cancelInviteConfirm = useCancelInviteConfirm(actions, copy);
  // Rebuilt per render rather than memoised on identity: the handlers close
  // over `actions`, and a memo keyed on it would keep a stale closure the first
  // time one of those functions is recreated.
  const rowActions = buildTeamRowActions(
    {
      openRoleEdit: editor.open,
      toggleActive: (row) => void actions.toggleActive(row),
      remove: (row) => removeConfirm.request([row]),
      cancelInvite: (row) => cancelInviteConfirm.request([row]),
    },
    ownerSet,
    copy.teamRowMenu,
    props.rowActionIds,
  );
  return {
    customRoles,
    inviteRoles: {
      system: props.systemRoles,
      custom: customRoles,
      ...(props.defaultInviteRole ? { opening: props.defaultInviteRole } : {}),
    },
    editor,
    removeConfirm,
    cancelInviteConfirm,
    rowActions,
  };
}

/** What the screen renders INSTEAD of the roster, or null when it is ready. */
function rosterGate(
  data: ReturnType<typeof useTeamData>,
  copy: RbacWebCopy,
): JSX.Element | null {
  if (data.loading) return <LoadingState dataTestId="team-loading" />;
  if (data.error !== null) {
    return (
      <ErrorState
        title={copy.teamScreen.loadFailed}
        message={data.error}
        retryLabel={copy.teamScreen.retryAction}
        onRetry={data.refresh}
      />
    );
  }
  return null;
}

/**
 * The grid's URL-driven controls and its server paging, split out of the screen
 * at the size gate. The controls are re-derived on every address-bar change so
 * browser back/forward re-applies search, pills and sort; the grid merges them
 * over its own state, so column visibility is never disturbed.
 */
function useTeamGridSync(
  searchParams: URLSearchParams,
  pagination: ReturnType<typeof useTeamData>['pagination'],
) {
  const syncState = useMemo(() => teamSyncState(searchParams), [searchParams]);
  const server = useServerDataViews({
    totalCount: pagination?.total ?? 0,
    page: pagination?.page ?? 1,
    pageSize: pagination?.pageSize ?? 20,
    toParams: teamQueryToParams,
  });
  return { syncState, server };
}

export function TeamScreen(props: TeamScreenProps): JSX.Element {
  const { api, labels, copy } = props;
  const canManage = useCan()(props.managePermission);
  const [searchParams] = useSearchParams();
  const search = teamSearch(searchParams);
  const data = useTeamData(api, search, copy.teamScreen.loadFailed);
  const actions = useTeamActions(api, copy, data.refresh);
  useInviteRequest(props, canManage, actions);
  const [visibleRows, setVisibleRows] = useState<TeamRow[]>([]);

  const { customRoles, inviteRoles, editor, removeConfirm, cancelInviteConfirm, rowActions } =
    useRosterControls(props, data, actions);

  const { syncState, server } = useTeamGridSync(searchParams, data.pagination);

  const blocked = rosterGate(data, copy);
  if (blocked) return blocked;

  return (
    // The grid, its toolbar and its saved-view dialogs read their words from
    // here: `@12-apps/ui` ships none and throws rather than falling back.
    <DataViewsCopyProvider copy={copy.dataViews}>
      <Dashboard testIdPrefix="team-dashboard">
        {props.breadcrumb && <Dashboard.Breadcrumb items={[...props.breadcrumb]} />}
        <Dashboard.Header title={copy.teamScreen.title}>
          <HeaderControls
            rows={visibleRows}
            labels={labels}
            copy={copy}
            canManage={canManage}
            onInvite={actions.toggleForm}
          />
        </Dashboard.Header>
        {canManage && (
          <InviteDialog
            actions={actions}
            copy={copy}
            labels={labels}
            roles={inviteRoles}
            refusalAction={props.refusalAction}
          />
        )}
        <Dashboard.Body>
          <TeamBanners actions={actions} copy={copy} onOpenMember={props.onOpenMember} />
          <TeamBody
            rows={data.rows}
            labels={labels}
            copy={copy}
            systemRoles={props.systemRoles}
            customRoles={customRoles}
            canManage={canManage}
            rowActions={rowActions}
            server={server}
            syncState={syncState}
            onVisibleRowsChange={setVisibleRows}
            onOpenMember={props.onOpenMember}
            extraColumns={props.extraColumns}
          />
        </Dashboard.Body>
        {removeConfirm.dialog}
        {cancelInviteConfirm.dialog}
        <RoleEditDialog
          member={editor.editing}
          systemRoles={props.systemRoles}
          availableCustomRoles={customRoles}
          labels={labels}
          copy={copy.teamRoleDialog}
          busy={editor.busy}
          error={null}
          onClose={editor.close}
          onSave={(roleNames) => void editor.save(roleNames)}
        />
      </Dashboard>
    </DataViewsCopyProvider>
  );
}

