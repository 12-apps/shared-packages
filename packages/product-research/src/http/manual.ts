import { normalizeManualRows, parseCsvPriceList } from '../import/manual';
import type { ManualPriceRowInput, ManualRowProblem } from '../import/manual';
import { MANUAL_PRICE_DEFAULT_VALIDITY_DAYS } from './types';
import type { ResearchApiConfig, ResearchRoute } from './types';
import { ok, recordOf, refuse, intOf } from './shared';

/**
 * The MANUAL source's price list and one-off quotes — the importer the
 * package already ships, behind the routes that feed it. Unimportable rows
 * come back in `problems` with their line numbers: surfaced, never dropped
 * silently.
 */
function validUntilOf(config: ResearchApiConfig, named: unknown): Date {
  if (typeof named === 'string' && named !== '') return new Date(named);
  const now = config.now ?? ((): Date => new Date());
  const stamp = new Date(now());
  stamp.setUTCDate(stamp.getUTCDate() + MANUAL_PRICE_DEFAULT_VALIDITY_DAYS);
  return stamp;
}

/** The imported list: the paged read and the rows/CSV import. */
function priceListRoutes(config: ResearchApiConfig): ResearchRoute[] {
  const { store } = config;
  return [
    {
      method: 'GET',
      path: '/research/sources/:sourceId/prices',
      permission: 'research:read',
      // Expired entries stay listed for audit; they no longer join new runs.
      async handle({ actor, params, query }) {
        const sourceId = params['sourceId'] ?? '';
        await store.manual.requireSource(sourceId, actor.clientId);
        const page = await store.manual.listPrices(actor.clientId, sourceId, {
          page: intOf(query['page'], 1),
          pageSize: intOf(query['pageSize'], 50),
        });
        return { status: 200, body: page };
      },
    },
    {
      method: 'POST',
      path: '/research/sources/:sourceId/prices',
      permission: 'research:write',
      // Structured rows or raw CSV; REPLACES the previous list by default.
      async handle({ actor, params, body }) {
        const record = recordOf(body);
        const source = await store.manual.requireSource(params['sourceId'] ?? '', actor.clientId);
        const problems: ManualRowProblem[] = [];
        let rows: ManualPriceRowInput[] = Array.isArray(record['rows'])
          ? (record['rows'] as ManualPriceRowInput[])
          : [];
        if (record['csv'] !== undefined) {
          const parsed = parseCsvPriceList(record['csv'] as never);
          rows = [...rows, ...parsed.rows];
          problems.push(...parsed.problems);
        }
        const normalized = normalizeManualRows(rows, {
          defaultValidUntil: validUntilOf(config, record['validUntil']),
        });
        problems.push(...normalized.problems);
        const stored = await store.manual.store({
          clientId: actor.clientId,
          sourceId: source.id,
          defaultSupplierName: String(record['defaultSupplierName'] ?? source.name),
          entries: normalized.entries,
          replace: record['replace'] !== false,
        });
        return ok({
          imported: stored.imported,
          problems,
          batchId: stored.batchId,
          replaced: stored.replaced,
        });
      },
    },
  ];
}

/** One typed quote from a phone/WhatsApp negotiation — appended, never replacing. */
function quoteRoute(config: ResearchApiConfig): ResearchRoute {
  const { store, messages } = config;
  return {
    method: 'POST',
    path: '/research/sources/:sourceId/quotes',
    permission: 'research:write',
    async handle({ actor, params, body }) {
      const source = await store.manual.requireSource(params['sourceId'] ?? '', actor.clientId);
      const normalized = normalizeManualRows([recordOf(body) as never], {
        defaultValidUntil: validUntilOf(config, undefined),
      });
      if (normalized.entries.length === 0) {
        return refuse(400, normalized.problems[0]?.reason ?? messages.invalidQuote);
      }
      const stored = await store.manual.store({
        clientId: actor.clientId,
        sourceId: source.id,
        defaultSupplierName: source.name,
        entries: normalized.entries,
        replace: false,
      });
      return ok({
        imported: stored.imported,
        problems: normalized.problems,
        batchId: stored.batchId,
        replaced: false,
      });
    },
  };
}

export function manualRoutes(config: ResearchApiConfig): ResearchRoute[] {
  return [...priceListRoutes(config), quoteRoute(config)];
}
