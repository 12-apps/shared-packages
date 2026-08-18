import type { McpEndpoint } from '@12-apps/mcp';

import {
  draftItemParams,
  draftResponse,
  draftsResponse,
  lifecycleTenantParams,
  saveDraftBody,
  versionItemParams,
  versionsParams,
  versionsQuery,
  versionsResponse,
  writeOutcomeResponse,
} from './schemas';

/**
 * The MCP surface a collection gets by being plugged into this package.
 *
 * Every plugged collection gets the SAME eight capabilities, served by the same
 * handlers against the same schemas: read a record's history, restore a version,
 * read/write/publish/discard its draft, and list or start drafts for the whole
 * tenant. A host that plugs in six collections was therefore writing that table
 * out six times — six files, ~98 lines each, identical but for the noun.
 *
 * Identical-but-for-a-noun is what a mechanism looks like before it is named.
 * The six copies agree today, to the character — but nothing makes them agree,
 * and nothing would report it if they stopped. A seventh collection is written
 * by copying a sixth, which is how a surface acquires an endpoint that is
 * almost like the others.
 *
 * WHAT THIS DOES NOT TAKE OVER is the words. The summaries are supplied per
 * collection and not derived from the noun, because they are genuinely not
 * derivable — one host's six read "…uncreated stations", "…uncreated roles" and
 * "…uncreated items"; its attributive forms are "kitchen-station draft" but
 * "stock-loss reason draft"; and one of its collections is named in Portuguese
 * inside an otherwise English sentence. Deriving them would mean rewriting 48
 * tool descriptions that agents have already read, to no one's benefit. The
 * shape is this package's; the sentences stay the host's.
 */

/** The eight capabilities a plugged collection gets, as summary keys. */
export type LifecycleOperation =
  | 'getVersions'
  | 'restoreVersion'
  | 'getDraft'
  | 'saveDraft'
  | 'publishDraft'
  | 'discardDraft'
  | 'listDrafts'
  | 'createDraft';

/** What ONE host calls ONE of its plugged collections. */
export interface LifecycleEndpointVocabulary {
  /**
   * Where the collection's routes live, without a trailing slash — the eight
   * suffixes are appended to it.
   *
   * A full path rather than a bare segment, because where a host mounts its own
   * routes is the host's business: one collection sits at
   * `/api/admin/{tenantSlug}/suppliers` and another at
   * `/api/admin/{tenantSlug}/config/loss-reasons`, and this package has no
   * opinion about which.
   */
  collectionPath: string;
  /**
   * The noun inside the operation ids, in PascalCase — `Supplier` yields
   * `getSupplierVersions` and `listSupplierDrafts`.
   *
   * These become MCP tool names, so they are also the thing an agent has
   * learned: changing one is a breaking change for every connected host.
   */
  noun: string;
  /** What each of the eight tools tells an agent it is for. */
  summaries: Record<LifecycleOperation, string>;
  /** Defaults to `["lifecycle"]` — the same grouping for every collection. */
  tags?: readonly string[];
}

/**
 * The eight endpoints for one plugged collection, in a fixed order.
 *
 * Order matters more than it looks: a host concatenates these into the array a
 * manifest is generated from, and the surface digest is taken over that array.
 * Emitting them in a stable order means adding a seventh collection cannot
 * reshuffle the six already published.
 */
export function lifecycleMcpEndpoints(
  vocabulary: LifecycleEndpointVocabulary,
): McpEndpoint[] {
  const tags = [...(vocabulary.tags ?? ['lifecycle'])];
  return [...versioningEndpoints(vocabulary, tags), ...draftEndpoints(vocabulary, tags)];
}

/**
 * The `versioning` half — what changed, and going back to it.
 *
 * Split from the drafts half along the seam the package already draws: a
 * collection is plugged in with `features: { versioning, drafts, approvals }`,
 * and these two are the first two of those.
 */
function versioningEndpoints(
  { collectionPath, noun, summaries }: LifecycleEndpointVocabulary,
  tags: string[],
): McpEndpoint[] {
  return [
    {
      operationId: `get${noun}Versions`,
      method: 'get',
      path: `${collectionPath}/{id}/versions`,
      summary: summaries.getVersions,
      tags,
      params: versionsParams,
      query: versionsQuery,
      response: versionsResponse,
    },
    {
      operationId: `restore${noun}Version`,
      method: 'post',
      path: `${collectionPath}/{id}/versions/{version}/restore`,
      summary: summaries.restoreVersion,
      tags,
      params: versionItemParams,
      response: writeOutcomeResponse,
    },
  ];
}

/** The `drafts` half — one unpublished working copy per item, and the tenant's. */
function draftEndpoints(
  { collectionPath, noun, summaries }: LifecycleEndpointVocabulary,
  tags: string[],
): McpEndpoint[] {
  return [
    {
      operationId: `get${noun}Draft`,
      method: 'get',
      path: `${collectionPath}/{id}/draft`,
      summary: summaries.getDraft,
      tags,
      params: versionsParams,
      response: draftResponse,
    },
    {
      operationId: `save${noun}Draft`,
      method: 'put',
      path: `${collectionPath}/{id}/draft`,
      summary: summaries.saveDraft,
      tags,
      params: versionsParams,
      body: saveDraftBody,
      response: draftResponse,
    },
    {
      operationId: `publish${noun}Draft`,
      method: 'post',
      path: `${collectionPath}/drafts/{draftId}/publish`,
      summary: summaries.publishDraft,
      tags,
      params: draftItemParams,
      response: writeOutcomeResponse,
    },
    {
      // The one 204 of the eight, so it carries no response schema at all —
      // see `McpEndpoint`, where the two are mutually exclusive by construction.
      operationId: `discard${noun}Draft`,
      method: 'delete',
      path: `${collectionPath}/drafts/{draftId}`,
      summary: summaries.discardDraft,
      tags,
      params: draftItemParams,
      status: 204,
    },
    {
      operationId: `list${noun}Drafts`,
      method: 'get',
      path: `${collectionPath}/drafts`,
      summary: summaries.listDrafts,
      tags,
      params: lifecycleTenantParams,
      response: draftsResponse,
    },
    {
      operationId: `create${noun}Draft`,
      method: 'post',
      path: `${collectionPath}/drafts`,
      summary: summaries.createDraft,
      tags,
      params: lifecycleTenantParams,
      body: saveDraftBody,
      response: draftResponse,
    },
  ];
}
