import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import type {
  DataViewColumn,
  DataViewQuery,
  DataViewSyncState,
  FilterFieldConfig,
  RowAction,
} from '@12-apps/ui/data-display/DataViews';
import { Stack } from '@12-apps/ui/mui/Stack';
import type { ColorValue } from '@12-apps/ui/tokens';
import type { ExportColumn } from '@12-apps/ui/utils';

import type { TeamRowMenuCopy, TeamTableCopy } from './copy';
import type { RbacLabels } from './labels';

/**
 * The roster grid's configuration — columns, filter facets, export columns and
 * the URL⇄query mapping — plus the per-row kebab. Pure config: the
 * `<DataViewsGrid>` render itself stays in `team-screen.tsx`.
 *
 * Everything here is parameterised by the host's copy and labels. That is not
 * ceremony: a facet's OPTION VALUES are wire values the backend parses
 * (`role_in=ADMIN`, `status_in=PENDING`) while its option LABELS are words a
 * person reads, and the origin host had them interleaved in one literal per
 * facet. Separating them is what lets the same grid serve a host that spells
 * `Ativo` and one that spells `Active` over the identical query string.
 */

/** A member's row status: enabled, soft-disabled, or a not-yet-accepted invite. */
export type MemberRowStatus = 'ENABLED' | 'DISABLED' | 'PENDING';

/**
 * A tenant staff member OR a pending accountless invite rendered as a roster
 * row. For a PENDING row `userId` is the synthetic `invite:<id>` key,
 * `inviteId` carries the real invite id (for cancel), and the role controls are
 * inert.
 */
export interface TeamRow extends Record<string, unknown> {
  userId: string;
  role: string;
  email: string;
  name: string | null;
  /** Tenant custom roles this member holds, additive to their base role. */
  customRoles: string[];
  status: MemberRowStatus;
  /** The pending-invite id for a PENDING row; null for real members. */
  inviteId: string | null;
}

/** The Chip colour token per row status (semantic, not per-theme literals). */
const STATUS_COLOR: Record<MemberRowStatus, ColorValue> = {
  ENABLED: 'success',
  DISABLED: 'danger',
  PENDING: 'warning',
};

/** The status labels in the fixed key order the facet and the cells share. */
function statusLabels(copy: TeamTableCopy): Record<MemberRowStatus, string> {
  return {
    ENABLED: copy.status.active,
    DISABLED: copy.status.disabled,
    PENDING: copy.status.pending,
  };
}

/**
 * The roster's filter facets: ONE unified roles multi-select over the base
 * SYSTEM roles plus the tenant's custom roles — matching a member on their base
 * role OR any custom role — and a status facet.
 *
 * @param systemRoles The assignable base roles, from the host's catalog. The
 * origin host hard-coded a seven-name `STAFF_ROLE_NAMES` array beside a catalog
 * that already listed them, which is a second source for the same fact.
 */
export function teamFields(
  systemRoles: readonly string[],
  customRoles: readonly string[],
  labels: RbacLabels,
  copy: TeamTableCopy,
): FilterFieldConfig<TeamRow>[] {
  const status = statusLabels(copy);
  return [
    {
      id: 'roles',
      label: copy.filters.roles,
      control: 'multiselect',
      searchEnabled: true,
      accessor: (row) => [row.role, ...row.customRoles],
      options: [
        ...systemRoles.map((name) => ({ value: name, label: labels.roleLabel(name) })),
        ...customRoles.map((name) => ({ value: name, label: name })),
      ],
    },
    {
      id: 'status',
      label: copy.filters.status,
      control: 'multiselect',
      accessor: (row) => row.status,
      options: (Object.keys(status) as MemberRowStatus[]).map((key) => ({
        value: key,
        label: status[key],
      })),
    },
  ];
}

/** The list itself (emitted as REPEATED params), or undefined when empty. */
function listParam(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

/**
 * Map the grid's query onto the roster's backend params. Omitted keys clear
 * their param from the URL rather than lingering as `?q=`.
 *
 * The two lists are REPEATED params (`?role_in=a&role_in=b`) rather than one
 * comma-joined value, because a custom role name is free-form and may contain a
 * comma — which would silently split one name into two filters.
 */
export function teamQueryToParams(
  query: DataViewQuery,
): Record<string, string | string[] | undefined> {
  const sort = query.sortBy[0];
  return {
    q: query.search || undefined,
    page: query.page > 1 ? String(query.page) : undefined,
    sort: sort && sort.dir ? `${sort.id}:${sort.dir}` : undefined,
    role_in: listParam(query.pills.roles),
    status_in: listParam(query.pills.status),
  };
}

/** The params the roster OWNS — everything else in the URL is somebody else's. */
const OWNED_PARAMS = ['q', 'page', 'sort', 'role_in', 'status_in'] as const;

/** The roster's query string for a URL, repeated keys preserved. */
export function teamSearch(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of OWNED_PARAMS) {
    params
      .getAll(key)
      .filter(Boolean)
      .forEach((value) => query.append(key, value));
  }
  return query.toString();
}

/** The filter pills encoded in the URL. */
function teamPillsFromParams(params: URLSearchParams): Record<string, string[]> {
  const pills: Record<string, string[]> = {};
  const roles = params.getAll('role_in').filter(Boolean);
  if (roles.length > 0) pills.roles = roles;
  const status = params.getAll('status_in').filter(Boolean);
  if (status.length > 0) pills.status = status;
  return pills;
}

/**
 * Derive the URL-driven grid controls from the address bar, so a deep-linked
 * filtered roster is reflected on first render AND re-applied on later
 * same-route navigation (browser back/forward). Column visibility is not
 * URL-carried and is deliberately absent, so re-applying this never disturbs a
 * reader's hidden columns.
 */
