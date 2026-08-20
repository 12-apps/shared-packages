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
    expect(statuses.get('e2e')).toBe('collected');
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
