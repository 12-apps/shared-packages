/**
 * The consumer path, end to end, against the PUBLISHED tarballs.
 *
 * `report-hono.test.ts` proves the per-package Hono adapter; this suite
 * proves the SAME surface served through `@12-apps/wiring` instead — manifest
 * adopted, bindings applied, aggregate assembled, one host bridge — because
 * the adoption's whole claim is that nothing about the answers changes, only
 * who counts the wiring.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';
import type { SavedReportDb } from '@12-apps/report-builder/server';

import { REPORTS_MOUNT_PATH, wireReports } from '../src/reports-host';
import { honoRouterFor } from '../src/wire-hono';

/** The same duck-typed store shape `report-hono.test.ts` passes as `db`. */
function emptySavedReportDb(): SavedReportDb {
  return {
    savedReport: {
      findMany: () => Promise.resolve([]),
      findFirst: () => Promise.resolve(null),
      create: () => Promise.reject(new Error('not this suite')),
      updateMany: () => Promise.resolve({ count: 0 }),
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
  } as unknown as SavedReportDb;
}

function appFor(router: Hono): Hono {
  const app = new Hono();
  app.route(REPORTS_MOUNT_PATH, router);
  return app;
}

describe('report-builder adopted through @12-apps/wiring', () => {
  it('serves the catalog through the assembled routes and the one host bridge', async () => {
    const { router } = wireReports(emptySavedReportDb());
    const response = await appFor(router).request('/api/admin/harness/reports/fields');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { entities: { entity: string }[] } };
    expect(body.data.entities.map((listing) => listing.entity)).toContain('orders');
  });

  it('serves the saved-report list the same way', async () => {
    const { router } = wireReports(emptySavedReportDb());
    const response = await appFor(router).request('/api/admin/harness/reports/custom');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { reports: unknown[] } };
    expect(body.data.reports).toEqual([]);
  });

  it('carries the package-declared MCP tools, absolutized against the mount', () => {
    const { mcpEndpoints, routes } = wireReports(emptySavedReportDb());
    expect(mcpEndpoints.length).toBe(routes.length);
    mcpEndpoints.forEach((tool) => {
      expect(tool.path.startsWith('/api/admin/{tenantSlug}/reports')).toBe(true);
    });
    const readonlyTools = mcpEndpoints.filter((tool) => tool.annotations?.readOnly === true);
    expect(readonlyTools.map((tool) => tool.operationId)).toContain('listReportFields');
  });

  it('answers a wiring report with every declared capability accounted for', () => {
    const { report, routes } = wireReports(emptySavedReportDb());
    const statuses = new Map(
      report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );
    expect(statuses.get('http')).toBe('bound');
    expect(statuses.get('permissions')).toBe('collected');
    expect(statuses.get('db')).toBe('collected');
    // The manifest declares a WORLD now, so "collected" is no longer on the
    // menu: this server host declines (the journeys drive screens), and the
    // web harness binds its featuresRoot — the pair that makes an unadopted
    // world impossible to ship silently.
    expect(statuses.get('e2e')).toBe('declined');
    // Bound through ports.loggerFor — the package logs under its namespace.
    expect(statuses.get('observability')).toBe('bound');
    // The web half is the frontend harness's to answer, and the report says so.
    expect(statuses.get('surface')).toBe('out-of-scope');
    expect(statuses.get('areas')).toBe('out-of-scope');
    expect(routes.length).toBeGreaterThan(0);
    expect(renderWiringReport(report)).toContain(
      `http: bound — ${routes.length} routes at ${REPORTS_MOUNT_PATH}`,
    );
  });

  it('names a descriptor a file-per-endpoint host forgot to claim', () => {
    const { routes } = wireReports(emptySavedReportDb());
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${REPORTS_MOUNT_PATH}${mounted.route.path}`);
    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });
});

describe('the host bridge, on the two halves a JSON handler never needs', () => {
  /**
   * `wire-hono.ts` is this host's ONE framework adapter, and the contract puts
   * two obligations on it that no adopted surface here exercised:
   *
   * - it must be able to forward the RAW `Request`, for "the handlers the
   *   parsed fields cannot serve: a webhook verifying a provider signature over
   *   the exact bytes, an SSE stream reading `Last-Event-ID`, an OAuth callback
   *   echoing the whole URL";
   * - and doing so must not cost the parsed body, because `params`, `query` and
   *   `body` are "the halves every adapter is obliged to fill".
   *
   * Those two pull against each other: reading the body consumes the stream, so
   * a naive bridge that does both hands the handler a locked request. That is
   * not hypothetical — `@12-apps/storage` throws by name when the raw request
   * is missing, and `ReadableStream is locked` when it has been eaten.
   */
  function bridgeOver(seen: { request?: Request; body?: unknown }): Hono {
    const app = new Hono();
    app.route(
      '/probe',
      honoRouterFor(
        [
          {
            route: {
              method: 'POST',
              path: '/echo',
              handle: async (request: { request?: Request; body?: unknown }) => {
                seen.request = request.request;
                seen.body = request.body;
                return { status: 200, body: { ok: true } };
              },
            },
          } as never,
        ],
        () => ({ userId: 'probe' }),
      ),
    );
    return app;
  }

  it('forwards the raw request AND the parsed body from the same call', async () => {
    const seen: { request?: Request; body?: unknown } = {};
    const response = await bridgeOver(seen).request('/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'café' }),
    });

    expect(response.status).toBe(200);
    expect(seen.body).toEqual({ term: 'café' });
    // Still readable: the parse went through a CLONE. Without that this is
    // `TypeError: Invalid state: ReadableStream is locked`, thrown inside
    // whichever package asked for the bytes.
    expect(await seen.request?.json()).toEqual({ term: 'café' });
  });

  /** A bridge over one route that answers the RAW arm. Built per case. */
  function rawAnswerBridge(): Hono {
    const app = new Hono();
    app.route(
      '/probe',
      honoRouterFor(
        [
          {
            route: {
              method: 'GET',
              path: '/raw',
              handle: async () => ({
                response: new Response('data: hello\n\n', {
                  status: 200,
                  headers: { 'content-type': 'text/event-stream' },
                }),
              }),
            },
          } as never,
        ],
        () => ({ userId: 'probe' }),
      ),
    );
    return app;
  }

  it('returns a raw answer UNTOUCHED, so a stream is not serialized', async () => {
    // The other arm of `WireRouteAnswer`: "an answer the adapter must return
    // UNTOUCHED: a live SSE stream, a redirect whose headers are the payload, a
    // provider-shaped webhook body." The contract states the failure too — "a
    // serialized stream is a hung request and a redirect with no `Location` is
    // a dead end" — which is what this bridge did to any of them until now.
    const response = await rawAnswerBridge().request('/probe/raw');

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('data: hello\n\n');
  });

  it('leaves a body that is not JSON to the handler, unread', async () => {
    // A multipart upload is the case: it was never JSON, so the parsed body is
    // undefined and the handler streams the raw request to its driver.
    const seen: { request?: Request; body?: unknown } = {};
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.png');

    await bridgeOver(seen).request('/probe/echo', { method: 'POST', body: form });

    expect(seen.body).toBeUndefined();
    expect((await seen.request?.formData())?.has('file')).toBe(true);
  });
});

describe('the host bridge, on routes that must NOT have a caller', () => {
  /**
   * `kind` is the contract's third obligation on an adapter, after the raw
   * request and the raw answer — and the one whose failure is quietest. The
   * default is `authenticated`, so this bridge's 401 was right for every
   * surface adopted so far; the contract names two exceptions and both are
   * arriving:
   *
   * - `public` — "anonymous by design (a storefront read)": `@12-apps/storage`
   *   serves an object to an `<img>` that carries no session;
   * - `webhook` — "must NOT sit behind tenant guards", because a provider
   *   callback verified by signature has no caller to resolve.
   *
   * A bridge that gates these mounts the package, serves its authenticated
   * routes correctly, and answers "not authenticated" to everybody on the one
   * route whose whole point is having no caller.
   */
  function bridgeOverKind(kind: string): Hono {
    const app = new Hono();
    app.route(
      '/probe',
      honoRouterFor(
        [
          {
            route: {
              method: 'GET',
              path: '/open',
              kind,
              handle: async (request: { actor?: unknown }) => ({
                status: 200,
                body: { actor: request.actor ?? null },
              }),
            },
          } as never,
        ],
        // NO caller — the anonymous case, which is the whole point.
        () => null,
      ),
    );
    return app;
  }

  it('serves a public route to a caller the host could not resolve', async () => {
    const response = await bridgeOverKind('public').request('/probe/open');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: null });
  });

  it('does not even ASK the host who is calling on such a route', async () => {
    // Resolving is a session lookup. An `<img>` loading a store's photo would
    // pay for one it can never satisfy — and a route handed a resolved actor
    // invites a handler to read one the contract says is not there.
    const asked = { count: 0 };
    const counting = countingBridge(asked);

    expect((await counting.request('/probe/open')).status).toBe(200);
    expect(asked.count).toBe(0);
  });

  /** A bridge over one public route, counting how often the host is asked. */
  function countingBridge(asked: { count: number }): Hono {
    const app = new Hono();
    app.route(
      '/probe',
      honoRouterFor(
        [
          {
            route: {
              method: 'GET',
              path: '/open',
              kind: 'public',
              handle: async () => ({ status: 200, body: { ok: true } }),
            },
          } as never,
        ],
        () => {
          asked.count += 1;
          return { userId: 'probe' };
        },
      ),
    );
    return app;
  }

  it('serves a webhook route the same way — a signature is not a session', async () => {
    const response = await bridgeOverKind('webhook').request('/probe/open');

    expect(response.status).toBe(200);
  });

  /** A bridge over one route that declares NO kind. Built per case. */
  function bridgeOverDefault(): Hono {
    const app = new Hono();
    app.route(
      '/probe',
      honoRouterFor(
        [
          {
            route: { method: 'GET', path: '/guarded', handle: async () => ({ status: 200 }) },
          } as never,
        ],
        () => null,
      ),
    );
    return app;
  }

  it('still 401s the default, so the gate did not simply come off', async () => {
    // `kind` defaults to `authenticated`, and every route adopted before
    // storage carries no `kind` at all — so the absent case is the one that
    // must keep answering 401.
    expect((await bridgeOverDefault().request('/probe/guarded')).status).toBe(401);
  });
});
