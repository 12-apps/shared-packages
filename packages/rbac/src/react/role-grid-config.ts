import type {
  DataViewColumn,
  DataViewQuery,
  DataViewSyncState,
  FilterFieldConfig,
} from '@12-apps/ui/data-display/DataViews';

import type { RoleListRowWire } from './api';
import type { RolesTableCopy } from './copy';

/**
 * The role catalog's grid configuration and the row shape both layouts share.
 *
 * The interesting field is `overridden`, and it is computed rather than sent: a
 * seeded role is "edited" when its EFFECTIVE permissions or description have
 * drifted from the catalog seed it was materialised from — and the seed is host
 * config this package is handed, not something the endpoint knows to compare
 * against. Getting it wrong in the safe direction (never "edited") is why the
 * origin host's own row mapper returned false for an unknown name.
 */

/** A role as shown in the catalog grid. `permissions` is the EFFECTIVE set. */
export interface RoleRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly string[] | '*';
  /** `template` = a seeded system role; `custom` = tenant-composed. */
  kind: 'template' | 'custom';
  system: boolean;
  /** A seeded row edited away from its catalog default. */
  overridden: boolean;
  /** Whether this row may be edited at all (an owner-tier role never is). */
  editable: boolean;
}

/**
 * A seeded role's catalog default, keyed by name — the single source every
 * tenant's rows are materialised from.
 */
export interface RoleSeedDefault {
  permissions: readonly string[] | '*';
  description: string;
}

/** True when a seeded role's permissions or description drift from its seed. */
function driftedFromSeed(record: RoleListRowWire, seed: RoleSeedDefault | undefined): boolean {
  // An unknown seeded name has no default to compare against, so it is never
  // reported as edited — it renders as a plain system row.
  if (!seed) return false;
  const actual = record.permissions;
  const drifted =
    actual === '*' || seed.permissions === '*'
      ? actual !== seed.permissions
      : actual.length !== seed.permissions.length ||
        actual.some((permission) => !(seed.permissions as readonly string[]).includes(permission));
  return drifted || (record.description ?? '') !== seed.description;
}

/** Map one wire row into the grid's row shape, against the host's seeds. */
export function toRoleRow(
  record: RoleListRowWire,
  seeds: ReadonlyMap<string, RoleSeedDefault>,
): RoleRow {
  const system = record.kind === 'SYSTEM';
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    permissions: record.permissions,
    kind: system ? 'template' : 'custom',
    system,
    overridden: system && driftedFromSeed(record, seeds.get(record.name)),
    editable: !record.locked,
  };
}

/** How many permissions a role grants — a wildcard is stated, never counted. */
export function permissionCount(
  permissions: RoleRow['permissions'],
  copy: RolesTableCopy,
): string {
  // `String('*').length` would report a role granting EVERYTHING as granting one
  // thing, which is the most dangerous possible understatement on this screen.
  return permissions === '*' ? copy.allPermissions : String(permissions.length);
}

/** The kind label: seeded, seeded-and-edited, or tenant-composed. */
export function roleKindLabel(row: RoleRow, copy: RolesTableCopy): string {
  if (!row.system) return copy.kinds.custom;
  return row.overridden ? copy.kinds.systemEdited : copy.kinds.system;
}

/**
 * The single kind facet. Option VALUES are the backend's `kind` enum, mapped
 * straight onto `kind_in`; the labels are the host's words. The accessor reports
 * a row's own kind for the chip match — in server mode the backend filters.
 */
export function roleFields(copy: RolesTableCopy): FilterFieldConfig<RoleRow>[] {
  return [
    {
      id: 'kind',
      label: copy.kindFilter,
      control: 'multiselect',
      accessor: (row) => (row.system ? 'SYSTEM' : 'CUSTOM'),
      options: [
        { value: 'SYSTEM', label: copy.kinds.system },
        { value: 'CUSTOM', label: copy.kinds.custom },
      ],
    },
  ];
}

export function roleColumns(copy: RolesTableCopy): DataViewColumn<RoleRow>[] {
  return [
    { id: 'name', header: copy.headers.name, accessor: 'name', searchable: true },
    {
      id: 'description',
      header: copy.headers.description,
      accessor: (row) => row.description ?? copy.emptyValue,
      searchable: true,
    },
    {
      id: 'kind',
      header: copy.headers.kind,
      enableSort: false,
      accessor: (row) => roleKindLabel(row, copy),
    },
    {
      id: 'permissions',
      header: copy.headers.permissions,
      enableSort: false,
      accessor: (row) => permissionCount(row.permissions, copy),
    },
  ];
}

/** Map the grid's query onto the catalog's backend params. */
export function rolesQueryToParams(
  query: DataViewQuery,
): Record<string, string | string[] | undefined> {
  const sort = query.sortBy[0];
  const kinds = query.pills.kind;
  return {
    q: query.search || undefined,
    page: query.page > 1 ? String(query.page) : undefined,
    sort: sort && sort.dir ? `${sort.id}:${sort.dir}` : undefined,
    kind_in: kinds && kinds.length > 0 ? kinds : undefined,
  };
}

/** The params the catalog OWNS — everything else in the URL is somebody else's. */
const OWNED_PARAMS = ['q', 'page', 'sort', 'kind_in'] as const;

/** The catalog's query string for a URL, repeated keys preserved. */
export function rolesSearch(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of OWNED_PARAMS) {
    params
      .getAll(key)
      .filter(Boolean)
      .forEach((value) => query.append(key, value));
  }
  return query.toString();
}

/** Derive the URL-driven grid controls from the address bar. */
export function rolesSyncState(params: URLSearchParams): DataViewSyncState {
  const [sortField, sortDir] = (params.get('sort') ?? '').split(':');
  const sortBy: DataViewSyncState['sortBy'] =
    sortField && sortDir ? [{ id: sortField, dir: sortDir === 'desc' ? 'desc' : 'asc' }] : [];
  const kinds = params.getAll('kind_in').filter(Boolean);
  return {
    search: params.get('q') ?? '',
    pills: kinds.length > 0 ? { kind: kinds } : {},
    ranges: {},
    sortBy,
  };
}
