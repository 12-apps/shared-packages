import type { RoleAssignment } from '../core/types';

import { GLOBAL_SCOPE } from './context';
import type { RbacMembershipGrant, RbacResourceGrant, RbacSubjectGrants } from './grants';

/**
 * The effective-grants table (`rbac_effective_grants`, FUT-3985): a person's
 * resolved RBAC, one row per person and scope, so reading all of it is ONE
 * statement — `WHERE user_id = $1`.
 *
 * The package's triggers never compute a row. They mark it `stale` (inserting
 * it stale when missing), bump its `version` and notify. This module is the
 * other half: it reads the rows, and when any is stale it recomputes the
 * person through the resolver the engine uses anyway (`loadSubjectGrants`), so
 * the role rule lives in one place. The result is written back only where the
 * row's `version` still matches what was read, so a change committed during
 * the recompute leaves the row stale for the next read instead of being
 * overwritten by an answer that predates it.
 *
 * The table is complete by construction — every trigger inserts the row it
 * marks, and the migration backfills the rest — so a person with no rows holds
 * nothing, and that answer costs the same single read.
 */

/** The columns the read selects. */
export const EFFECTIVE_GRANT_SELECT = {
  scope: true,
  membershipRole: true,
  membershipActive: true,
  assignments: true,
  resources: true,
  stale: true,
  version: true,
} as const;

/** One row, as the read returns it. The JSON columns are checked, not trusted. */
export interface EffectiveGrantRow {
  scope: string;
  membershipRole: string | null;
  membershipActive: boolean | null;
  assignments: unknown;
  resources: unknown;
  stale: boolean;
  version: number;
}

/** One role assignment as a row stores it: its scope is the row's. */
export interface StoredAssignment {
  role: string;
  permissions?: readonly string[] | '*';
}

/** What a recompute writes into a row. */
export interface EffectiveGrantData {
  membershipRole: string | null;
  membershipActive: boolean | null;
  assignments: StoredAssignment[];
  resources: RbacResourceGrant[];
  stale: false;
  computedAt: Date;
}

/**
 * The Prisma-shaped slice of the `rbacEffectiveGrant` delegate this module
 * uses — closed argument shapes, like every other seam in `./db`.
 */
export interface RbacEffectiveGrantDelegate {
  findMany(args: {
    where: { userId: string };
    select: typeof EFFECTIVE_GRANT_SELECT;
  }): Promise<EffectiveGrantRow[]>;
  updateMany(args: {
    where: { userId: string; scope: string; version: number };
    data: EffectiveGrantData;
  }): Promise<{ count: number }>;
  createMany(args: {
    data: (EffectiveGrantData & { userId: string; scope: string })[];
    skipDuplicates: true;
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: { userId: string; scope: string; version: number };
  }): Promise<{ count: number }>;
}

/** Deferred, as every other database seam here. */
export type RbacEffectiveGrantTable = () => Promise<RbacEffectiveGrantDelegate>;

/**
 * Resource grants a HOST derives from its own tables while a person is
 * recomputed — a waiter's mesas through the sectors their open shift covers,
 * say. They are stored with the person's rows and judged against the clock
 * like any other grant. The host's own triggers must mark the person stale
 * (`rbac_grants_mark(user_id, scope)`) whenever a table they read changes, or
 * a derived grant outlives its source until the backstop.
 */
export type RbacDeriveGrants = (
  subject: string,
  grants: RbacSubjectGrants,
  now: Date,
) => Promise<readonly RbacResourceGrant[]>;

export interface EffectiveGrantsReadOptions {
  table: RbacEffectiveGrantTable;
  /** The package resolver, bound to the host's database (`loadSubjectGrants`). */
  resolve: (subject: string, now: Date) => Promise<RbacSubjectGrants>;
  derive?: RbacDeriveGrants;
  /** A write-back that failed: the answer is still returned, the row stays stale. */
  onError?: (message: string) => void;
}

/** The scope a resource grant's row is kept under. */
const scopeOfResource = (grant: RbacResourceGrant): string => grant.clientId ?? GLOBAL_SCOPE;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseAssignments(value: unknown): StoredAssignment[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: StoredAssignment[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { role, permissions } = entry as { role?: unknown; permissions?: unknown };
    if (typeof role !== 'string') return null;
    if (permissions === undefined) parsed.push({ role });
    else if (permissions === '*' || isStringArray(permissions)) parsed.push({ role, permissions });
    else return null;
  }
  return parsed;
}

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

function parseResource(entry: unknown): RbacResourceGrant | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { resourceType, resourceId, clientId, validFrom, validTo } = entry as Record<string, unknown>;
  if (typeof resourceType !== 'string' || typeof resourceId !== 'string') return null;
  if (clientId !== null && typeof clientId !== 'string') return null;
  if (!isInstant(validFrom) || (validTo !== null && !isInstant(validTo))) return null;
  return { resourceType, resourceId, clientId, validFrom, validTo };
}

