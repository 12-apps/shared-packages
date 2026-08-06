import { listCatalogFields } from '../catalog';
import { ReportBuilderError } from '../errors';
import { runDashboard, runReport } from '../run';
import type { FieldCatalog, ReportDataSource } from '../types';

import {
  createSavedReportStore,
  type SavedReportDb,
  type SavedReportInput,
  type SavedReportRecord,
} from './saved';
import { canViewSavedReport } from './visibility';

/**
 * The one thing this package exposes to a BACKEND host (FUT-391).
 *
 * The endpoints used to live in the host: six route files that parsed a
 * request, called into this package, and shaped a response. Only the middle
 * step was ever the host's business — the parsing and the response shape are
 * this surface's contract, and the frontend half of that contract already
 * lives here. Splitting one contract across two repositories is how the client
 * and the server drift.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router. This
 * package must not take a web framework as a dependency — a host on a
 * different one could then never adopt it, and a host on the same one would
 * still be pinned to our version of it. A host adapts these in a few lines.
 */

/** What a host must resolve before a request reaches these handlers. */
export interface ReportActor {
  /** The tenant row id these reports belong to. */
  clientId: string;
  /** The signed-in user, for authorship checks. */
  userId: string | null;
  /** Role ids, for `visibility: 'roles'`. */
  roleIds: string[];
  /** OWNER/ADMIN — sees every saved report regardless of visibility. */
  isAdmin: boolean;
  /** Whether this actor may author (create/update/delete) saved reports. */
  canAuthor: boolean;
}

/** One request, already authenticated and routed by the host. */
export interface ReportRequest {
  actor: ReportActor;
  /** Path params the host's router captured (`id`, `key`, `dashboardKey`). */
  params: Record<string, string | undefined>;
  /** Query string, already parsed. */
  query: Record<string, string | undefined>;
  /** Parsed JSON body, for writes. */
  body?: unknown;
}

/** What a handler answers with; the host maps this onto its own response type. */
export interface ReportResponse {
  status: number;
  /** Success payloads ride a `{ data }` envelope — the shape the client reads. */
  body: unknown;
}

export interface ReportRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

export interface ReportBuilderServerConfig {
  catalog: FieldCatalog;
  /** How rows are read. The host owns the database; this owns the query. */
  adapter: ReportDataSource;
  /** Prisma-shaped client for saved reports, through the structural seam. */
  db: () => Promise<SavedReportDb>;
  /** Tenant IANA zone for date buckets. */
  timeZone?: string;
  /** Hard row cap for a single run. */
  maxRows?: number;
}

const ok = (data: unknown, status = 200): ReportResponse => ({ status, body: { data } });
const fail = (status: number, error: string): ReportResponse => ({ status, body: { error } });

/**
 * Lenient shape probe over the STORED document (never trusted): which variant
 * it is, and which entities it queries. A malformed or legacy value maps to no
 * entities, so it is listed for nobody rather than throwing the whole list.
 */
export function documentShape(spec: unknown): {
  type: 'report' | 'dashboard';
  entity: string;
  entities: string[];
} {
  const record = typeof spec === 'object' && spec !== null ? (spec as Record<string, unknown>) : {};
  if (record.kind === 'dashboard') {
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    const entities = [
      ...new Set(
        blocks
          .map((block) => {
            const inner =
              typeof block === 'object' && block !== null
                ? (block as { spec?: { entity?: unknown } }).spec
                : undefined;
            return String(inner?.entity ?? '');
          })
          .filter((entity) => entity !== ''),
      ),
    ];
    return { type: 'dashboard', entity: '', entities };
  }
  const entity = String(record.entity ?? '');
  return { type: 'report', entity, entities: entity === '' ? [] : [entity] };
}

