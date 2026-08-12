import type { TenantRoleSeed } from '../tenant-role-seeds';

import {
  RbacApiError,
  fencedAudit,
  messagesOf,
  paginationMeta,
  type PaginationMeta,
  type RbacAuditSink,
  type RbacMessages,
  type RbacServerConfig,
} from './context';
import {
  ROLE_SELECT,
  isUniqueViolation,
  type RbacDbClient,
  type RbacDbProvider,
  type RoleOrderBy,
  type RoleRow,
  type RoleWhere,
} from './db';
import { parseRolePermissions, serializeRolePermissions } from './permissions-format';
import { resetTemplateRole, upsertTemplateOverride } from './template-store';

/**
 * The tenant role store (12-13) — ported from future-pay's
 * `lib/repositories/role.ts` + `role-list.ts`, over the {@link RbacDbClient}
 * seam. All writes are scoped by `clientId`, so one tenant can never read or
 * mutate another's roles — and `clientId` is non-null on every filter, so the
 * seeded TEMPLATE rows (clientId NULL) are structurally out of reach here.
 * The template-override half lives in `template-store.ts`.
 */

/** A tenant role as read for the admin list/form. `permissions` is parsed. */
export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly string[] | '*';
}

/** One role row for the admin grid — plus the SYSTEM/lock markers. */
export interface RoleListRecord extends RoleRecord {
  kind: string;
  locked: boolean;
}

export interface RoleWriteInput {
  name: string;
  description: string | null;
  permissions: readonly string[] | '*';
}

/** The roles list query the wire accepts. */
export interface RoleListQuery {
  q?: string;
  kindIn?: readonly string[];
  sort?: { field: 'name' | 'createdAt'; direction: 'asc' | 'desc' };
  page: number;
  pageSize: number;
}

/** What every role operation shares — derived once from the config. */
export interface RolesStoreCtx {
  db: RbacDbProvider;
  audit: RbacAuditSink | undefined;
  messages: RbacMessages;
  templateNames: ReadonlySet<string>;
  tenantRoleSeeds: readonly TenantRoleSeed[];
}

export function toRoleRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: parseRolePermissions(row.permissions),
  };
}

/** A diffable audit snapshot of a role row. */
export function roleDiff(row: Pick<RoleRow, 'name' | 'description' | 'permissions'>): {
  name: string;
  description: string | null;
  permissions: string;
} {
  return { name: row.name, description: row.description, permissions: row.permissions };
}

/** Duplicate role name (unique violation) → a user-safe 409. */
function rethrowWriteError(ctx: RolesStoreCtx, error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new RbacApiError(409, ctx.messages.duplicateRoleName);
  }
  throw error;
}

/** Template names are reserved — a custom role can't shadow one. */
function assertNotTemplateName(ctx: RolesStoreCtx, name: string): void {
  if (ctx.templateNames.has(name)) {
    throw new RbacApiError(409, ctx.messages.reservedRoleName);
  }
}

async function getById(
  db: RbacDbClient,
  id: string,
  tenantId: string,
): Promise<RoleRecord | null> {
  // A soft-deleted (archived) role reads as gone here.
  const row = await db.role.findFirst({
    where: { id, clientId: tenantId, archivedAt: null },
    select: ROLE_SELECT,
  });
  return row ? toRoleRecord(row) : null;
}

