import type { TenantRoleSeed } from '../tenant-role-seeds';

import {
  RbacApiError,
  fencedAudit,
  messagesOf,
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
  type RoleRow,
} from './db';
import { parseRolePermissions, serializeRolePermissions } from './permissions-format';
import { createRoleDisplay, type RoleDisplay, type RoleDisplayWords } from './role-display';
import { listRolesPage } from './roles-list';
import { resetTemplateRole, templateSeedFor, upsertTemplateOverride } from './template-store';

/**
 * The tenant role store (12-13) — ported from the origin host's
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

/**
 * One role row for the admin grid — the stored fields, the SYSTEM/lock markers,
 * and the words this reader sees.
 *
 * `name` and `description` stay the STORED values: the row menus act on the
 * name, and the grid compares the description against the host's seed to decide
 * whether a seeded row reads as edited. The display pair is what a person
 * reads, and what the `q` and `sort` below are applied to. See
 * `./role-display.ts` for which is which and why both travel.
 */
export interface RoleListRecord extends RoleRecord, RoleDisplayWords {
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
  /** This reader's words for a row — resolved per call, never per store. */
  display: RoleDisplay;
  /** The reader's tag, for the collation the name sort orders by. */
  locale: string | undefined;
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
  // The delete is an ARCHIVE, exactly like the origin host route it ports
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

/**
 * The tenant role catalog's reads and writes.
 *
 * Every method that can REFUSE takes a trailing optional `locale` — the
 * caller's language, forwarded by whatever holds the request. Last and optional
 * because it is not part of what the method does: omit it and the refusal takes
 * the default rendering of the host's `messages`, which is a single-audience
 * host's whole behaviour. Reads that answer no sentence of their own do not
 * take one.
 */
export interface RolesStore {
  /**
   * @param locale The reader's tag. It picks the role words on every row AND
   * the collation the name sort uses, so a caller that omits it gets the
   * catalog's own words — which is exactly what a single-audience host wants.
   */
  listRolesPage(
    tenantId: string,
    query: RoleListQuery,
    locale?: string,
  ): Promise<{ data: RoleListRecord[]; pagination: PaginationMeta }>;
  getTenantRoleById(id: string, tenantId: string): Promise<RoleRecord | null>;
  listAssignableRoleNames(tenantId: string): Promise<string[]>;
  createTenantRole(tenantId: string, input: RoleWriteInput, locale?: string): Promise<RoleRecord>;
  updateTenantRole(
    id: string,
    tenantId: string,
    input: RoleWriteInput,
    locale?: string,
  ): Promise<RoleRecord | null>;
  deleteTenantRole(id: string, tenantId: string, locale?: string): Promise<boolean>;
  upsertTemplateOverride(
    tenantId: string,
    name: string,
    input: { description: string | null; permissions: readonly string[] | '*' },
    locale?: string,
  ): Promise<RoleRecord>;
  resetTemplateRole(tenantId: string, name: string, locale?: string): Promise<boolean>;
  /**
   * The permission set {@link RolesStore.resetTemplateRole} would WRITE for
   * template `name` — the seeded catalog default, parsed — or null when nothing
   * is seeded under it (the reset is then the idempotent no-op). Read by the
   * reset route so governance judges the exact set the write lands, and by any
   * host surface that wants to show what "restore default" would do.
   */
  templateSeedPermissions(name: string): readonly string[] | '*' | null;
}

type RolesStoreConfig<P extends string> = Pick<
  RbacServerConfig<P>,
  'db' | 'audit' | 'messages' | 'catalog'
>;

export function createRolesStore<P extends string>(config: RolesStoreConfig<P>): RolesStore {
  const base = {
    db: config.db,
    audit: fencedAudit(config.audit),
    templateNames: new Set(config.catalog.roleTemplates.map((role) => role.name)),
    tenantRoleSeeds: config.catalog.tenantRoleSeeds,
  };
  /**
   * The context for ONE call, with that caller's words already chosen. Built
   * per call rather than once per store: this store lives for the process, so a
   * `messages` resolved here would answer every reader in the language the
   * process started with. Everything below still reads `ctx.messages` as a
   * plain value.
   */
  const ctxFor = (locale?: string): RolesStoreCtx => ({
    ...base,
    messages: messagesOf(config, locale),
    // Resolved here for the same reason `messages` is: the catalog's label
    // merge is lazy precisely so it can be asked once per reader.
    display: createRoleDisplay(config.catalog, base.tenantRoleSeeds, locale),
    locale,
  });
  const ctx = ctxFor();
  return {
    listRolesPage: (tenantId, query, locale) => listRolesPage(ctxFor(locale), tenantId, query),
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
    createTenantRole: (tenantId, input, locale) =>
      createTenantRole(ctxFor(locale), tenantId, input),
    updateTenantRole: (id, tenantId, input, locale) =>
      updateTenantRole(ctxFor(locale), id, tenantId, input),
    deleteTenantRole: (id, tenantId, locale) => deleteTenantRole(ctxFor(locale), id, tenantId),
    upsertTemplateOverride: (tenantId, name, input, locale) =>
      upsertTemplateOverride(ctxFor(locale), tenantId, name, {
        description: input.description,
        permissions: serializeRolePermissions(input.permissions),
      }),
    resetTemplateRole: (tenantId, name, locale) =>
      resetTemplateRole(ctxFor(locale), tenantId, name),
    templateSeedPermissions: (name) => {
      const seed = templateSeedFor(ctx, name);
      return seed ? parseRolePermissions(seed.permissions) : null;
    },
  };
}
