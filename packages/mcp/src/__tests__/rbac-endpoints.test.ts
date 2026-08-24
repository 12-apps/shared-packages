import { describe, expect, it } from "vitest";
import { z } from "zod";

import { rbacMcpEndpoints, type RbacMcpVocabulary } from "@12-apps/rbac/mcp";

import type { McpEndpoint } from "../openapi/endpoint";

/**
 * The pin that makes `@12-apps/rbac`'s endpoint TWIN safe.
 *
 * That package cannot import this one: the coverage gate here imports
 * `@12-apps/rbac/coverage`, so a dependency back is a cycle the workspace
 * refuses outright. It therefore restates `McpEndpoint` structurally — the
 * payments-backend arrangement, where `PaymentsJobBlueprint` twins
 * `@12-apps/jobs`' blueprint and the compliance suite lives on the side that
 * may import both.
 *
 * This is that suite. A twin nobody compares is a twin that drifts, which is
 * the failure the wiring RFC opens with; the comparison runs HERE, where the
 * import is legal, and it costs one file.
 *
 * The assignment on its own is the assertion — `satisfies McpEndpoint[]` fails
 * the build if the shapes part company. The cases below add what a type cannot
 * say: that the union's 204 rule survived the restatement, and that every tool
 * arrives complete enough for the surface to build.
 */

const OPERATIONS = [
  "listTeamMembers",
  "inviteTenantAdmin",
  "removeTenantAdmin",
  "setMemberRole",
  "grantMemberRole",
  "revokeMemberRole",
  "setMemberStatus",
  "cancelTenantInvite",
  "getTeamContext",
  "getTeamMember",
  "listRoles",
  "createRole",
  "updateRole",
  "deleteRole",
  "overrideTemplateRole",
  "resetTemplateRole",
  "getMyPermissions",
] as const;

const vocabulary: RbacMcpVocabulary = {
  collectionPath: "/api/admin/{tenantSlug}",
  catalogPermissions: ["team:read"],
  assignableRoles: ["ADMIN"],
  listTeamQuery: z.object({ q: z.string().optional() }),
  listRolesQuery: z.object({ q: z.string().optional() }),
  summaries: Object.fromEntries(
    OPERATIONS.map((operation) => [operation, `does ${operation}`]),
  ) as RbacMcpVocabulary["summaries"],
};

/** THE ASSERTION. If the twin drifts, this line stops compiling. */
const endpoints = rbacMcpEndpoints(vocabulary) satisfies McpEndpoint[];

describe("@12-apps/rbac's endpoint twin", () => {
  it("stays assignable to McpEndpoint", () => {
    expect(endpoints).toHaveLength(OPERATIONS.length);
  });

  it("keeps the mutual exclusion the union exists for", () => {
    // A 204 entry may not also carry a response schema. Flattening the union in
    // the twin would keep it assignable while dropping exactly this property,
    // so the type check above cannot be the whole test.
    for (const endpoint of endpoints) {
      const has204 = endpoint.status === 204;
      expect({ id: endpoint.operationId, bodyless: has204 && endpoint.response === undefined }).toEqual(
        { id: endpoint.operationId, bodyless: has204 },
      );
    }
  });

  it("arrives complete enough to build a surface from", () => {
    for (const endpoint of endpoints) {
      expect(typeof endpoint.operationId).toBe("string");
      expect(typeof endpoint.path).toBe("string");
      expect(typeof endpoint.summary).toBe("string");
      expect(endpoint.summary.length).toBeGreaterThan(0);
    }
  });
});
