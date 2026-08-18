import { z } from 'zod';

/**
 * The wire schemas every lifecycle-plugged collection shares.
 *
 * Authored ONCE, here, rather than per collection. A host that plugs six
 * collections into this package gets six identical version histories, six
 * identical draft surfaces and six identical write outcomes, because the same
 * handlers serve all of them. Six copies of the schemas describing them is six
 * chances for one to fall behind, and that failure presents as a manifest
 * advertising a field the route stopped returning for exactly one entity.
 *
 * Exported so a host's ROUTE handlers validate with the same objects the tool
 * surface is generated from. That is the property worth protecting: not that
 * the schemas match, but that there is only one of them.
 */

/** Every lifecycle route is tenant-scoped. */
export const lifecycleTenantParams = z.object({
  tenantSlug: z.string().min(1),
});

/**
 * Version-history params, identical across every plugged collection:
 * `{ tenantSlug, id }` to list a record's history, `+ version` to address one.
 */
export const versionsParams = z.object({
  tenantSlug: z.string().min(1),
  id: z.string().min(1),
});

export const versionItemParams = versionsParams.extend({
  version: z.coerce.number().int().min(1),
});

/** One history row as the API returns it (actor resolved to a display name). */
const versionSummarySchema = z.object({
  version: z.number(),
  kind: z.enum(['CREATE', 'UPDATE', 'RESTORE']),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  changedFields: z.array(z.string()),
  removedFields: z.array(z.string()),
  restoredFromVersion: z.number().nullable(),
});

/**
 * Ask the history endpoint to ALSO compare one version with its neighbours
 * (FUT-247). Optional, and absent by default: the list is the cheap read every
 * caller makes, and materializing four versions is not.
 */
export const versionsQuery = z.object({
  compare: z.coerce.number().int().min(1).optional(),
});

/** What a compared version is to the selection (a version can play two). */
const comparisonRoleSchema = z.enum(['previous', 'selected', 'next', 'current']);

/**
 * One column of the comparison table. `roles` is a LIST because the newest
 * version is both `next` and `current`, and a record with a single version is
 * both `selected` and `current`.
 */
const comparisonColumnSchema = z.object({
  version: z.number(),
  roles: z.array(comparisonRoleSchema),
  kind: z.enum(['CREATE', 'UPDATE', 'RESTORE']),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * One field across every column. `present: false` means the version did not
 * carry the field AT ALL — distinct from a field whose value is null, which is
 * a value the admin chose.
 */
const comparisonRowSchema = z.object({
  field: z.string(),
  changed: z.boolean(),
  cells: z.array(
    z.object({
      version: z.number(),
      present: z.boolean(),
      value: z.unknown(),
    }),
  ),
});

const comparisonSchema = z.object({
  selectedVersion: z.number(),
  columns: z.array(comparisonColumnSchema),
  rows: z.array(comparisonRowSchema),
});

export const versionsResponse = z.object({
  data: z.object({
    versions: z.array(versionSummarySchema),
    publishedVersion: z.number(),
    /** Present only when the request asked for a comparison. */
    comparison: comparisonSchema.nullish(),
  }),
});

/** A write that may be parked for approval instead of applied. */
const writeOutcomeSchema = z.object({
  applied: z.boolean(),
  entityId: z.string().nullable(),
  requestId: z.string().nullable(),
});

export const writeOutcomeResponse = z.object({ data: writeOutcomeSchema });

/**
 * A draft's payload is the entity's loose working copy — deliberately an open
 * JSON object (validated only at PUBLISH time against the current schema, the
 * schema-drift-tolerant posture).
 */
export const saveDraftBody = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const draftItemParams = z.object({
  tenantSlug: z.string().min(1),
  draftId: z.string().min(1),
});

const draftSchema = z.object({
  id: z.string(),
  entityId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  status: z.enum(['OPEN', 'PUBLISHED', 'DISCARDED']),
  updatedAt: z.string(),
});

export const draftResponse = z.object({
  data: z.object({ draft: draftSchema.nullable() }),
});

export const draftsResponse = z.object({
  data: z.object({ drafts: z.array(draftSchema) }),
});
