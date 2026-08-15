import { ReportBuilderError } from '../errors';
import type { ReportSpec } from '../spec';
import type { FieldCatalog, ReportDataSource } from '../types';

import type { ReportWindow } from './adapter-shared';
import { DEFAULT_AUTHOR_PERMISSION } from './contribution';
import { REPORT_RUN_MAX_ROWS } from './policy';
import type { SystemReportDef } from './system-reports';
import {
  rangeFromQuery,
  resolveReportRange,
  type ResolvedReportRange,
  toReportRangeView,
} from './range';
import type { SavedReportDb } from './saved';

/**
 * What every route in this surface shares: the actor, the request, the
 * response envelope, and the four decisions each handler would otherwise make
 * for itself — which window it runs over, which adapter that window gets,
 * whether the actor may reach the entity, and how a spec error folds.
 *
 * Split out of `create-report-builder.ts` so the routes can live in files
 * grouped by what they do rather than in one module holding the whole surface.
 */

/** What a host must resolve before a request reaches these handlers. */
export interface ReportActor {
  /** The tenant row id these reports belong to. */
  clientId: string;
  /** The signed-in user, for authorship checks. */
  userId: string | null;
  /** Role ids, for `visibility: 'roles'`. */
  roleIds: string[];
  /**
   * The tenant's admin tier — sees every saved report regardless of its
   * visibility. A host FACT about the caller, not a permission: it is the
   * "reads everything in this tenant" rung, which every host spells in its own
   * role names.
   */
  isAdmin: boolean;
  /**
   * The permission ids this actor holds on the tenant. Every entity, preset and
   * saved document is narrowed against this set, and authoring is decided by
   * it too (see `gatePermissions`).
   *
   * Required, and deliberately not defaulted: a host that forgot to pass it
   * gets an empty surface (fail closed), never the whole catalog.
   */
  permissions: readonly string[];
}

/** One request, already authenticated and routed by the host. */
export interface ReportRequest {
  actor: ReportActor;
  /** Path params the host's router captured (`id`, `key`). */
  params: Record<string, string | undefined>;
  /** Query string, already parsed. */
  query: Record<string, string | undefined>;
  /** Parsed JSON body, for writes. */
  body?: unknown;
}

/** What a handler answers with; the host maps this onto its own response type. */
export interface ReportResponse {
  status: number;
  /**
   * Success payloads ride a `{ data }` envelope — the shape the client reads.
   * `undefined` means NO body at all (204), which is not the same as `null`.
   */
  body: unknown;
}

export interface ReportRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * Path relative to the host's reports mount, in `:param` form. The host maps
   * this to its own syntax; the SHAPE is fixed because the client builds these
   * URLs.
   */
  path: string;
  /** True when the actor must be able to author — the host may gate earlier. */
  authoring?: boolean;
  handle(request: ReportRequest): Promise<ReportResponse>;
}

/**
 * How a tenant-scoped, window-scoped DataSource is obtained.
 *
 * A plain source is accepted for hosts (and harnesses) whose data does not
 * move: it is used for every window unchanged. A FACTORY is what a real host
 * passes, because the window has to reach the database — scoping the reads in
 * the query is the difference between "30 days of orders" and "every order
 * this tenant ever had, filtered in memory".
 */
export type ReportAdapterFactory = (context: {
  actor: ReportActor;
  window: ReportWindow;
}) => ReportDataSource | Promise<ReportDataSource>;

export interface ReportBuilderServerConfig {
  /** The semantic model every spec is validated against. The host's. */
  catalog: FieldCatalog;
  /** How rows are read. The host owns the database; this owns the query. */
  adapter: ReportDataSource | ReportAdapterFactory;
  /** Prisma-shaped client for saved reports, through the structural seam. */
  db: () => Promise<SavedReportDb>;
  /**
   * Tenant IANA zone for date buckets AND for the window's day boundaries.
   *
   * REQUIRED. It used to be optional and fall through to the engine's
   * `America/Sao_Paulo`, so a host that never mentioned a clock ran every
   * report on a Brazilian trading day: "hoje" opened at 03:00 UTC and a
   * midnight sale landed in yesterday's report. There is no neutral answer
   * here — only the host knows what its tenants call a day — so it is asked
   * for rather than guessed, and validated as an IANA name at assembly.
   */
  timeZone: string;
  /** Hard row cap for a single run. Defaults to {@link REPORT_RUN_MAX_ROWS}. */
  maxRows?: number;
  /**
   * Permission required to query each catalog entity — the host's ids, for the
   * host's data.
   *
   * REQUIRED, and every catalog entity must appear (checked at assembly). It
   * used to default to the origin host's map, which meant a silent host's `orders`
   * entity was gated by `reports:sales:read` — an id belonging to another
   * application's catalog — while an entity that map did not name was
   * queryable by nobody at all. Both halves were policy nobody had stated.
   */
  entityPermission: Record<string, string>;
  /**
   * The built-in reports offered at `/reports/system`. Pass `[]` to serve none.
   *
   * REQUIRED, including the empty case: it used to default to the origin host's
   * seven presets, so a host that named none advertised `vendas-resumo` and
   * `cozinha-por-cozinheiro` over its own catalog. Each is compile-validated
   * against `catalog` at assembly.
   */
  systemReports: readonly SystemReportDef[];
  /**
   * The known-good spec each entity opens with, keyed by entity, served on
   * `/reports/fields` so the builder prefills a runnable report and MCP authors
   * start from something that already compiles.
   *
   * REQUIRED, including the empty case, for the same reason `systemReports` is:
   * this was the last field of the host's vocabulary still `?? {}`-defaultable,
   * and a defaultable vocabulary field is exactly what this surface stopped
   * having. `{}` is a complete answer — every entity is then served without a
   * `starter` — but it is one the host has to give. Each entry is
   * compile-validated against `catalog` at assembly, and its spec's own
   * `entity` must be the key it is filed under.
   */
  starters: Readonly<Record<string, ReportSpec>>;
  /**
   * How this host spells the permissions guarding THIS package's own surface.
   *
   * Optional, because the default is this package's own contributed id
   * (`reports:manage`, see {@link REPORT_BUILDER_PERMISSIONS}) rather than
   * another application's: a host that says nothing inherits the policy of the
   * package whose screens these are. A host whose catalog spells it differently
   * maps it here.
   */
  gatePermissions?: {
    /** Create/update/delete a saved report, and every working-copy write. */
    manage: string;
  };
  /** Clock, injectable so a test can pin the window a rolling preset resolves. */
  now?: () => Date;
}

