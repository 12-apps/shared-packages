'use client';

import { useMemo, type ComponentType, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import AddIcon from '@mui/icons-material/Add';

import { useServerDataViews } from '@12-apps/app-shell/react';
import { CardActionsProvider } from '@12-apps/ui/data-display/CardKit';
import {
  DataViewsCopyProvider,
  DataViewsGrid,
  type RowAction,
} from '@12-apps/ui/data-display/DataViews';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { HeaderButton } from '@12-apps/ui/form/HeaderButton';
import { Dashboard } from '@12-apps/ui/layout/Dashboard';
import { Text } from '@12-apps/ui/typography/Text';

import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

import type { RbacApiClient } from './api';
import { useCan } from './context';
import type { RbacWebCopy } from './copy';
import type { RbacLabels } from './labels';
import { RoleActionsMenu, type RoleMenuContext } from './role-actions-menu';
import { RoleCard } from './role-card';
import { RoleFormDialog } from './role-form-dialog';
import { useRoleWrite } from './use-role-write';
import {
  roleCells,
  RoleListCard,
} from './role-list-card';
import {
  roleColumns,
  roleFields,
  rolesQueryToParams,
  rolesSearch,
  rolesSyncState,
  type RoleRow,
  type RoleSeedDefault,
} from './role-grid-config';
import { useRolesData } from './use-roles-data';

/**
 * Papéis — the tenant role catalog: the seeded system roles plus the tenant's
 * own, as a grid, a card grade or a list. Per-row actions live in the
 * self-contained {@link RoleActionsMenu} shared by every layout; the screen
 * keeps the create flow and the row-click navigation.
 *
 * Test ids (`roles-grid`, `add-role-button`, `role-dialog`,
 * `role-actions-<id>`) are the surface the packaged e2e journeys drive.
 */

export interface RolesScreenProps {
  api: RbacApiClient;
  /**
   * The tenant every action in this screen acts inside.
   *
   * REQUIRED because `CardActionsProvider`'s contract asks for it, and its
   * contract is right to: the row menus below it are self-contained, so a menu
   * entry a host adds later reads the tenant from context rather than being
   * drilled it through the grid, the layout and the card. This package's own
   * entries never read it — its api client is already tenant-scoped through
   * `apiBase` — which is exactly why it must be stated rather than inferred:
   * there is nothing here to catch a wrong value.
   */
  tenantSlug: string;
  permissions: Pick<PermissionRegistry<string>, 'list' | 'kind'>;
  governance: Pick<GovernanceCatalog, 'ownerPermissions' | 'sodPairs'>;
  labels: RbacLabels;
  /** The gate permission for the write affordances AND for the screen itself. */
  managePermission: string;
  copy: RbacWebCopy;
  /**
   * The catalog seed defaults, keyed by role name — what a seeded row is
   * compared against to decide whether it has been edited. Empty is legal and
   * means no row ever reads as edited, which is the safe direction.
   */
  seeds: ReadonlyMap<string, RoleSeedDefault>;
  breadcrumb?: readonly { label: string; href?: string }[];
  /** Show who holds this role. Absent when the host routes no roster screen. */
  onOpenMembers?: (roleName: string) => void;
  /** See {@link RoleMenuContext.renderVersionHistory}. */
  renderVersionHistory?: RoleMenuContext['renderVersionHistory'];
  /**
   * The host's own multi-select surface for this grid.
   *
   * A COMPONENT rather than a list of actions, and rendered INSIDE this
   * screen's `CardActionsProvider`, because a bulk surface is three things that
   * have to share one piece of state: the "Ações" entries, whatever chrome
   * reports what a batch did, and the reload afterwards. Handing the package a
   * bare `RowAction[]` would leave the host holding the other two somewhere
   * else, with no way to reach this screen's own refresh.
   *
   * From in here the slot can call `useCardActions()` — the same
   * `onRefresh` the row menus already use, so a batch reloads the grid exactly
   * as a single-row delete does — and its hooks run unconditionally, which a
   * render prop invoked after this screen's permission gate could not promise.
   *
   * It receives the grid as a render prop so its actions reach the toolbar:
   * render `children(actions)` wherever the grid belongs, and put the chrome
   * around that.
   *
   * Absent — the default — the grid renders exactly as it did before this
   * existed: no multi-select entries, no chrome.
   */
  bulkSlot?: ComponentType<RolesBulkSlotProps>;
}

/** What {@link RolesScreenProps.bulkSlot} is handed. */
export interface RolesBulkSlotProps {
  /** Render the grid, giving it the multi-select entries it should offer. */
  children: (actions: readonly RowAction<RoleRow>[]) => JSX.Element;
}

/** The grid, split out so the screen body stays inside the size gate. */
function RolesBody({
  rows,
  copy,
  context,
  canManage,
  server,
  syncState,
  onOpenMembers,
  bulkActions,
}: {
  rows: RoleRow[];
  copy: RbacWebCopy;
  context: RoleMenuContext;
  canManage: boolean;
  /** The host's multi-select entries, when a `bulkSlot` supplied any. */
  bulkActions?: readonly RowAction<RoleRow>[];
  server: ReturnType<typeof useServerDataViews>;
  syncState: ReturnType<typeof rolesSyncState>;
  onOpenMembers?: (roleName: string) => void;
}): JSX.Element {
  return (
    <DataViewsGrid<RoleRow>
      inlineFilters
      rows={rows}
      columns={roleColumns(copy.rolesTable)}
      fields={roleFields(copy.rolesTable)}
      syncState={syncState}
      getRowId={(row) => row.id}
      // Gated on `canManage` like the row menu beside it: a reader who may not
      // manage roles must not be offered a batch that would be refused.
      rowActions={canManage && bulkActions?.length ? [...bulkActions] : undefined}
      onRowClick={onOpenMembers ? (row) => onOpenMembers(row.name) : undefined}
      renderRowMenu={canManage ? (row) => <RoleActionsMenu row={row} context={context} /> : undefined}
      renderCard={(row, selection) => (
        <RoleCard row={row} selection={selection} context={context} />
      )}
      renderListRow={(row, selection) => (
        <RoleListCard row={row} selection={selection} context={context} />
      )}
      listGroup={{ cells: roleCells(copy.rolesTable) }}
      dataTestId="roles-grid"
      testIdPrefix="roles"
      server={server}
      emptyState={
        <Text variant="body" as="p">
          {copy.rolesList.emptyState}
        </Text>
      }
    />
  );
}

/**
 * The ambient config every row and card menu below the grid reads. Memoised on
 * its parts rather than rebuilt per render: it is passed to components that
 * hold popups open, and a new object each render remounts them mid-edit.
 */
function useMenuContext(props: RolesScreenProps): RoleMenuContext {
  const { api, permissions, governance, labels, copy, managePermission, renderVersionHistory } =
    props;
  return useMemo(
    () => ({ api, permissions, governance, labels, copy, managePermission, renderVersionHistory }),
    [api, permissions, governance, labels, copy, managePermission, renderVersionHistory],
  );
}

/**
 * What the screen renders INSTEAD of the catalog, or null when the catalog is
 * ready.
 *
 * The refusal case is first and answers with a neutral not-found rather than a
 * refusal, mirroring the endpoints: "you may not" and "there is nothing here"
 * are deliberately the same sentence there, so the screen may not reveal more.
 */
function rolesGate({
  canManage,
  data,
  copy,
}: {
  canManage: boolean;
  data: ReturnType<typeof useRolesData>;
  copy: RbacWebCopy;
}): JSX.Element | null {
  if (!canManage) {
    return (
      <EmptyState
        variant="minimal"
        title={copy.rolesList.forbiddenTitle}
        description={copy.rolesList.forbiddenBody}
        dataTestId="roles-not-found"
      />
    );
  }
  if (data.loading) return <LoadingState dataTestId="roles-loading" />;
  if (data.error !== null) {
    return (
      <ErrorState
        title={copy.rolesList.loadFailed}
        message={data.error}
        retryLabel={copy.rolesList.retryAction}
        onRetry={data.refresh}
      />
    );
  }
  return null;
}

export function RolesScreen(props: RolesScreenProps): JSX.Element {
  const { api, copy } = props;
  const canManage = useCan()(props.managePermission);
  const [searchParams] = useSearchParams();
  const search = rolesSearch(searchParams);
  const data = useRolesData(api, search, props.seeds, copy.rolesList.loadFailed, canManage);
  const create = useRoleWrite((value) => api.createRole(value), data.refresh);

  const syncState = useMemo(() => rolesSyncState(searchParams), [searchParams]);
  const server = useServerDataViews({
    totalCount: data.pagination?.total ?? 0,
    page: data.pagination?.page ?? 1,
    pageSize: data.pagination?.pageSize ?? 20,
    toParams: rolesQueryToParams,
  });
  const context = useMenuContext(props);

  const blocked = rolesGate({ canManage, data, copy });
  if (blocked) return blocked;

  return (
    <DataViewsCopyProvider copy={copy.dataViews}>
      <Dashboard testIdPrefix="roles-dashboard">
        {props.breadcrumb && <Dashboard.Breadcrumb items={[...props.breadcrumb]} />}
        <Dashboard.Header title={copy.rolesList.title}>
          <Dashboard.Info title={copy.rolesList.aboutTitle}>
            {copy.rolesList.aboutBody}
          </Dashboard.Info>
          <Dashboard.Spacer />
          <Dashboard.Action>
            <HeaderButton
              text={copy.rolesList.newRoleAction}
              icon={<AddIcon fontSize="small" />}
              onClick={create.start}
              dataTestId="add-role-button"
            />
          </Dashboard.Action>
        </Dashboard.Header>
        <Dashboard.Body>
          <CardActionsProvider
            errorDismissLabel={copy.closeLabel}
            errorTitle={copy.actionErrorTitle}
            tenantSlug={props.tenantSlug}
            onRefresh={data.refresh}
          >
            <RolesGrid
              bulkSlot={props.bulkSlot}
              render={(bulkActions) => (
                <RolesBody
                  rows={data.rows}
                  copy={copy}
                  context={context}
                  canManage={canManage}
                  server={server}
                  syncState={syncState}
                  onOpenMembers={props.onOpenMembers}
                  bulkActions={bulkActions}
                />
              )}
            />
          </CardActionsProvider>
        </Dashboard.Body>
        <RoleFormDialog
          open={create.open}
          title={copy.rolesList.dialogTitles.create}
          context={context}
          initial={null}
          template={false}
          busy={create.busy}
          error={create.error}
          onClose={create.close}
          onSubmit={(value) => void create.submit(value)}
        />
      </Dashboard>
    </DataViewsCopyProvider>
  );
}

/**
 * The grid, through the host's bulk slot when there is one.
 *
 * Two branches rather than a default slot that renders `children([])`: the slot
 * is a COMPONENT, so an always-present one would mount host state on every
 * roles screen including the hosts that declined the feature, and this package
 * cannot know what that state costs. No slot means the grid renders exactly as
 * it did before `bulkSlot` existed.
 */
function RolesGrid({
  bulkSlot: Slot,
  render,
}: {
  bulkSlot?: ComponentType<RolesBulkSlotProps>;
  render: (actions?: readonly RowAction<RoleRow>[]) => JSX.Element;
}): JSX.Element {
  if (!Slot) return render();
  return <Slot>{(actions) => render(actions)}</Slot>;
}
