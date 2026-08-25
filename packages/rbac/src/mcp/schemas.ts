import { z } from 'zod';

import type { MemberDetailPayload, RoleListRecord, RoleRecord, TeamMemberRecord } from '../server';

/**
 * The wire shapes of this package's OWN endpoints.
 *
 * They lived in the origin host, in two registry files that hand-described
 * seventeen tools over routes they do not implement — and both files said so
 * about themselves. `registry/team.ts`: *"Nothing validates a response … the
 * routes delegate to `@12-apps/rbac`, and what it returns is reconciled with
 * what these schemas declare by review alone. `getTeamContext` is the proof —
 * it answered `invitesEnabled` for as long as the package has sent it, and this
 * file did not mention the field."* `registry/roles.ts` names the same defect on
 * `getMyPermissions`, which was answering with an entitlement snapshot merged in
 * while advertising the permission list alone.
 *
 * Two under-declarations, found by reading rather than by any gate, because the
 * only thing standing between the manifest and the truth was review. Here the
 * schemas sit beside the handlers that produce them, and the `satisfies
 * z.ZodType<T>` bindings below are checked against this package's own record
 * types by this package's own build.
 *
 * `satisfies` is ONE-WAY, and the origin host measured exactly what that buys:
 * dropping a field the route sends is a TS1360 build error; ADDING one the route
 * never sends still compiles. So this closes the under-declaration direction —
 * the one both bugs were in — and the surface gates remain what stands between
 * an invented field and the manifest.
 */

/** A staff member: the per-tenant role over the shared user profile. */
export const teamMemberSchema = z.object({
  userId: z.string(),
  role: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  /** Whether the membership is enabled; the soft disable sets this false. */
  active: z.boolean(),
  /** Lifecycle status derived from `active` (a disabled member keeps its role). */
  status: z.enum(['ENABLED', 'DISABLED']),
}) satisfies z.ZodType<TeamMemberRecord>;

/** One member's additive custom-role grants (roster context read). */
const memberCustomRolesSchema = z.object({
  userId: z.string(),
  roles: z.array(z.string()),
});

/** A pending accountless invite shown on the roster (context read). */
const pendingInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
});

/**
 * The roster's companion context: everything the team screen composes BEYOND
 * the paged roster — per-member custom-role grants, the assignable role names,
 * and the pending accountless invites.
 */
export const teamContextSchema = z.object({
  customRolesByMember: z.array(memberCustomRolesSchema),
  assignableRoles: z.array(z.string()),
  pendingInvites: z.array(pendingInviteSchema),
  /**
   * Whether this deployment wired an invites port at all (`Boolean(config.invites)`).
   *
   * THE FIELD THE HOST'S COPY OMITTED. It is not the same question as
   * `pendingInvites.length === 0`, which is why it travels: an empty list means
   * "nobody is waiting", this means "inviting is not a thing here", and the two
   * call for different words. Without it the only way to tell them apart is to
   * invite someone and read the 501.
   */
  invitesEnabled: z.boolean(),
});

/**
 * A member's profile detail — a PROJECTION of the store's row, not the row: it
 * drops `active`/`status` and sends the timestamps as ISO strings rather than
 * `Date`, which is why it binds to {@link MemberDetailPayload} and not to the
 * record type.
 */
export const teamMemberDetailSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string(),
  customRoles: z.array(z.string()),
  /** ISO timestamp of when the user joined this tenant's roster. */
  memberSince: z.string(),
  /** ISO timestamp of the last successful sign-in, or null if never recorded. */
  lastLoginAt: z.string().nullable(),
}) satisfies z.ZodType<MemberDetailPayload>;

/** Body for granting tenant admin by e-mail. */
export const inviteBody = z.object({ email: z.string().trim().min(3) });

/** Body for the soft enable/disable. */
export const setMemberActiveBody = z.object({ active: z.boolean() });

/**
 * Body for granting a tenant CUSTOM role. Unlike the base role (a fixed
 * template enum the host supplies), a custom role is a free-form tenant role
 * name; the route validates it exists and that the granter may grant it.
 */
export const grantMemberRoleBody = z.object({ role: z.string().trim().min(1) });

/** A role's permission set: the wildcard, or a list drawn from the host catalog. */
export function permissionSetOf(catalogPermissions: readonly string[]) {
  const permissionEnum = z.enum(catalogPermissions as unknown as [string, ...string[]]);
  return z.union([z.literal('*'), z.array(permissionEnum)]);
}

/** One custom role, over the host's catalog. */
export function roleSchemaOf(catalogPermissions: readonly string[]) {
  return z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    permissions: permissionSetOf(catalogPermissions),
  }) satisfies z.ZodType<RoleRecord>;
}

/** A roster row for the roles list — the role plus its kind and lock state. */
export function roleListRowSchemaOf(catalogPermissions: readonly string[]) {
  return roleSchemaOf(catalogPermissions).extend({
    kind: z.string(),
    locked: z.boolean(),
  }) satisfies z.ZodType<RoleListRecord>;
}

/** Body for creating or updating a custom role. */
export function roleWriteBodyOf(catalogPermissions: readonly string[]) {
  return z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().nullable().optional(),
    permissions: permissionSetOf(catalogPermissions),
  });
}

/** Body for a seeded TEMPLATE role's per-tenant override. */
export function templateOverrideBodyOf(catalogPermissions: readonly string[]) {
  return z.object({
    description: z.string().trim().nullable().optional(),
    permissions: permissionSetOf(catalogPermissions),
  });
}

/**
 * The path params of every route this package mounts.
 *
 * Exported because the HOST's route files need them — a route declares the
 * params it parses, and a host restating `z.object({ tenantSlug, userId })`
 * beside a package that already builds it is the same drift the response
 * schemas had: two descriptions of one shape, reconciled by review. They are
 * small, which is exactly why nobody would notice one going stale.
 *
 * A frozen object rather than a factory: nothing here varies by host. The
 * `*Of` builders above take the catalog because a permission set genuinely
 * does.
 */
export const rbacMcpParams = {
  /** The tenant-scoped collection — `/team`, `/roles`, `/permissions`. */
  tenant: z.object({ tenantSlug: z.string().min(1) }),
  /** One member — `/team/:userId`. */
  member: z.object({ tenantSlug: z.string().min(1), userId: z.string().min(1) }),
  /** One of a member's additive roles — `/team/:userId/roles/:role`. */
  memberRole: z.object({
    tenantSlug: z.string().min(1),
    userId: z.string().min(1),
    role: z.string().min(1),
  }),
  /** One pending invite — `/team/invites/:inviteId`. */
  invite: z.object({ tenantSlug: z.string().min(1), inviteId: z.string().min(1) }),
  /** One tenant-composed role, keyed by ID — `/roles/:id`. */
  role: z.object({ tenantSlug: z.string().min(1), id: z.string().min(1) }),
  /** One seeded template role, keyed by NAME — `/roles/templates/:name`. */
  template: z.object({ tenantSlug: z.string().min(1), name: z.string().min(1) }),
} as const;

/**
 * The body of `PATCH /team/:userId` — a member's BASE role.
 *
 * A factory over the host's assignable tier list, because the base role is a
 * CLOSED set and which of a host's roles a roster may assign is the host's
 * fact. An open `z.string()` here would advertise that any role name is
 * acceptable while the endpoint refuses everything outside the list.
 */
export function setMemberRoleBodyOf(assignableRoles: readonly [string, ...string[]]) {
  return z.object({ role: z.enum(assignableRoles) });
}