export const ok = (data: unknown, status = 200): ReportResponse => ({ status, body: { data } });
export const fail = (status: number, error: string): ReportResponse => ({
  status,
  body: { error },
});

/** 403 with the message the host's own forbidden error carries. */
export const forbidden = (): ReportResponse => fail(403, 'Acesso negado.');

export const NOT_FOUND = 'Relatório não encontrado.';

/**
 * A spec (or period) error is the CALLER's mistake, not a server fault: it
 * comes back as 400 with the compiler's own actionable message, which the
 * builder shows beside the field. Anything else is ours and propagates.
 */
export function foldSpecError(error: unknown): ReportResponse {
  if (error instanceof ReportBuilderError) return fail(400, error.message);
  throw error;
}

/** Whether an error is Prisma's unique-name violation on the saved table. */
export function isDuplicateName(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Whether the actor may AUTHOR — every write behind the editor.
 *
 * A permission check, not the `canAuthor` boolean it replaces. That boolean
 * made each host derive an answer this package's own surface decides, and the
 * derivation was invisible from here: the origin host computed it from a hardcoded
 * set of role names, so "who may build a report" was not expressible as a grant
 * in the very role editor that grants everything else.
 */
export function mayAuthor(config: ReportBuilderServerConfig, actor: ReportActor): boolean {
  return actor.permissions.includes(config.gatePermissions?.manage ?? DEFAULT_AUTHOR_PERMISSION);
}

/** Whether the actor may query this entity. An unmapped entity: nobody may. */
export function mayQueryEntity(
  config: ReportBuilderServerConfig,
  actor: ReportActor,
  entity: string,
): boolean {
  const required = config.entityPermission[entity];
  return required !== undefined && actor.permissions.includes(required);
}

/**
 * Whether the actor may query ANY entity of the catalog at all.
 *
 * This is the "can you see the reports area" question, and it answers 403
 * rather than an empty page on every route that asks it. An empty list is a
 * statement — "you have no saved reports" — and it is the wrong statement to
 * make to someone who simply was not granted the feature.
 */
export function mayQueryAnything(
  config: ReportBuilderServerConfig,
  actor: ReportActor,
): boolean {
  return Object.keys(config.catalog.entities).some((entity) =>
    mayQueryEntity(config, actor, entity),
  );
}

/**
 * Whether the actor may query EVERY entity a document touches: a dashboard
 * runs all its blocks, so seeing it requires the tier of each block's entity.
 * A document naming no entity (malformed or legacy) is visible to nobody.
 */
export function mayQueryAll(
  config: ReportBuilderServerConfig,
  actor: ReportActor,
  entities: readonly string[],
): boolean {
  return (
    entities.length > 0 && entities.every((entity) => mayQueryEntity(config, actor, entity))
  );
}

/** The window this request runs over, on the tenant's clock. */
export function windowOf(
  config: ReportBuilderServerConfig,
  request: Pick<ReportRequest, 'query'>,
): ResolvedReportRange {
  const now = config.now ? config.now() : new Date();
  return resolveReportRange(rangeFromQuery(request.query), now, config.timeZone);
}

/** A period named in a REQUEST BODY (the dry run) rather than in the query. */
export function windowOfBody(
  config: ReportBuilderServerConfig,
  body: { preset?: unknown; from?: unknown; to?: unknown } | undefined,
): ResolvedReportRange {
  return windowOf(config, {
    query: {
      preset: typeof body?.preset === 'string' ? body.preset : undefined,
      from: typeof body?.from === 'string' ? body.from : undefined,
      to: typeof body?.to === 'string' ? body.to : undefined,
    },
  });
}

export { toReportRangeView, type ResolvedReportRange };

/**
 * Run options assembled once, so every route runs a spec the same way — the
 * same catalog, the same row cap, the same clock, and an adapter scoped to
 * THIS request's window.
 */
export async function runOptions(
  config: ReportBuilderServerConfig,
  actor: ReportActor,
  range: ResolvedReportRange,
): Promise<{
  catalog: FieldCatalog;
  adapter: ReportDataSource;
  timeZone: string;
  maxRows: number;
}> {
  const window: ReportWindow = { from: range.from, toExclusive: range.toExclusive };
  const adapter =
    typeof config.adapter === 'function' ? await config.adapter({ actor, window }) : config.adapter;
  return {
    catalog: config.catalog,
    adapter,
    timeZone: config.timeZone,
    maxRows: config.maxRows ?? REPORT_RUN_MAX_ROWS,
  };
}
