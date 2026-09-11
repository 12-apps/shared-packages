'use client';

import type { JSX } from 'react';

import AddIcon from '@mui/icons-material/Add';

import type { useServerDataViews } from '@12-apps/app-shell/react';
import { Alert } from '@12-apps/ui/data-display/Alert';
import { DataViewsGrid, type RowAction } from '@12-apps/ui/data-display/DataViews';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { HeaderButton } from '@12-apps/ui/form/HeaderButton';
import { Dashboard } from '@12-apps/ui/layout/Dashboard';
import { Text } from '@12-apps/ui/typography/Text';
import { exportRows } from '@12-apps/ui/utils';

import type { RbacWebCopy } from './copy';
import type { RbacLabels } from './labels';
import { TeamActionsMenu } from './team-actions-menu';
import { TeamCard } from './team-card';
import {
  teamColumns,
  teamExportColumns,
  teamFields,
  teamSyncState,
  type TeamRow,
} from './team-grid-config';
import { TeamInviteForm } from './team-invite-form';
import type { TeamActions } from './use-team-actions';

/**
 * The roster screen's chrome — the header controls, the banners, the invite
 * popup and the grid. Split from `team-screen.tsx` so that file stays inside
 * the size gate; nothing here holds state of its own.
 */

/** The header's explainer, export and invite affordance. */
export function HeaderControls({
  rows,
  labels,
  copy,
  canManage,
  onInvite,
}: {
  rows: TeamRow[];
  labels: RbacLabels;
  copy: RbacWebCopy;
  canManage: boolean;
  onInvite: () => void;
}): JSX.Element {
  return (
    <>
      <Dashboard.Info title={copy.teamScreen.aboutTitle}>
        {copy.teamScreen.aboutBody}
      </Dashboard.Info>
      <Dashboard.Spacer />
      <Dashboard.Export
        formats={[
          { id: 'csv', label: 'CSV (.csv)' },
          { id: 'json', label: 'JSON (.json)' },
        ]}
        onExport={(format) =>
          exportRows(
            format === 'json' ? 'json' : 'csv',
            rows,
            teamExportColumns(labels, copy.teamTable),
            copy.teamScreen.exportFileName,
          )
        }
      />
      {canManage && (
        <Dashboard.Action>
          <HeaderButton
            text={copy.teamScreen.inviteAction}
            icon={<AddIcon fontSize="small" />}
            onClick={onInvite}
            dataTestId="add-admin-button"
          />
        </Dashboard.Action>
      )}
    </>
  );
}

/** The closable banners over the roster: the deferred-grant notice and errors. */
export function TeamBanners({ actions, copy }: { actions: TeamActions; copy: RbacWebCopy }): JSX.Element {
  return (
    <>
      {actions.notice && (
        <Alert
          closeLabel={copy.closeLabel}
          variant="success"
          title={copy.teamScreen.inviteDeferredTitle}
          description={copy.teamScreen.inviteDeferredBody}
          closable
          onClose={actions.dismissNotice}
          data-testid="team-invite-notice"
        />
      )}
      {actions.error && (
        <Alert
          closeLabel={copy.closeLabel}
          variant="danger"
          title={copy.teamScreen.errorTitle}
          description={actions.error}
          closable
          onClose={() => actions.setError(null)}
          data-testid="team-error"
        />
      )}
    </>
  );
}

/** The invite popup, opened from the header action. */
/**
 * What the invite form may hand out — ONE prop rather than three.
 *
 * Grouped because the three travel together everywhere and because the screen
 * that passes them sits on an 80-line ceiling: spreading them cost six lines of
 * its budget on plumbing that carries no decision.
 */
export interface InviteRoleOptions {
  system: readonly string[];
  custom: readonly string[];
  /**
   * The host's stated opening role. The fallback to the first system role
   * resolves HERE rather than in the screen: it is a property of this form, and
   * leaving it upstream spent two branches of the screen's complexity budget on
   * a default nothing else reads.
   */
  opening?: string;
}

export function InviteDialog({
  actions,
  copy,
  labels,
  roles,
}: {
  actions: TeamActions;
  copy: RbacWebCopy;
  labels: RbacLabels;
  roles: InviteRoleOptions;
}): JSX.Element {
  const opening = roles.opening ?? roles.system[0] ?? '';
  return (
    <Dialog
      open={actions.showForm}
      onClose={actions.toggleForm}
      title={copy.teamScreen.inviteDialogTitle}
      size="sm"
      showCloseButton
      dataTestId="invite-dialog"
    >
      {actions.showForm && (
        <DialogContent>
          <TeamInviteForm
            formKey={actions.formKey}
            copy={copy.teamScreen}
            labels={labels}
            systemRoles={roles.system}
            customRoles={roles.custom}
            defaultRole={opening}
            onSubmit={actions.invite}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The grid itself, split out so the screen body stays inside the size gate. */
export function TeamBody(props: {
  rows: TeamRow[];
  labels: RbacLabels;
  copy: RbacWebCopy;
  systemRoles: readonly string[];
  customRoles: readonly string[];
  canManage: boolean;
  rowActions: RowAction<TeamRow>[];
  server: ReturnType<typeof useServerDataViews>;
  syncState: ReturnType<typeof teamSyncState>;
  onVisibleRowsChange: (rows: TeamRow[]) => void;
  onOpenMember?: (userId: string) => void;
}): JSX.Element {
  const { copy, labels, canManage, rowActions } = props;
  const openProfile = props.onOpenMember
    ? (row: TeamRow): void => {
        if (row.status !== 'PENDING') props.onOpenMember?.(row.userId);
      }
    : undefined;
  return (
    <DataViewsGrid<TeamRow>
      inlineFilters
      rows={props.rows}
      columns={teamColumns(labels, copy.teamTable)}
      fields={teamFields(props.systemRoles, props.customRoles, labels, copy.teamTable)}
      syncState={props.syncState}
      getRowId={(row) => row.userId}
      onVisibleRowsChange={props.onVisibleRowsChange}
      rowActions={canManage ? rowActions : undefined}
      renderRowMenu={
        canManage
          ? (row) => (
              <TeamActionsMenu row={row} rowActions={rowActions} menuLabel={copy.menuLabel} />
            )
          : undefined
      }
      renderCard={(row, selection) => (
        <TeamCard
          row={row}
          selection={selection}
          rowActions={canManage ? rowActions : []}
          labels={labels}
          copy={copy.teamTable}
          menuLabel={copy.menuLabel}
          onOpen={openProfile}
        />
      )}
      onRowClick={openProfile}
      dataTestId="team-grid"
      testIdPrefix="team"
      server={props.server}
      emptyState={
        <Text variant="body" as="p">
          {copy.teamScreen.emptyState}
        </Text>
      }
    />
  );
}