function listWhere(tenantId: string, query: RoleListQuery): RoleWhere {
  return {
    clientId: tenantId,
    archivedAt: null,
    ...(query.kindIn && query.kindIn.length > 0 ? { kind: { in: [...query.kindIn] } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { description: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

async function listRolesPage(
  ctx: RolesStoreCtx,
  tenantId: string,
  query: RoleListQuery,
): Promise<{ data: RoleListRecord[]; pagination: PaginationMeta }> {
  const db = await ctx.db();
  const where = listWhere(tenantId, query);
  const orderBy: RoleOrderBy = query.sort
    ? query.sort.field === 'createdAt'
      ? { createdAt: query.sort.direction }
      : { name: query.sort.direction }
    : { name: 'asc' };
  const [rows, total] = await Promise.all([
    db.role.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: ROLE_SELECT,
    }),
    db.role.count({ where }),
  ]);
  return {
    data: rows.map((row) => ({ ...toRoleRecord(row), kind: row.kind, locked: row.locked })),
    pagination: paginationMeta(total, query.page, query.pageSize),
  };
}

async function createTenantRole(
  ctx: RolesStoreCtx,
  tenantId: string,
  input: RoleWriteInput,
): Promise<RoleRecord> {
  assertNotTemplateName(ctx, input.name);
  const db = await ctx.db();
  try {
    const created = await db.role.create({
      data: {
        clientId: tenantId,
        name: input.name,
        description: input.description,
        permissions: serializeRolePermissions(input.permissions),
        isTemplate: false,
      },
      select: ROLE_SELECT,
    });
    await ctx.audit?.({
      clientId: tenantId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: created.id,
      after: roleDiff(created),
    });
    return toRoleRecord(created);
  } catch (error) {
    return rethrowWriteError(ctx, error);
  }
}

async function updateTenantRole(
  ctx: RolesStoreCtx,
  id: string,
  tenantId: string,
  input: RoleWriteInput,
): Promise<RoleRecord | null> {
  assertNotTemplateName(ctx, input.name);
  const db = await ctx.db();
  try {
    const updated = await db.$transaction(async (tx) => {
      // `locked: false` is the last-line owner guard: a locked Owner role is
      // never editable through any path. `archivedAt: null` keeps a
      // soft-deleted role immutable (it lives in the bin).
      const before = await tx.role.findFirst({
        where: { id, clientId: tenantId, locked: false, archivedAt: null },
        select: ROLE_SELECT,
      });
      const result = await tx.role.updateMany({
        where: { id, clientId: tenantId, locked: false, archivedAt: null },
        data: {
          name: input.name,
          description: input.description,
          permissions: serializeRolePermissions(input.permissions),
        },
      });
      return result.count > 0 && before ? { before } : null;
    });
    if (!updated) return null;
    await ctx.audit?.({
      clientId: tenantId,
      action: 'role.update',
      resourceType: 'role',
      resourceId: id,
      before: roleDiff(updated.before),
      after: {
        name: input.name,
        description: input.description,
        permissions: serializeRolePermissions(input.permissions),
      },
    });
  } catch (error) {
    rethrowWriteError(ctx, error);
  }
  return getById(await ctx.db(), id, tenantId);
}

async function deleteTenantRole(
  ctx: RolesStoreCtx,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const db = await ctx.db();
  // The delete is an ARCHIVE, exactly like the future-pay route it ports
  // ("a DELETE soft-archives the role"): the row keeps its id and its
  // membership links, stops granting at runtime (every resolver read filters
  // `archived_at IS NULL`) and disappears from the grid — while a hard
  // `deleteMany` would CASCADE through `membership_roles` and destroy every
  // member's grant irreversibly. Restore surfaces belong to entity-lifecycle
  // (12-17); until a host mounts them, the archive is one UPDATE away from
  // recovery instead of gone. `locked: false` keeps an Owner role
  // unarchivable through every path; the tenant scope makes a wrong tenant a
  // 0-row no-op, and `archivedAt: null` makes a second delete idempotent-404.
  const deleted = await db.$transaction(async (tx) => {
    const before = await tx.role.findFirst({
      where: { id, clientId: tenantId, locked: false, archivedAt: null },
      select: ROLE_SELECT,
    });
    const result = await tx.role.updateMany({
      where: { id, clientId: tenantId, locked: false, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return result.count > 0 && before ? { before } : null;
  });
  if (!deleted) return false;
  await ctx.audit?.({
    clientId: tenantId,
    action: 'role.delete',
    resourceType: 'role',
    resourceId: id,
    before: roleDiff(deleted.before),
  });
  return true;
}

export interface RolesStore {
  listRolesPage(
    tenantId: string,
    query: RoleListQuery,
  ): Promise<{ data: RoleListRecord[]; pagination: PaginationMeta }>;
  getTenantRoleById(id: string, tenantId: string): Promise<RoleRecord | null>;
  listAssignableRoleNames(tenantId: string): Promise<string[]>;
  createTenantRole(tenantId: string, input: RoleWriteInput): Promise<RoleRecord>;
  updateTenantRole(id: string, tenantId: string, input: RoleWriteInput): Promise<RoleRecord | null>;
  deleteTenantRole(id: string, tenantId: string): Promise<boolean>;
  upsertTemplateOverride(
    tenantId: string,
    name: string,
    input: { description: string | null; permissions: readonly string[] | '*' },
  ): Promise<RoleRecord>;
  resetTemplateRole(tenantId: string, name: string): Promise<boolean>;
}

type RolesStoreConfig<P extends string> = Pick<
  RbacServerConfig<P>,
  'db' | 'audit' | 'messages' | 'tenantRoleSeeds' | 'roleTemplates'
>;

export function createRolesStore<P extends string>(config: RolesStoreConfig<P>): RolesStore {
  const ctx: RolesStoreCtx = {
    db: config.db,
    audit: fencedAudit(config.audit),
    messages: messagesOf(config),
    templateNames: new Set(config.roleTemplates.map((role) => role.name)),
    tenantRoleSeeds: config.tenantRoleSeeds,
  };
  return {
    listRolesPage: (tenantId, query) => listRolesPage(ctx, tenantId, query),
    getTenantRoleById: async (id, tenantId) => getById(await ctx.db(), id, tenantId),
    listAssignableRoleNames: async (tenantId) => {
      const db = await ctx.db();
      const rows = await db.role.findMany({
        // Locked Owner roles are never hand-assigned; archived aren't assignable.
        where: { clientId: tenantId, locked: false, archivedAt: null },
        orderBy: { name: 'asc' },
        select: ROLE_SELECT,
      });
      return rows.map((row) => row.name);
    },
    createTenantRole: (tenantId, input) => createTenantRole(ctx, tenantId, input),
    updateTenantRole: (id, tenantId, input) => updateTenantRole(ctx, id, tenantId, input),
    deleteTenantRole: (id, tenantId) => deleteTenantRole(ctx, id, tenantId),
    upsertTemplateOverride: (tenantId, name, input) =>
      upsertTemplateOverride(ctx, tenantId, name, {
        description: input.description,
        permissions: serializeRolePermissions(input.permissions),
      }),
    resetTemplateRole: (tenantId, name) => resetTemplateRole(ctx, tenantId, name),
  };
}