function toSummary(record: SavedReportRecord): unknown {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ...documentShape(record.spec),
    status: record.status,
    visibility: record.visibility,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A stored document run for the period, in the shape the viewer reads. */
async function renderSaved(
  record: SavedReportRecord,
  config: ReportBuilderServerConfig,
): Promise<unknown> {
  const options = runOptions(config);
  const base = {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    visibility: record.visibility,
    visibilityRoles: record.visibilityRoles,
  };

  const shape = documentShape(record.spec);
  if (shape.type === 'dashboard') {
    const result = await runDashboard(record.spec, options);
    return { ...base, type: 'dashboard', spec: record.spec, blocks: result.blocks };
  }
  const result = await runReport(record.spec, options);
  return { ...base, type: 'report', spec: record.spec, render: result.render };
}

/**
 * A spec error is the AUTHOR's mistake, not a server fault: it comes back as
 * 400 with the compiler's own actionable message, which the builder shows
 * beside the field. Anything else is ours and propagates as a 500.
 */
function foldSpecError(error: unknown): ReportResponse {
  if (error instanceof ReportBuilderError) return fail(400, error.message);
  throw error;
}

/** Run options assembled once, so every route runs a spec the same way. */
function runOptions(config: ReportBuilderServerConfig) {
  return {
    catalog: config.catalog,
    adapter: config.adapter,
    ...(config.timeZone ? { timeZone: config.timeZone } : {}),
    ...(config.maxRows ? { maxRows: config.maxRows } : {}),
  };
}

/** The catalog the builder authors against. */
function catalogRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/fields',
    // Narrowing by permission is the HOST's job — it knows which entities this
    // actor may query — so it filters the answer rather than this guessing at
    // its policy.
    handle: () => Promise.resolve(ok(listCatalogFields(config.catalog))),
  };
}

/** Reading a tenant's saved documents, with visibility applied per actor. */
function savedReadRoutes(
  config: ReportBuilderServerConfig,
  store: ReturnType<typeof createSavedReportStore>,
): ReportRoute[] {
  return [
    {
      method: 'GET',
      path: '/reports/custom',
      async handle({ actor }) {
        const records = await store.list(actor.clientId);
        // Visibility is applied HERE, not in the query: `roles` needs the
        // actor's role ids, and a database-level filter would have to encode
        // the same rule a second time.
        return ok({
          reports: records.filter((record) => canViewSavedReport(record, actor)).map(toSummary),
        });
      },
    },
    {
      method: 'GET',
      path: '/reports/custom/:id',
      async handle({ actor, params }) {
        const record = await store.get(actor.clientId, params.id ?? '');
        // A report the actor may not see answers 404, not 403: 403 confirms
        // the id exists, which is itself a disclosure on a tenant surface.
        if (!record || !canViewSavedReport(record, actor)) {
          return fail(404, 'Relatório não encontrado.');
        }
        try {
          return ok(await renderSaved(record, config));
        } catch (error) {
          return foldSpecError(error);
        }
      },
    },
  ];
}

/**
 * Writing them. Separate from the reads because every route here is gated on
 * `canAuthor`, and a reader reviewing authorization wants that in one place.
 */
function savedWriteRoutes(store: ReturnType<typeof createSavedReportStore>): ReportRoute[] {
  return [
    {
      method: 'POST',
      path: '/reports/custom',
      authoring: true,
      async handle({ actor, body }) {
        if (!actor.canAuthor) return fail(403, 'Sem permissão para criar relatórios.');
        try {
          // Authorship comes from the ACTOR, never from the body — a client
          // that could name its own `createdBy` could author as someone else,
          // and authorship is what `visibility: 'private'` is judged on.
          const record = await store.create(actor.clientId, body as SavedReportInput, actor.userId);
          return ok(toSummary(record), 201);
        } catch (error) {
          return foldSpecError(error);
        }
      },
    },
    {
      method: 'PATCH',
      path: '/reports/custom/:id',
      authoring: true,
      async handle({ actor, params, body }) {
        if (!actor.canAuthor) return fail(403, 'Sem permissão para editar relatórios.');
        try {
          const record = await store.update(
            actor.clientId,
            params.id ?? '',
            body as SavedReportInput,
          );
          return record ? ok(toSummary(record)) : fail(404, 'Relatório não encontrado.');
        } catch (error) {
          return foldSpecError(error);
        }
      },
    },
    {
      method: 'DELETE',
      path: '/reports/custom/:id',
      authoring: true,
      async handle({ actor, params }) {
        if (!actor.canAuthor) return fail(403, 'Sem permissão para remover relatórios.');
        const removed = await store.remove(actor.clientId, params.id ?? '');
        return removed ? ok({ id: params.id }) : fail(404, 'Relatório não encontrado.');
      },
    },
  ];
}

/** The builder's live preview: compile + run a spec that was never saved. */
function runRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'POST',
    path: '/reports/run',
    async handle({ body }) {
      try {
        const result = await runReport((body as { spec?: unknown }).spec, runOptions(config));
        return ok({ render: result.render });
      } catch (error) {
        return foldSpecError(error);
      }
    },
  };
}

export function createReportBuilder(config: ReportBuilderServerConfig): {
  routes: ReportRoute[];
} {
  const store = createSavedReportStore(config.db);
  return {
    routes: [
      catalogRoute(config),
      ...savedReadRoutes(config, store),
      ...savedWriteRoutes(store),
      runRoute(config),
    ],
  };
}
