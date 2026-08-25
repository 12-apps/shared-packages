import type { z } from 'zod';

/** The seventeen tools this package's endpoints are, as summary keys. */
export type RbacMcpOperation =
  | 'listTeamMembers'
  | 'inviteTenantAdmin'
  | 'removeTenantAdmin'
  | 'setMemberRole'
  | 'grantMemberRole'
  | 'revokeMemberRole'
  | 'setMemberStatus'
  | 'cancelTenantInvite'
  | 'getTeamContext'
  | 'getTeamMember'
  | 'listRoles'
  | 'createRole'
  | 'updateRole'
  | 'deleteRole'
  | 'overrideTemplateRole'
  | 'resetTemplateRole'
  | 'getMyPermissions';

/**
 * What ONE host calls this package's admin surface.
 *
 * The split follows the rule the contract already states: the SHAPE is this
 * package's, the SENTENCES and the vocabulary are the host's. Everything below
 * is something no library can answer.
 */
export interface RbacMcpVocabulary {
  /**
   * Where the host mounts the surface, without a trailing slash — the route
   * suffixes are appended to it. A full path template rather than a segment,
   * because where a host mounts its own routes is the host's business.
   */
  collectionPath: string;
  /**
   * The permission catalog, as ids. A custom role may only reference these — it
   * cannot invent permission strings, because those are wired to code gates.
   * ASSEMBLED BY THE HOST (the manifest docblock is explicit that the catalog
   * assembly stays host-owned), so it arrives here rather than being imported.
   *
   * Serialized into the committed manifest in catalog order, so a change to the
   * composition order is a diff the surface check demands a regeneration for.
   */
  catalogPermissions: readonly string[];
  /**
   * The staff base roles assignable from the roster. The host's own tier list,
   * minus whatever it treats as non-staff — this package has no opinion about
   * which of a host's roles are assignable by a roster.
   */
  assignableRoles: readonly [string, ...string[]];
  /**
   * The roster's filter/sort/pagination query, built from the host's own search
   * config. Passed in whole rather than composed here: the config names the
   * sortable columns and the free-text fields, which are facts about the host's
   * store, and `createSearchInput` lives in a package this one does not depend
   * on.
   */
  listTeamQuery: z.ZodType;
  /** The roles list query, from the host's role search config. */
  listRolesQuery: z.ZodType;
  /**
   * What `getMyPermissions` answers BEYOND the permission list.
   *
   * The second under-declaration this migration fixes, and the one a schema in
   * the host could not have caught: `permissionsExtras` lets a host widen that
   * payload from inside the package, so the extra fields exist at a seam the
   * host's own registry file could not see. Naming the widening here is what
   * makes the advertised shape match the served one — omit it and the tool
   * advertises the permission list alone, which is exactly the bug.
   */
  permissionsExtras?: z.ZodType;
  /** What each of the seventeen tools tells an agent it is for. */
  summaries: Record<RbacMcpOperation, string>;
  /** Defaults to `['team']` / `['roles']` per half. */
  tags?: { team?: readonly string[]; roles?: readonly string[] };
}