export function teamSyncState(params: URLSearchParams): DataViewSyncState {
  const [sortField, sortDir] = (params.get('sort') ?? '').split(':');
  const sortBy: DataViewSyncState['sortBy'] =
    sortField && sortDir ? [{ id: sortField, dir: sortDir === 'desc' ? 'desc' : 'asc' }] : [];
  return { search: params.get('q') ?? '', pills: teamPillsFromParams(params), ranges: {}, sortBy };
}

export function teamExportColumns(
  labels: RbacLabels,
  copy: TeamTableCopy,
): ExportColumn<TeamRow>[] {
  const status = statusLabels(copy);
  return [
    { header: copy.exportHeaders.name, value: (row) => row.name ?? row.email },
    { header: copy.exportHeaders.email, value: (row) => row.email },
    { header: copy.exportHeaders.role, value: (row) => labels.roleLabel(row.role) },
    { header: copy.exportHeaders.customRoles, value: (row) => row.customRoles.join(', ') },
    { header: copy.exportHeaders.status, value: (row) => status[row.status] },
  ];
}

/**
 * The unified roles cell: the base role as a filled chip plus each additive
 * custom role outlined. A PENDING invite shows only the role it WILL grant on
 * signup, outlined — it is not active yet, and a filled chip would say it was.
 */
function RolesCell({ row, labels }: { row: TeamRow; labels: RbacLabels }): JSX.Element {
  const pending = row.status === 'PENDING';
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      <Chip
        label={labels.roleLabel(row.role)}
        size="sm"
        variant={pending ? 'outlined' : 'filled'}
        color={pending ? 'neutral' : 'primary'}
      />
      {row.customRoles.map((role) => (
        <Chip key={role} label={role} size="sm" variant="outlined" color="neutral" />
      ))}
    </Stack>
  );
}

/** The status chip, with a semantic colour rather than a per-status literal. */
function StatusCell({ row, copy }: { row: TeamRow; copy: TeamTableCopy }): JSX.Element {
  return (
    <Chip
      label={statusLabels(copy)[row.status]}
      size="sm"
      variant="outlined"
      color={STATUS_COLOR[row.status]}
      data-testid={`status-${row.userId}`}
    />
  );
}

/** The read-only roster columns; every mutation lives in the ⋮ kebab. */
export function teamColumns(labels: RbacLabels, copy: TeamTableCopy): DataViewColumn<TeamRow>[] {
  return [
    {
      id: 'name',
      header: copy.headers.name,
      accessor: (row) => row.name ?? row.email,
      searchable: true,
    },
    { id: 'email', header: copy.headers.email, accessor: 'email', searchable: true },
    {
      id: 'customRoles',
      header: copy.headers.roles,
      enableSort: false,
      accessor: (row) => [labels.roleLabel(row.role), ...row.customRoles].join(', '),
      cell: ({ row }) => <RolesCell row={row} labels={labels} />,
    },
    {
      id: 'status',
      header: copy.headers.status,
      enableSort: false,
      accessor: (row) => statusLabels(copy)[row.status],
      cell: ({ row }) => <StatusCell row={row} copy={copy} />,
    },
  ];
}

/** What the ⋮ kebab entries call — all owned by the screen. */
export interface TeamRowActionHandlers {
  openRoleEdit: (row: TeamRow) => void;
  toggleActive: (row: TeamRow) => void;
  /**
   * Remove a member. Takes the ROW rather than an id: the act is confirm-gated
   * and the popup names the person whose access it is about to revoke.
   */
  remove: (row: TeamRow) => void;
  /** Cancel a pending accountless invite. Takes the row, for the same reason. */
  cancelInvite: (row: TeamRow) => void;
}

/**
 * The per-row ⋮ kebab. Real members get edit-roles / enable-disable / remove; a
 * pending invite gets only cancel. An owner-tier member is owner-protected —
 * never disabled or removed from here, matching what the endpoints refuse.
 *
 * @param ownerRoles The protected tier, from the host's governance catalog.
 * REQUIRED with no `['OWNER']` fallback: a default would render destructive
 * affordances on rows the server then refuses, which is the screen and the
 * endpoints disagreeing about who an owner is.
 */
export function buildTeamRowActions(
  handlers: TeamRowActionHandlers,
  ownerRoles: ReadonlySet<string>,
  copy: TeamRowMenuCopy,
): RowAction<TeamRow>[] {
  const isMember = (row: TeamRow): boolean => row.status !== 'PENDING';
  const editable = (row: TeamRow): boolean => isMember(row) && !ownerRoles.has(row.role);
  return [
    {
      id: 'edit-roles',
      label: copy.editRoles,
      bulk: false,
      isVisible: editable,
      onSelect: (rows) => rows.forEach(handlers.openRoleEdit),
    },
    {
      id: 'toggle-active',
      label: copy.deactivate,
      bulk: false,
      isVisible: editable,
      rowLabel: (row) => (row.status === 'DISABLED' ? copy.activate : copy.deactivate),
      onSelect: (rows) => rows.forEach(handlers.toggleActive),
    },
    {
      id: 'remove',
      label: copy.remove,
      color: 'danger',
      bulk: false,
      isVisible: editable,
      onSelect: (rows) => rows.forEach(handlers.remove),
    },
    {
      id: 'cancel-invite',
      label: copy.cancelInvite,
      color: 'danger',
      bulk: false,
      isVisible: (row) => !isMember(row),
      onSelect: (rows) => rows.forEach((row) => row.inviteId && handlers.cancelInvite(row)),
    },
  ];
}
