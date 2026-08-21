import type { ResearchApiConfig, ResearchRoute } from './types';
import { ok, recordOf } from './shared';

/**
 * The request lifecycle: start (202, accepted-then-poll), the request poll
 * target, and the run read. The history LISTING is deliberately absent —
 * its query grammar is the host's own search-grid config (see `./index`).
 */
export function requestRoutes(config: ResearchApiConfig): ResearchRoute[] {
  const { store } = config;
  return [
    {
      method: 'POST',
      path: '/research',
      permission: 'research:write',
      // Asynchronous by design: persist the request, enqueue the run and
      // answer 202 — a fan-out over external storefronts has no business
      // inside a request/response window. `enqueued: false` still answers
      // 202 with the request persisted; the reconciliation sweep re-enqueues.
      async handle({ actor, body }) {
        const record = recordOf(body);
        const query = recordOf(record['query']);
        const catalogRef =
          record['catalogRef'] === undefined ? undefined : recordOf(record['catalogRef']);
        const { id: requestId } = await store.requests.create(actor.clientId, {
          term: String(query['term'] ?? ''),
          ...(query['brand'] !== undefined ? { brand: String(query['brand']) } : {}),
          ...(query['ean'] !== undefined ? { ean: String(query['ean']) } : {}),
          quantity: typeof query['quantity'] === 'number' ? query['quantity'] : 1,
          ...(query['region'] !== undefined ? { region: String(query['region']) } : {}),
          ...(catalogRef !== undefined
            ? { catalogRefType: String(catalogRef['type']), catalogRefId: String(catalogRef['id']) }
            : {}),
          requestedBy: actor.userId,
        });
        const enqueue = await store.requests.enqueueRun(actor.clientId, requestId);
        return ok({ requestId, enqueued: enqueue.enqueued }, 202);
      },
    },
    {
      method: 'GET',
      path: '/research/requests/:requestId',
      permission: 'research:read',
      // Closes the polling loop the 202 advertises: the run is created BY the
      // background job, so the accepted answer cannot carry a runId — callers
      // poll here until `latestRun` appears, then follow it to the run.
      async handle({ actor, params }) {
        return ok(await store.requests.view(params['requestId'] ?? '', actor.clientId));
      },
    },
    {
      method: 'GET',
      path: '/research/runs/:runId',
      permission: 'research:read',
      async handle({ actor, params }) {
        return ok(await store.requests.run(params['runId'] ?? '', actor.clientId));
      },
    },
  ];
}