function parseResources(value: unknown): RbacResourceGrant[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = (value as unknown[]).map(parseResource);
  return parsed.every((grant): grant is RbacResourceGrant => grant !== null) ? parsed : null;
}

interface ParsedRow {
  scope: string;
  membership: RbacMembershipGrant | null;
  assignments: StoredAssignment[];
  resources: RbacResourceGrant[];
}

/** A current row, parsed — or `null` when it is stale or does not parse. */
function parseRow(row: EffectiveGrantRow): ParsedRow | null {
  if (row.stale) return null;
  const assignments = parseAssignments(row.assignments);
  const resources = parseResources(row.resources);
  if (assignments === null || resources === null) return null;
  const membership =
    row.membershipRole === null
      ? null
      : { clientId: row.scope, role: row.membershipRole, active: row.membershipActive ?? false };
  return { scope: row.scope, membership, assignments, resources };
}

/** The subject's grants, put back together from current rows. */
export function grantsFromRows(rows: readonly ParsedRow[]): RbacSubjectGrants {
  const assignments: RoleAssignment[] = rows.flatMap((row) =>
    row.assignments.map((stored) =>
      stored.permissions === undefined
        ? { role: stored.role, scope: row.scope }
        : { role: stored.role, scope: row.scope, permissions: stored.permissions },
    ),
  );
  return {
    assignments,
    resources: rows.flatMap((row) => row.resources),
    memberships: rows.flatMap((row) => (row.membership ? [row.membership] : [])),
  };
}

/** A subject's grants, split into the rows they are kept as. */
export function rowsFromGrants(grants: RbacSubjectGrants): Map<string, ParsedRow> {
  const rows = new Map<string, ParsedRow>();
  const rowAt = (scope: string): ParsedRow => {
    const existing = rows.get(scope);
    if (existing) return existing;
    const created: ParsedRow = { scope, membership: null, assignments: [], resources: [] };
    rows.set(scope, created);
    return created;
  };
  for (const membership of grants.memberships ?? []) rowAt(membership.clientId).membership = membership;
  for (const assignment of grants.assignments) {
    // A scope is a string key in every assignment this package resolves.
    const scope = String(assignment.scope);
    const stored: StoredAssignment =
      assignment.permissions === undefined
        ? { role: assignment.role }
        : { role: assignment.role, permissions: assignment.permissions as readonly string[] | '*' };
    rowAt(scope).assignments.push(stored);
  }
  for (const resource of grants.resources) rowAt(scopeOfResource(resource)).resources.push(resource);
  return rows;
}

function dataOf(row: ParsedRow, now: Date): EffectiveGrantData {
  return {
    membershipRole: row.membership?.role ?? null,
    membershipActive: row.membership?.active ?? null,
    assignments: row.assignments,
    resources: row.resources,
    stale: false,
    computedAt: now,
  };
}

/** Recompute a subject and write the rows back where their version still holds. */
async function recompute(
  options: EffectiveGrantsReadOptions,
  table: RbacEffectiveGrantDelegate,
  subject: string,
  read: readonly EffectiveGrantRow[],
  now: Date,
): Promise<RbacSubjectGrants> {
  const resolved = await options.resolve(subject, now);
  const derived = options.derive ? await options.derive(subject, resolved, now) : [];
  const grants: RbacSubjectGrants = { ...resolved, resources: [...resolved.resources, ...derived] };
  const fresh = rowsFromGrants(grants);
  const known = new Set(read.map((row) => row.scope));
  const writes: Promise<unknown>[] = [];
  for (const row of read) {
    if (!row.stale && parseRow(row) !== null) continue;
    const next = fresh.get(row.scope);
    const where = { userId: subject, scope: row.scope, version: row.version };
    writes.push(next ? table.updateMany({ where, data: dataOf(next, now) }) : table.deleteMany({ where }));
  }
  const created = [...fresh.values()].filter((row) => !known.has(row.scope));
  if (created.length > 0) {
    writes.push(
      table.createMany({
        data: created.map((row) => ({ userId: subject, scope: row.scope, ...dataOf(row, now) })),
        skipDuplicates: true,
      }),
    );
  }
  const failed = (await Promise.allSettled(writes)).filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    options.onError?.(
      `[rbac-effective-grants] ${failed.length} write-back(s) for ${subject} failed; the rows stay stale: ${String(
        (failed[0] as PromiseRejectedResult).reason,
      )}`,
    );
  }
  return grants;
}

/**
 * A subject's grants from the effective-grants table: ONE read when every row
 * is current, and a recompute through `resolve` when any row is stale.
 */
export async function readEffectiveGrants(
  options: EffectiveGrantsReadOptions,
  subject: string,
  now: Date = new Date(),
): Promise<RbacSubjectGrants> {
  const table = await options.table();
  const read = await table.findMany({ where: { userId: subject }, select: EFFECTIVE_GRANT_SELECT });
  const parsed = read.map(parseRow);
  if (parsed.every((row): row is ParsedRow => row !== null)) return grantsFromRows(parsed);
  return recompute(options, table, subject, read, now);
}
