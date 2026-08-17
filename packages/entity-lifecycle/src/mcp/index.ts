/**
 * `@12-apps/entity-lifecycle/mcp` — the agent-facing surface of a plugged
 * collection.
 *
 * A subpath rather than part of the main entry, because it is the one part of
 * this package that only some hosts want: a host with no MCP server should not
 * acquire `zod` and `@12-apps/mcp` in its tree for a surface it never mounts.
 * Both are OPTIONAL peers for exactly that reason.
 *
 * ```ts
 * // <your app>/lib/mcp/registry/lifecycle-suppliers.ts
 * import { lifecycleMcpEndpoints } from '@12-apps/entity-lifecycle/mcp';
 *
 * export const supplierLifecycleEndpoints = lifecycleMcpEndpoints({
 *   collectionPath: '/api/admin/{tenantSlug}/suppliers',
 *   noun: 'Supplier',
 *   summaries: { getVersions: '…', … },
 * });
 * ```
 *
 * The schemas are exported alongside so a host's ROUTE handlers validate with
 * the same objects the tools are generated from — the property that keeps an
 * advertised schema and a runtime validator from disagreeing.
 */
export {
  lifecycleMcpEndpoints,
  type LifecycleEndpointVocabulary,
  type LifecycleOperation,
} from './endpoints';

export {
  draftItemParams,
  draftResponse,
  draftsResponse,
  lifecycleTenantParams,
  saveDraftBody,
  versionItemParams,
  versionsParams,
  versionsResponse,
  writeOutcomeResponse,
} from './schemas';
