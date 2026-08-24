import { z } from "zod";

import {
  grantMemberRoleBody,
  inviteBody,
  roleListRowSchemaOf,
  roleSchemaOf,
  roleWriteBodyOf,
  setMemberActiveBody,
  teamContextSchema,
  teamMemberDetailSchema,
  teamMemberSchema,
  templateOverrideBodyOf,
} from "./schemas";
import type { RbacHttpMethod, RbacMcpEndpoint } from "./twin";
import type { RbacMcpVocabulary } from "./vocabulary";

/**
 * The seventeen tools this package's admin surface IS.
 *
 * ## Why they live here now
 *
 * They were written out in the origin host — `lib/mcp/registry/team.ts` (341
 * lines) and `roles.ts` (268) — describing routes the host does not implement.
 * Both files documented the consequence themselves: a response is validated by
 * nothing, so the advertised shape and the served one agreed by review alone.
 * Two of them had already stopped agreeing (`invitesEnabled`,
 * `getMyPermissions`' entitlement snapshot), and nothing anywhere went red.
 *
 * Written beside the handlers, the drift has somewhere to fail: the response
 * schemas bind to this package's own record types, so dropping a field the
 * route sends is a build error in the package that sends it.
 *
 * ## What the host still answers
 *
 * The shape is this package's; the vocabulary and the sentences are the host's
 * — the same split `lifecycleMcpEndpoints` draws one package over. The mount
 * path, the permission catalog, which base roles a roster may assign, the two
 * search queries, the `permissionsExtras` widening and all seventeen summaries
 * arrive as {@link RbacMcpVocabulary}. None of them is derivable here.
 *
 * ## The annotations
 *
 * Defaults, not verdicts: `resolveToolAnnotations` merges them UNDER whatever a
 * host states, because a package's claim is about behaviour and a host's is
 * about its deployment. `title` is deliberately unset — behaviour is this
 * package's knowledge, the label is copy.
 *
 * They are set to what the origin host's audit already concluded, which is
 * stricter than a naive reading in one place worth naming: every membership and
 * role WRITE is marked destructive, not merely non-read. Granting a role, or
 * disabling a member, changes who can do what — an agent asking for
 * auto-approval on that is asking for something an access-control surface
 * should not grant by default. `createRole` is the one write that is not
 * destructive: it adds a role nobody holds yet.
 */

/** Reads, and does not reach beyond the host's own data. */
const READS: RbacMcpEndpoint["annotations"] = {
  readOnly: true,
  destructive: false,
  openWorld: false,
};

/** Additive: it creates something nobody held before. */
const ADDS: RbacMcpEndpoint["annotations"] = {
  readOnly: false,
  destructive: false,
  openWorld: false,
};

/** Changes or removes an existing grant — see the header on why writes count here. */
const ALTERS_ACCESS: RbacMcpEndpoint["annotations"] = {
  readOnly: false,
  destructive: true,
  openWorld: false,
};

/** `{ data: … }` — this surface's envelope, stated once. */
const envelope = <T extends z.ZodType>(data: T) => z.object({ data });

/** `{ data: { status } }` — the shape every write outcome takes. */
const statusOf = <T extends string>(literal: T) =>
  envelope(z.object({ status: z.literal(literal) }));

/**
 * One endpoint, with the five keys every entry here shares assembled once.
 *
 * Written out per entry, the seventeen tools are ~170 lines of the same five
 * keys — which is both over the size gate and the shape that lets one entry
 * quietly differ from its neighbours. The builder makes the DIFFERENCES the
 * only thing each line carries.
 */
function endpoint(
  operationId: string,
  method: RbacHttpMethod,
  path: string,
  annotations: RbacMcpEndpoint["annotations"],
  rest: Omit<
    RbacMcpEndpoint,
    "operationId" | "method" | "path" | "annotations" | "summary" | "tags"
  >,
  context: { summary: string; tags: string[] },
): RbacMcpEndpoint {
  return {
    operationId,
    method,
    path,
    annotations,
    summary: context.summary,
    tags: context.tags,
    ...rest,
  } as RbacMcpEndpoint;
}

