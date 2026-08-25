'use client';

import { useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import AddIcon from '@mui/icons-material/Add';

import { useServerDataViews } from '@12-apps/app-shell/react';
import { CardActionsProvider } from '@12-apps/ui/data-display/CardKit';
import { DataViewsCopyProvider, DataViewsGrid } from '@12-apps/ui/data-display/DataViews';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
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
import { RoleForm, type RoleFormValue } from './role-form';
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
}

/** The create popup. Edit, reset and delete all live in the row/card menu. */
function CreateDialog({
  open,
  screen,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  screen: RolesScreenProps;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: RoleFormValue) => void;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={screen.copy.rolesList.dialogTitles.create}
      size="md"
      showCloseButton
      dataTestId="role-dialog"
    >
      {open && (
        <DialogContent>
          <RoleForm
            permissions={screen.permissions}
            governance={screen.governance}
            labels={screen.labels}
            copy={screen.copy.roleForm}
            initial={null}
            template={false}
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

/** The grid, split out so the screen body stays inside the size gate. */
function RolesBody({
  rows,
  copy,
  context,
  canManage,
  server,
  syncState,
  onOpenMembers,
}: {
  rows: RoleRow[];
  copy: RbacWebCopy;
  context: RoleMenuContext;
  canManage: boolean;
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

/** The create flow's state and its one write. */
function useCreateRole(
  api: RbacApiClient,
  refresh: () => void,
): {
  open: boolean;
  busy: boolean;
  error: string | null;
  start: () => void;
  close: () => void;
  submit: (value: RoleFormValue) => Promise<void>;
} {
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
      const result = await api.createRole(value);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      refresh();
    },
  };
}

export function RolesScreen(props: RolesScreenProps): JSX.Element {
  const { api, copy } = props;
  const canManage = useCan()(props.managePermission);
  const [searchParams] = useSearchParams();
  const search = rolesSearch(searchParams);
  const data = useRolesData(api, search, props.seeds, copy.rolesList.loadFailed, canManage);
  const create = useCreateRole(api, data.refresh);

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
            <RolesBody
              rows={data.rows}
              copy={copy}
              context={context}
              canManage={canManage}
              server={server}
              syncState={syncState}
              onOpenMembers={props.onOpenMembers}
            />
          </CardActionsProvider>
        </Dashboard.Body>
        <CreateDialog
          open={create.open}
          screen={props}
          busy={create.busy}
          error={create.error}
          onClose={create.close}
          onSubmit={(value) => void create.submit(value)}
        />
      </Dashboard>
    </DataViewsCopyProvider>
  );
}

