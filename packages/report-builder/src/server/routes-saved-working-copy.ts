import { invalidSpecError } from '../errors';
import { parseReportDocument } from '../run';

import { compileDocument } from './compile-document';
import {
  fail,
  foldSpecError,
  isDuplicateName,
  mayAuthor,
  NOT_FOUND,
  ok,
  type ReportActor,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from './context';
import type { SavedReportRecord, SavedReportStore } from './saved';
import { toSummary } from './summary';
import { canViewSavedReport, visibilityRoleIds } from './visibility';
import { parksEditsInWorkingCopy, reportWorkingCopySchema } from './working-copy';

/**
 * Unpublished changes to a PUBLISHED report (FUT-755): park, publish, discard.
 *
 * Three routes rather than a flag on the existing save, because they are three
 * different promises about the live document:
 *
 *   PUT    /reports/custom/:id/working-copy          — park; `spec` untouched
 *   POST   /reports/custom/:id/working-copy/publish  — go live AND drop the park
 *   DELETE /reports/custom/:id/working-copy          — drop the park; nothing goes live
 *
 * `PUT /reports/custom/:id` is deliberately left alone and does NOT clear a
 * parked edit: archiving a report re-sends its document with only `status`
 * changed, and that must not destroy work its author has not looked at since.
 */

const NOT_PUBLISHED =
  'Só um relatório publicado guarda alterações não publicadas. Salve o rascunho normalmente.';
const NO_WORKING_COPY = 'Este relatório não tem alterações não publicadas.';
const DUPLICATE_NAME = 'Já existe um relatório com esse nome.';

/**
 * The stored row, or the 404 every route on this surface answers with.
 *
 * Three gates in a deliberate order. Absent is 404; VISIBLE-TO-THIS-ACTOR is
 * the same 404, because `reports:manage` is a grantable class permission and
 * nothing else on this surface would stop its holder from parking an edit on —
 * or publishing over — a private draft their own `GET` answers 404 for. Only
 * then does the lifecycle answer 400: a "this report is not published" told to
 * someone who may not see the report at all is itself a disclosure.
 */
async function loadPublished(
  store: SavedReportStore,
  actor: ReportActor,
  id: string,
): Promise<SavedReportRecord | { error: ReturnType<typeof fail> }> {
  const record = await store.get(actor.clientId, id);
  if (!record) return { error: fail(404, NOT_FOUND) };
  if (!canViewSavedReport(record, actor)) return { error: fail(404, NOT_FOUND) };
  if (!parksEditsInWorkingCopy(record.status)) return { error: fail(400, NOT_PUBLISHED) };
  return record;
}

function isFailure(
  value: SavedReportRecord | { error: ReturnType<typeof fail> },
): value is { error: ReturnType<typeof fail> } {
  return 'error' in value;
}

/**
 * Park the author's in-progress edit.
 *
 * Validated for SHAPE (`reportWorkingCopySchema`) but NOT compiled against the
 * field catalog, which is the one judgement call in this file. An autosave
 * fires while the author is mid-edit, and mid-edit a spec is legitimately
 * catalog-invalid — a half-configured block names a field it has not chosen
 * yet. Refusing to store it would mean the work most at risk is precisely the
 * work never saved. The compile still happens where it decides something: on
 * publish, before anything reaches a reader.
 */
function saveRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'PUT',
    path: '/reports/custom/:id/working-copy',
    authoring: true,
    async handle({ actor, params, body }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para editar relatórios.');
      const parsed = reportWorkingCopySchema.safeParse(body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return fail(400, first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Corpo inválido.');
      }
      const record = await loadPublished(store, actor, params.id ?? '');
      if (isFailure(record)) return record.error;
      const saved = await store.saveWorkingCopy(actor.clientId, record.id, parsed.data);
      return saved ? ok({ saved: true }) : fail(404, NOT_FOUND);
    },
  };
}

/**
 * Publish the edit: it becomes the live document and the park is dropped, in
 * one write.
 *
 * The body is the editor's CURRENT state rather than whatever the last autosave
 * managed to store — publishing has to mean "what I am looking at", and a
 * debounce that had not fired yet would otherwise publish the keystroke before
 * last.
 */
function publishRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'POST',
    path: '/reports/custom/:id/working-copy/publish',
    authoring: true,
    async handle({ actor, params, body }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para editar relatórios.');
      const record = await loadPublished(store, actor, params.id ?? '');
      if (isFailure(record)) return record.error;
      try {
        const input = parsePublishBody(body, record);
        compileDocument(parseReportDocument(input.spec), config.catalog);
        const saved = await store.publishWorkingCopy(actor.clientId, record.id, input);
        return saved ? ok(toSummary(saved, actor.userId)) : fail(404, NOT_FOUND);
      } catch (error) {
        if (isDuplicateName(error)) return fail(409, DUPLICATE_NAME);
        return foldSpecError(error);
      }
    },
  };
}

/** Throw the parked edit away; the published document was never touched. */
function discardRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'DELETE',
    path: '/reports/custom/:id/working-copy',
    authoring: true,
    async handle({ actor, params }) {
      if (!mayAuthor(config, actor)) return fail(403, 'Sem permissão para editar relatórios.');
      const record = await loadPublished(store, actor, params.id ?? '');
      if (isFailure(record)) return record.error;
      // A 404 rather than a silent 200: "discard" that discarded nothing would
      // tell the editor to reset to a published version it is already showing,
      // hiding the fact that the parked edit is still on the server.
      if (record.workingCopy === null || record.workingCopy === undefined) {
        return fail(404, NO_WORKING_COPY);
      }
      const discarded = await store.discardWorkingCopy(actor.clientId, record.id);
      return discarded ? ok({ discarded: true }) : fail(404, NOT_FOUND);
    },
  };
}

/**
 * The publish body, held to the STRICT rules a live document must satisfy —
 * a name is required here even though the park accepts an empty one, because
 * an unnamed report on the list is a row nobody can identify.
 *
 * Lifecycle fields fall back to the stored record, matching the omitted-keeps
 * rule the ordinary save follows.
 */
function parsePublishBody(
  body: unknown,
  current: SavedReportRecord,
): {
  name: string;
  description: string | null;
  spec: unknown;
  status: string;
  visibility: string;
  visibilityRoles: string[];
  defaultRange: string | null;
} {
  const parsed = reportWorkingCopySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw invalidSpecError(
      first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Corpo inválido.',
    );
  }
  const input = parsed.data;
  if (input.name.trim() === '') throw invalidSpecError('name: Dê um nome ao relatório.');
  return {
    name: input.name,
    description: input.description ?? null,
    spec: input.spec,
    status: input.status ?? current.status,
    visibility: input.visibility ?? current.visibility,
    visibilityRoles: input.visibilityRoles ?? visibilityRoleIds(current.visibilityRoles),
    defaultRange: input.defaultRange ?? current.defaultRange,
  };
}

export function savedWorkingCopyRoutes(
  config: ReportBuilderServerConfig,
  store: SavedReportStore,
): ReportRoute[] {
  return [saveRoute(config, store), publishRoute(config, store), discardRoute(config, store)];
}