/** The path params every endpoint here is keyed by, built once. */
function paramsOf() {
  const tenant = z.object({ tenantSlug: z.string().min(1) });
  const member = tenant.extend({ userId: z.string().min(1) });
  const role = tenant.extend({ id: z.string().min(1) });
  return {
    tenant,
    member,
    memberRole: member.extend({ role: z.string().min(1) }),
    invite: tenant.extend({ inviteId: z.string().min(1) }),
    role,
    template: tenant.extend({ name: z.string().min(1) }),
  };
}

type RbacParams = ReturnType<typeof paramsOf>;

/**
 * The roster half. Split from the catalog half at the 80-line gate, on the seam
 * the surface itself draws — the two screens `createWebRbac` returns.
 */
function teamEndpoints(
  vocabulary: RbacMcpVocabulary,
  params: RbacParams,
  tags: string[],
): RbacMcpEndpoint[] {
  const { collectionPath, summaries } = vocabulary;
  const { tenant, member } = params;
  return [
    endpoint(
      "listTeamMembers",
      "get",
      `${collectionPath}/team`,
      READS,
      {
        params: tenant,
        query: vocabulary.listTeamQuery,
        response: envelope(z.array(teamMemberSchema)),
      },
      { summary: summaries.listTeamMembers, tags },
    ),
    endpoint(
      "inviteTenantAdmin",
      "post",
      `${collectionPath}/team`,
      ALTERS_ACCESS,
      {
        params: tenant,
        body: inviteBody,
        response: envelope(z.object({ status: z.enum(["added", "invited"]) })),
      },
      { summary: summaries.inviteTenantAdmin, tags },
    ),
    endpoint(
      "removeTenantAdmin",
      "delete",
      `${collectionPath}/team/{userId}`,
      ALTERS_ACCESS,
      { params: member, response: statusOf("removed") },
      { summary: summaries.removeTenantAdmin, tags },
    ),
    endpoint(
      "setMemberRole",
      "patch",
      `${collectionPath}/team/{userId}`,
      ALTERS_ACCESS,
      {
        params: member,
        body: z.object({ role: z.enum(vocabulary.assignableRoles) }),
        response: envelope(
          z.object({ status: z.literal("updated"), role: z.string() }),
        ),
      },
      { summary: summaries.setMemberRole, tags },
    ),
  ];
}

/**
 * The rest of the roster: the custom-role grants, the member's on/off switch,
 * the accountless invites, and the two reads the screen composes beside the
 * page (`getTeamContext`, `getTeamMember`).
 *
 * Split from {@link teamEndpoints} at the 80-line gate. The seam is real rather
 * than arbitrary — everything here acts on something ATTACHED to a membership
 * (a grant, a status flag, an invite) or reads ALONGSIDE the roster, where the
 * four above create, list and re-role the membership itself.
 */
function memberGrantEndpoints(
  vocabulary: RbacMcpVocabulary,
  params: RbacParams,
  tags: string[],
): RbacMcpEndpoint[] {
  const { collectionPath, summaries } = vocabulary;
  const { tenant, member, memberRole, invite } = params;
  return [
    endpoint(
      "grantMemberRole",
      "post",
      `${collectionPath}/team/{userId}/roles`,
      ALTERS_ACCESS,
      {
        params: member,
        body: grantMemberRoleBody,
        response: envelope(
          z.object({ status: z.literal("granted"), role: z.string() }),
        ),
      },
      { summary: summaries.grantMemberRole, tags },
    ),
    endpoint(
      "revokeMemberRole",
      "delete",
      `${collectionPath}/team/{userId}/roles/{role}`,
      ALTERS_ACCESS,
      { params: memberRole, response: statusOf("revoked") },
      { summary: summaries.revokeMemberRole, tags },
    ),
    endpoint(
      "setMemberStatus",
      "patch",
      `${collectionPath}/team/{userId}/status`,
      ALTERS_ACCESS,
      {
        params: member,
        body: setMemberActiveBody,
        response: statusOf("updated"),
      },
      { summary: summaries.setMemberStatus, tags },
    ),
    endpoint(
      "cancelTenantInvite",
      "delete",
      `${collectionPath}/team/invites/{inviteId}`,
      ALTERS_ACCESS,
      { params: invite, response: statusOf("cancelled") },
      { summary: summaries.cancelTenantInvite, tags },
    ),
    endpoint(
      "getTeamContext",
      "get",
      `${collectionPath}/team/context`,
      READS,
      { params: tenant, response: envelope(teamContextSchema) },
      { summary: summaries.getTeamContext, tags },
    ),
    endpoint(
      "getTeamMember",
      "get",
      `${collectionPath}/team/{userId}`,
      READS,
      { params: member, response: envelope(teamMemberDetailSchema) },
      { summary: summaries.getTeamMember, tags },
    ),
  ];
}

