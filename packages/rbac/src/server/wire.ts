import { z } from 'zod';

import type { PermissionRegistry } from '../core/types';

import { RbacApiError, type RbacMessages } from './context';
import type { RoleListQuery } from './roles-store';
import type { TeamListQuery } from './team-store';

/**
 * The REQUEST schemas (12-13) — ported from the origin host's
 * `lib/mcp/registry/roles.ts` + `team.ts`, built per-config because the
 * permission enum is the HOST's catalog, not a constant. Authored once, so an
 * advertised tool surface built on these cannot drift from the runtime
 * validators for the half they cover.
 *
 * THAT HALF IS INPUTS ONLY, and the distinction is not pedantry. Everything in
 * this module — the six `*Body` schemas, {@link parseBody},
 * {@link requireParam}, {@link parseRoleListQuery}, {@link parseTeamListQuery}
 * — validates what arrives. Not one line describes what a route ANSWERS, so
 * nothing here can keep an advertised RESPONSE honest.
 *
 * The file used to claim that a surface built on these "can never drift". It
 * was already untrue when written, and drifted in exactly the uncovered half:
 * the host's advertised `getMyPermissions` listed `permissions` alone while
 * `GET /permissions` had been merging `permissionsExtras` into the answer for
 * as long as the option existed (FUT-760). A guarantee that names only the
 * direction that cannot break is worse than none — it is why nobody checked
 * the other one.
 *
 * WHAT DOES COVER RESPONSES, and where to reach for it:
 *
 *  - `MyPermissionsPayload` for the shell read this module cannot describe;
 *  - `RoleRecord` / `RoleListRecord` / `TeamMemberDetail` / `TeamMemberRecord`
 *    for the payloads the stores return, all already exported from `./index`.
 *
 * A host binds its advertised schema to those with `satisfies z.ZodType<…>`.
 * Nothing in the package can force it to — a schema it never sees is a schema
 * it cannot check — so the binding is the host's to write, and its absence is
 * what this module must stop implying is impossible.
 */

export interface RoleWireSchemas {
  /** Body for creating/updating a custom role. */
  roleWriteBody: z.ZodType<{
    name: string;
    description?: string | null | undefined;
    permissions: '*' | string[];
  }>;
  /** Body for overriding a seeded template role per-tenant. */
  templateOverrideBody: z.ZodType<{
    description?: string | null | undefined;
    permissions: '*' | string[];
  }>;
  /** Body for assigning a member's base role. */
  setMemberRoleBody: z.ZodType<{ role: string }>;
  /** Body for granting a member an additive custom role. */
  grantMemberRoleBody: z.ZodType<{ role: string }>;
  /** Body for enabling/disabling a member. */
  setMemberActiveBody: z.ZodType<{ active: boolean }>;
  /** Body for inviting by e-mail (only served when the invites port exists). */
  inviteBody: z.ZodType<{ email: string }>;
}

export function buildWireSchemas<P extends string>(
  permissions: PermissionRegistry<P>,
): RoleWireSchemas {
  /** The catalog as a zod enum — a role may only reference these. */
  const permissionEnum = z.enum(permissions.list as unknown as [string, ...string[]]);
  const permissionSet = z.union([z.literal('*'), z.array(permissionEnum)]);

  const roleWriteBody = z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().nullable().optional(),
    permissions: permissionSet,
  });

  return {
    roleWriteBody: roleWriteBody as RoleWireSchemas['roleWriteBody'],
    templateOverrideBody: z.object({
      description: z.string().trim().nullable().optional(),
      permissions: permissionSet,
    }) as RoleWireSchemas['templateOverrideBody'],
    setMemberRoleBody: z.object({ role: z.string().trim().min(1) }),
    grantMemberRoleBody: z.object({ role: z.string().trim().min(1) }),
    setMemberActiveBody: z.object({ active: z.boolean() }),
    inviteBody: z.object({ email: z.string().trim().min(3) }),
  };
}

/** Parse a zod body or throw the 400 the wire promises. */
export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  messages: Pick<RbacMessages, 'invalidBody'>,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    throw new RbacApiError(400, `${messages.invalidBody}${path ? ` (${path})` : ''}.`);
  }
  return parsed.data;
}

/** A required path param, or the 404 a malformed URL deserves. */
export function requireParam(
  params: Record<string, string | undefined>,
  name: string,
  messages: Pick<RbacMessages, 'notFound'>,
): string {
  const value = params[name];
  if (!value) throw new RbacApiError(404, messages.notFound);
  return decodeURIComponent(value);
}

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  const value = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return max !== undefined && value > max ? max : value;
}

function parseSort<Field extends string>(
  raw: string | undefined,
  fields: readonly Field[],
): { field: Field; direction: 'asc' | 'desc' } | undefined {
  if (!raw) return undefined;
  const [field, direction] = raw.split(':');
  if (!fields.includes(field as Field)) return undefined;
  return {
    field: field as Field,
    direction: direction === 'desc' ? 'desc' : 'asc',
  };
}

/** Comma-separated multi-value pill → a de-duped list (undefined when empty). */
function parseCommaList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
  return values.length > 0 ? values : undefined;
}

/** The roles list query: `q`, `kind_in`, `sort`, `page`/`pageSize`. */
export function parseRoleListQuery(query: Record<string, string | undefined>): RoleListQuery {
  const kindIn = parseCommaList(query.kind_in);
  const sort = parseSort(query.sort, ['name', 'createdAt'] as const);
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(kindIn ? { kindIn } : {}),
    ...(sort ? { sort } : {}),
    page: parsePositiveInt(query.page, 1),
    pageSize: parsePositiveInt(query.pageSize, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX),
  };
}

/** The team roster query: `q`, `role_in`, `status_in`, `sort`, paging. */
export function parseTeamListQuery(query: Record<string, string | undefined>): TeamListQuery {
  const roleIn = parseCommaList(query.role_in);
  const statusIn = parseCommaList(query.status_in);
  const sort = parseSort(query.sort, ['role', 'createdAt'] as const);
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(roleIn ? { roleIn } : {}),
    ...(statusIn ? { statusIn } : {}),
    ...(sort ? { sort } : {}),
    page: parsePositiveInt(query.page, 1),
    pageSize: parsePositiveInt(query.pageSize, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX),
  };
}
