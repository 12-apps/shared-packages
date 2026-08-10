import { runDashboard, runReport, parseReportDocument, type DashboardRunResult } from '../run';
import { documentEntities, isDashboardSpec, type ReportDocument } from '../spec';

import {
  fail,
  foldSpecError,
  forbidden,
  mayQueryAll,
  mayQueryAnything,
  NOT_FOUND,
  ok,
  runOptions,
  toReportRangeView,
  windowOf,
  type ReportActor,
  type ReportBuilderServerConfig,
  type ReportRoute,
  type ResolvedReportRange,
} from './context';
import type { SavedReportRecord, SavedReportStore } from './saved';
import { documentShape, toSummary } from './summary';
import { resolveDefaultRange } from './range';
import { canViewSavedReport, visibilityRoleIds } from './visibility';
import { readWorkingCopy, type ReportWorkingCopy } from './working-copy';

/**
 * Reading a tenant's saved documents.
 *
 * Two narrowings compose on both routes, and they are NOT the same rule: the
 * lifecycle gate asks whether this actor may see this document (drafts are
 * author+admin-only; a published one follows its visibility), and the entity
 * gate asks whether they may query what it reads. A document failing either is
 * absent — 404, never 403, because a 403 confirms the id exists, which is
 * itself a disclosure on a tenant surface.
 */

/**
 * The lifecycle fields echoed on every opened document — plus, for a caller
 * who may AUTHOR, the edit parked beside it (FUT-755).
 *
 * Everything else in the payload stays the PUBLISHED document whoever is
 * asking: a reader opening a report while its author is editing must see what
 * is live. Only an author is handed the parked copy, and only the editor asks.
 */
function lifecycleOf(
  record: SavedReportRecord,
  actor: ReportActor,
): {
  status: string;
  visibility: string;
  visibilityRoles: string[];
  defaultRange: string;
  workingCopy: ReportWorkingCopy | null;
} {
  return {
    status: record.status,
    visibility: record.visibility,
    visibilityRoles: visibilityRoleIds(record.visibilityRoles),
    workingCopy: actor.canAuthor ? readWorkingCopy(record.workingCopy) : null,
    // Resolved rather than echoed: a row written before the column existed
    // carries NULL, and the client should be told the period it will actually
    // open on rather than left to re-derive the fallback (FUT-755).
    defaultRange: resolveDefaultRange(record.defaultRange),
  };
}

/** The block shape the viewer reads: layout + sentence + result or error. */
function toBlockRender(result: DashboardRunResult): unknown[] {
  return result.blocks.map((block) =>
    block.status === 'ok'
      ? {
          id: block.id,
          title: block.title,
          span: block.span,
          sentence: block.sentence,
          status: block.status,
          render: block.render,
        }
      : {
          id: block.id,
          title: block.title,
          span: block.span,
          sentence: block.sentence,
          status: block.status,
          error: block.error,
        },
  );
}

/** Run a stored document for the window, in the shape the viewer reads. */
async function renderSaved(
  record: SavedReportRecord,
  document: ReportDocument,
  range: ResolvedReportRange,
  actor: ReportActor,
  config: ReportBuilderServerConfig,
): Promise<unknown> {
  const options = await runOptions(config, actor, range);
  const base = {
    id: record.id,
    name: record.name,
    description: record.description,
    ...lifecycleOf(record, actor),
    range: toReportRangeView(range),
  };

  if (isDashboardSpec(document)) {
    const result = await runDashboard(document, options);
    return { ...base, type: 'dashboard', spec: result.spec, blocks: toBlockRender(result) };
  }
  const result = await runReport(document, options);
  return { ...base, type: 'report', spec: result.spec, render: result.render };
}

/** The tenant's saved documents, narrowed twice. */
function listRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/custom',
    async handle({ actor }) {
      // Reaching no entity at all is not "you have no saved reports", it is a
      // caller the feature was never granted to — the same answer
      // `/reports/fields` and `/reports/system` give, so the three routes of
      // one area cannot disagree about whether it is visible.
      if (!mayQueryAnything(config, actor)) return forbidden();
      const records = await store.list(actor.clientId);
      // Visibility is applied HERE, not in the query: `roles` needs the
      // actor's role ids, and a database-level filter would have to encode
      // the same rule a second time.
      const reports = records
        .filter((record) => canViewSavedReport(record, actor))
        // Not `.map(toSummary)`: `map` hands the INDEX to the second parameter,
        // which is `viewerId` here — every row would compare its author against
        // 0, 1, 2…, and `Meus` would come back empty for everyone.
        .map((record) => toSummary(record, actor.userId))
        .filter((summary) => mayQueryAll(config, actor, summary.entities));
      return ok({ reports });
    },
  };
}

/** Open AND run one saved document — the viewer's single round trip. */
function getRoute(config: ReportBuilderServerConfig, store: SavedReportStore): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/custom/:id',
    async handle({ actor, params, query }) {
      const record = await store.get(actor.clientId, params.id ?? '');
      if (!record || !canViewSavedReport(record, actor)) return fail(404, NOT_FOUND);
      // The entity gate reads the STORED shape rather than the parsed
      // document, so a document that no longer compiles is still refused to an
      // actor who may not read its entities — authorization before validation.
      if (!mayQueryAll(config, actor, documentShape(record.spec).entities)) return forbidden();
      try {
        const document = parseReportDocument(record.spec);
        // Re-checked against the PARSED entities: the lenient probe above is
        // deliberately forgiving, and a document whose real entities differ
        // from the ones it appeared to name must not slip past on the
        // appearance.
        if (!mayQueryAll(config, actor, documentEntities(document))) return forbidden();
        const range = windowOf(config, { query });
        return ok(await renderSaved(record, document, range, actor, config));
      } catch (error) {
        return foldSpecError(error);
      }
    },
  };
}

export function savedReadRoutes(
  config: ReportBuilderServerConfig,
  store: SavedReportStore,
): ReportRoute[] {
  return [listRoute(config, store), getRoute(config, store)];
}