/**
 * The permission read, widened by whatever the host merges in.
 *
 * See {@link RbacMcpVocabulary.permissionsExtras} — the field the origin host's
 * own registry could not name, because `permissionsExtras` widens this payload
 * from INSIDE the package, at a seam no schema in the host could see.
 */
function permissionReadOf(vocabulary: RbacMcpVocabulary) {
  const base = z.object({ permissions: z.array(z.string()) });
  return vocabulary.permissionsExtras
    ? z.intersection(base, vocabulary.permissionsExtras)
    : base;
}

/** The catalog half: custom roles, template overrides, and the permission read. */
function roleEndpoints(
  vocabulary: RbacMcpVocabulary,
  params: RbacParams,
  tags: string[],
): RbacMcpEndpoint[] {
  const { collectionPath, catalogPermissions, summaries } = vocabulary;
  const { tenant, role, template } = params;
  const roleSchema = roleSchemaOf(catalogPermissions);
  const roleWriteBody = roleWriteBodyOf(catalogPermissions);
  const myPermissions = permissionReadOf(vocabulary);

  return [
    endpoint(
      "listRoles",
      "get",
      `${collectionPath}/roles`,
      READS,
      {
        params: tenant,
        query: vocabulary.listRolesQuery,
        response: envelope(z.array(roleListRowSchemaOf(catalogPermissions))),
      },
      { summary: summaries.listRoles, tags },
    ),
    endpoint(
      "createRole",
      "post",
      `${collectionPath}/roles`,
      ADDS,
      { params: tenant, body: roleWriteBody, response: envelope(roleSchema) },
      { summary: summaries.createRole, tags },
    ),
    endpoint(
      "updateRole",
      "patch",
      `${collectionPath}/roles/{id}`,
      ALTERS_ACCESS,
      { params: role, body: roleWriteBody, response: envelope(roleSchema) },
      { summary: summaries.updateRole, tags },
    ),
    endpoint(
      "deleteRole",
      "delete",
      `${collectionPath}/roles/{id}`,
      ALTERS_ACCESS,
      { params: role, response: statusOf("deleted") },
      { summary: summaries.deleteRole, tags },
    ),
    endpoint(
      "overrideTemplateRole",
      "put",
      `${collectionPath}/roles/templates/{name}`,
      ALTERS_ACCESS,
      {
        params: template,
        body: templateOverrideBodyOf(catalogPermissions),
        response: envelope(roleSchema),
      },
      { summary: summaries.overrideTemplateRole, tags },
    ),
    endpoint(
      "resetTemplateRole",
      "delete",
      `${collectionPath}/roles/templates/{name}`,
      ALTERS_ACCESS,
      { params: template, response: statusOf("reset") },
      { summary: summaries.resetTemplateRole, tags },
    ),
    endpoint(
      "getMyPermissions",
      "get",
      `${collectionPath}/permissions`,
      READS,
      { params: tenant, response: envelope(myPermissions) },
      { summary: summaries.getMyPermissions, tags },
    ),
  ];
}

export function rbacMcpEndpoints(
  vocabulary: RbacMcpVocabulary,
): RbacMcpEndpoint[] {
  const params = paramsOf();
  const teamTags = [...(vocabulary.tags?.team ?? ["team"])];
  // ORDER IS PART OF THE CONTRACT. A host concatenates these into the array its
  // manifest is generated from, and the surface digest is taken over that
  // array — so reordering the halves is a regeneration a consumer's check
  // demands, not a cosmetic edit. The three halves run members, then what is
  // attached to a member, then the catalog.
  return [
    ...teamEndpoints(vocabulary, params, teamTags),
    ...memberGrantEndpoints(vocabulary, params, teamTags),
    ...roleEndpoints(vocabulary, params, [
      ...(vocabulary.tags?.roles ?? ["roles"]),
    ]),
  ];
}
