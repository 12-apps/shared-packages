import { z } from 'zod';

import type { JsonValue } from '../types';
import type {
  DraftWire,
  VersionComparisonWire,
  VersionsWire,
  VersionWire,
  WriteOutcomeWire,
} from '../wire';

/**
 * True only when `Schema` and `Wire` describe the SAME set of fields.
 *
 * `satisfies z.ZodType<Wire>` alone is one-way, and the direction it misses is
 * worth naming: a schema that declares MORE than the producer returns still
 * satisfies it, because a wider output is assignable to a narrower expectation.
 * Measured, not assumed — adding a field to a schema alone compiles clean under
 * `satisfies` and fails here.
 *
 * So each shape carries both. `satisfies` catches the dangerous direction (the
 * surface advertising LESS than the route sends — an agent never learns the
 * field exists) with an error that names the offending property; this catches
 * the other (advertising MORE — an agent is promised a field that never
 * arrives) with a blunter one.
 */
type Exact<Schema, Wire> = [Schema] extends [Wire]
  ? [Wire] extends [Schema]
    ? true
    : false
  : false;

/** Fails to compile unless `T` is `true` — the assertion `Exact` is fed to. */
type Assert<T extends true> = T;

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
}) satisfies z.ZodType<VersionWire>;

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
      // `z.custom` rather than `z.unknown`: identical JSON Schema (`{}`) and
      // identical parse behaviour — verified, not assumed — but it carries the
      // TYPE the core promises, so the assertion below can check it. A cell
      // value is JSON or null; `unknown` said nothing and agreed with nothing.
      value: z.custom<JsonValue | null>(),
    }),
  ),
});

const comparisonSchema = z.object({
  selectedVersion: z.number(),
  columns: z.array(comparisonColumnSchema),
  rows: z.array(comparisonRowSchema),
}) satisfies z.ZodType<VersionComparisonWire>;

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
}) satisfies z.ZodType<WriteOutcomeWire>;

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
  // A `Snapshot`, which is what the routes actually put here — same JSON Schema
  // as `z.unknown()`, same parse behaviour, but a type the assertion can hold
  // to. The draft BODY above stays open on purpose; this is the read.
  data: z.record(z.string(), z.custom<JsonValue>()),
  status: z.enum(['OPEN', 'PUBLISHED', 'DISCARDED']),
  updatedAt: z.string(),
}) satisfies z.ZodType<DraftWire>;

export const draftResponse = z.object({
  data: z.object({ draft: draftSchema.nullable() }),
});

export const draftsResponse = z.object({
  data: z.object({ drafts: z.array(draftSchema) }),
});

/**
 * The five payload shapes, each held to the wire vocabulary in both directions.
 *
 * A type alias rather than five assertions inline: `Assert` rejects `false` at
 * the position that produced it, so a failure names WHICH shape drifted, and
 * exporting it keeps a lint rule from deleting the whole guard as dead code.
 *
 * If one of these lights up, do not widen the schema to make it pass — find out
 * which side changed. The producer in `server/` is the byte that ships; the
 * schema is what an agent was told to expect.
 */
export type LifecycleSchemasMatchTheWire = [
  Assert<Exact<z.infer<typeof versionSummarySchema>, VersionWire>>,
  Assert<Exact<z.infer<typeof comparisonSchema>, VersionComparisonWire>>,
  Assert<Exact<z.infer<typeof writeOutcomeSchema>, WriteOutcomeWire>>,
  Assert<Exact<z.infer<typeof draftSchema>, DraftWire>>,
  Assert<Exact<z.infer<typeof versionsResponse>['data'], VersionsWire>>,
];
