import { invalidSpecError } from '../errors';
import { parseReportDocument } from '../run';

import { compileDocument } from './compile-document';
import {
  fail,
  foldSpecError,
  isDuplicateName,
  NOT_FOUND,
  mayAuthor,
  ok,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from './context';
import type { SavedReportInput, SavedReportRecord, SavedReportStore } from './saved';
import { toSummary } from './summary';
import { canViewSavedReport, visibilityRoleIds } from './visibility';
import { saveReportBody } from './wire';
import { DEFAULT_AUTHOR_PERMISSION } from './contribution';
import { REPORT_BUILDER_FEATURES } from './features';

/**
 * Writing saved documents. Separate from the reads because every route here is
 * gated on the authoring permission, and a reader reviewing authorization wants
 * that in one place.
 *
 * Authoring is only HALF of what a write on an existing document needs, and the
 * missing half was invisible while `canAuthor` was a role tier: the hosts that
 * computed it named the same roles their admin tier named, and
 * `canViewSavedReport` short-circuits on `isAdmin`, so "may author" implied "may
 * see everything" by coincidence rather than by rule. Authoring is a grantable
 * class permission now (`reports:manage`), and a store may hand it to a member
 * who is not an admin — at which point that member could overwrite, re-share or
 * DELETE a private draft whose `GET` answers them 404. So every write on an
 * existing document re-asks the READ question first: the write surface is never
 * wider than the read surface, and it says so with the same 404, because a 403
 * here would confirm the existence of a document the reader is told does not
 * exist.
 */

const DUPLICATE_NAME = 'Já existe um relatório com esse nome.';

type SaveBody = ReturnType<typeof saveReportBody.parse>;

/**
 * Validate the incoming body against the package's own wire schema. The host
 * may have validated it too, but it does not have to: this surface's contract
 * is authored here, so it is enforced here, and a host on a framework with no
 * schema layer gets the same 400s as one with it.
 */
function parseSaveBody(body: unknown): SaveBody {
  const parsed = saveReportBody.safeParse(body);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw invalidSpecError(
    first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Corpo inválido.',
  );
}

/**
 * The lifecycle a write lands on. Omitted fields KEEP the stored values on an
 * update (`current`) and take the pre-lifecycle defaults on a create — so an
 * MCP author updating only the spec never accidentally publishes a draft or
 * resets its sharing.
 */
function lifecycleFor(
  body: SaveBody,
  current: SavedReportRecord | null,
): Pick<SavedReportInput, 'status' | 'visibility' | 'visibilityRoles' | 'defaultRange'> {
  return {
    status: body.status ?? current?.status ?? 'published',
    visibility: body.visibility ?? current?.visibility ?? 'tenant',
    visibilityRoles:
      body.visibilityRoles ?? (current ? visibilityRoleIds(current.visibilityRoles) : []),
    defaultRange: defaultRangeFor(body, current),
  };
}

/**
 * The period the saved report opens on, after a write.
 *
 * `undefined` keeps what is stored and an explicit `null` clears it — the same
 * omitted-keeps rule the lifecycle fields follow, which is what lets an MCP
 * author patch a spec without resetting the period the report opens on.
 */
function defaultRangeFor(body: SaveBody, current: SavedReportRecord | null): string | null {
  if (body.defaultRange !== undefined) return body.defaultRange;
  return current?.defaultRange ?? null;
}

function toInput(body: SaveBody, current: SavedReportRecord | null): SavedReportInput {
  return {
    name: body.name,
    description: body.description ?? null,
    spec: body.spec,
    ...lifecycleFor(body, current),
  };
}

function createRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'POST',
    path: '/reports/custom',
    permission: DEFAULT_AUTHOR_PERMISSION,
    quota: REPORT_BUILDER_FEATURES.custom,
    authoring: true,
    async handle({ actor, body }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para criar relatórios.');
      try {
        const input = parseSaveBody(body);
        compileDocument(parseReportDocument(input.spec), config.catalog);
        // Authorship comes from the ACTOR, never from the body — a client
        // that could name its own `createdBy` could author as someone else,
        // and authorship is what `visibility: 'private'` is judged on.
        const record = await store.create(actor.clientId, toInput(input, null), actor.userId);
        return ok(toSummary(record, actor.userId));
      } catch (error) {
        if (isDuplicateName(error)) return fail(409, DUPLICATE_NAME);
        return foldSpecError(error);
      }
    },
  };
}

function updateRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'PUT',
    path: '/reports/custom/:id',
    permission: DEFAULT_AUTHOR_PERMISSION,
    entitlement: REPORT_BUILDER_FEATURES.custom,
    authoring: true,
    async handle({ actor, params, body }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para editar relatórios.');
      const id = params.id ?? '';
      try {
        const input = parseSaveBody(body);
        compileDocument(parseReportDocument(input.spec), config.catalog);
        const current = await store.get(actor.clientId, id);
        // Absent, or present-but-invisible: the same 404 the reader gets, so an
        // author-permission holder learns nothing here they could not learn
        // from `GET /reports/custom/:id`.
        if (!current || !canViewSavedReport(current, actor)) return fail(404, NOT_FOUND);
        const record = await store.update(actor.clientId, id, toInput(input, current));
        return record ? ok(toSummary(record, actor.userId)) : fail(404, NOT_FOUND);
      } catch (error) {
        if (isDuplicateName(error)) return fail(409, DUPLICATE_NAME);
        return foldSpecError(error);
      }
    },
  };
}

function deleteRoute(
  config: ReportBuilderServerConfig,
  store: SavedReportStore,
): ReportRoute {
  return {
    method: 'DELETE',
    path: '/reports/custom/:id',
    permission: DEFAULT_AUTHOR_PERMISSION,
    authoring: true,
    async handle({ actor, params }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para remover relatórios.');
      const id = params.id ?? '';
      // READ BEFORE DELETE. The store's `remove` is tenant-scoped and would
      // happily destroy a document this actor may not open, which is the widest
      // possible version of the fail-open: the only feedback is that the row is
      // gone.
      const current = await store.get(actor.clientId, id);
      if (!current || !canViewSavedReport(current, actor)) return fail(404, NOT_FOUND);
      const removed = await store.remove(actor.clientId, id);
      // 204 with NO body: there is nothing to say about a document that no
      // longer exists, and an envelope here would be the only write on this
      // surface answering with one.
      return removed ? { status: 204, body: undefined } : fail(404, NOT_FOUND);
    },
  };
}

export function savedWriteRoutes(
  config: ReportBuilderServerConfig,
  store: SavedReportStore,
): ReportRoute[] {
  return [createRoute(config, store), updateRoute(config, store), deleteRoute(config, store)];
}
