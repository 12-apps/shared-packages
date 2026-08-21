/**
 * The wiring-compliance suite. The producer factories already ASSERT at
 * import (a malformed manifest fails this file's imports before any case
 * runs); what the cases pin is the contract the manifests promise:
 * identity, inventory, and that the contributions ARE the existing exports
 * rather than parallel restatements that could drift.
 */

import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_REPORT_SERVER_MESSAGES } from '../../server/pt-BR';
import { describe, expect, it } from 'vitest';
import type { PackageManifest, WirePermissionsContribution } from '@12-apps/wiring';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from '@12-apps/wiring/producer';

import packageJson from '../../../package.json';
import { defineCatalog } from '../../index';
import { REPORT_BUILDER_PERMISSIONS } from '../../server/contribution';
import { createApiReportBuilder } from '../../server/create-report-builder';
import { createWebReportBuilder } from '../../react/create-report-builder';
import {
  DEFAULT_AUTHOR_PERMISSION,
  REPORT_BUILDER_FEATURES,
  reportBuilderManifest,
} from '../index';
import { REPORT_BUILDER_MCP_TOOLS, reportBuilderMcpTools } from '../mcp';
import { reportBuilderServerManifest } from '../server';
import { reportBuilderWebManifest } from '../web';

describe('the shared manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    // The manifests are plain `satisfies`-checked values (zero runtime deps);
    // the factories' runtime validation — inventory drift both ways included —
    // runs in THIS suite, keeping the "fails in the package's own test run"
    // guarantee.
    expect(defineManifest(reportBuilderManifest)).toBe(reportBuilderManifest);
    expect(defineServerManifest(reportBuilderManifest, reportBuilderServerManifest)).toBe(
      reportBuilderServerManifest,
    );
    expect(defineWebManifest(reportBuilderManifest, reportBuilderWebManifest)).toBe(
      reportBuilderWebManifest,
    );
  });

  it('declares the package identity and the runtime inventory', () => {
    expect(reportBuilderManifest.name).toBe('@12-apps/report-builder');
    expect(reportBuilderManifest.contract).toBe(1);
    expect(reportBuilderManifest.server).toEqual(['http']);
    expect(reportBuilderManifest.web).toEqual(['surface', 'areas']);
  });

  it('contributes the SAME permission object composePermissions consumers use', () => {
    // Identity, not equality: a copy could drift from the /server export.
    expect(reportBuilderManifest.permissions).toBe(REPORT_BUILDER_PERMISSIONS);
    // And the rbac-shaped contribution satisfies the wiring twin.
    const contribution: WirePermissionsContribution = REPORT_BUILDER_PERMISSIONS;
    expect(contribution.ids).toEqual(['reports:manage']);
  });

  it('declares the Prisma contribution prisma:sync actually copies', () => {
    expect(reportBuilderManifest.db).toEqual({
      partial: 'prisma/report-builder.prisma',
      migrations: 'prisma/migrations',
    });
  });

  it('mirrors the db contribution into package.json for host assemblers', () => {
    // Host-side sync tooling is plain Node reading node_modules — it cannot
    // execute this TS manifest, so the contribution lives in package.json
    // too, and this assertion is what keeps the two the same shape.
    expect(() => assertDbMirror(reportBuilderManifest, packageJson)).not.toThrow();
  });

  it('keeps exports subpaths and manifest declarations the same set — the #1008 tripwire', () => {
    // A capability shipped as an exports subpath the manifest never mentions
    // is invisible to the adopting host; the reverse is a declaration whose
    // module no longer resolves. Both directions fail this package's own run.
    expect(() => assertExportsMirror(reportBuilderManifest, packageJson)).not.toThrow();
  });

  it('declares no env capability, and package.json agrees', () => {
    // Every runtime input is config, deliberately — the day this package
    // reads process.env, the manifest must say so and this pin must move.
    const shared: PackageManifest = reportBuilderManifest;
    expect(shared.env).toBeUndefined();
    expect(() => assertEnvMirror(reportBuilderManifest, packageJson)).not.toThrow();
  });

  it('declares the observability namespace and the e2e world by its exported name', () => {
    expect(reportBuilderManifest.observability).toEqual({ namespace: 'reports' });
    expect(reportBuilderManifest.e2e).toEqual({
      entry: '@12-apps/report-builder/e2e',
      world: { factory: 'defineReportsWorld' },
    });
  });
});

describe('the route policy', () => {
  it('declares gates in the package vocabulary, per route, exactly', () => {
    const { routes } = createApiReportBuilder({
      catalog: defineCatalog({
        entities: {
          orders: {
            label: 'Pedidos',
            fields: {
              method: { label: 'Forma', type: 'string', role: 'dimension' },
              totalCents: { label: 'Receita', type: 'money', role: 'measure' },
            },
          },
        },
      }),
      entityPermission: { orders: 'reports:sales:read' },
      systemReports: [],
      starters: {},
      adapter: { execute: () => Promise.resolve([]) },
      copy: PT_BR_REPORT_ENGINE_COPY,
      messages: PT_BR_REPORT_SERVER_MESSAGES,
      db: () => Promise.reject(new Error('not this suite')),
      timeZone: 'UTC',
    });
    const table = Object.fromEntries(
      routes.map((route) => [
        `${route.method} ${route.path}`,
        { permission: route.permission, entitlement: route.entitlement, quota: route.quota },
      ]),
    );
    expect(table).toEqual({
      'GET /reports/fields': { permission: undefined, entitlement: undefined, quota: undefined },
      'GET /reports/system': { permission: undefined, entitlement: 'reports.system', quota: undefined },
      'GET /reports/system/:key': { permission: undefined, entitlement: 'reports.system', quota: undefined },
      'GET /reports/custom': { permission: undefined, entitlement: undefined, quota: undefined },
      'GET /reports/custom/:id': { permission: undefined, entitlement: undefined, quota: undefined },
      'POST /reports/custom': { permission: 'reports:manage', entitlement: undefined, quota: 'reports.custom' },
      'PUT /reports/custom/:id': { permission: 'reports:manage', entitlement: 'reports.custom', quota: undefined },
      'DELETE /reports/custom/:id': { permission: 'reports:manage', entitlement: undefined, quota: undefined },
      'PUT /reports/custom/:id/working-copy': { permission: 'reports:manage', entitlement: 'reports.custom', quota: undefined },
      'DELETE /reports/custom/:id/working-copy': { permission: 'reports:manage', entitlement: undefined, quota: undefined },
      'POST /reports/custom/:id/working-copy/publish': { permission: 'reports:manage', entitlement: 'reports.custom', quota: undefined },
      'POST /reports/run': { permission: undefined, entitlement: undefined, quota: undefined },
    });
    // Every declared permission is one the package itself contributes.
    routes.forEach((route) => {
      if (route.permission !== undefined) {
        expect(REPORT_BUILDER_PERMISSIONS.ids).toContain(route.permission);
      }
    });
  });

  it('pins the vocabulary constants to their wire values', () => {
    // The constants exist so nobody retypes these strings; the LITERALS here
    // are deliberate — a test asserting constant === constant pins nothing.
    expect(REPORT_BUILDER_FEATURES).toEqual({ system: 'reports.system', custom: 'reports.custom' });
    expect(DEFAULT_AUTHOR_PERMISSION).toBe('reports:manage');
  });
});

describe('the MCP contribution', () => {
  it('cannot drift from the route descriptors: one tool per descriptor, same URLs', () => {
    const { routes } = createApiReportBuilder({
      catalog: defineCatalog({
        entities: {
          orders: {
            label: 'Pedidos',
            fields: {
              method: { label: 'Forma', type: 'string', role: 'dimension' },
              totalCents: { label: 'Receita', type: 'money', role: 'measure' },
            },
          },
        },
      }),
      entityPermission: { orders: 'reports:sales:read' },
      systemReports: [],
      starters: {},
      adapter: { execute: () => Promise.resolve([]) },
      copy: PT_BR_REPORT_ENGINE_COPY,
      messages: PT_BR_REPORT_SERVER_MESSAGES,
      db: () => Promise.reject(new Error('not this suite')),
      timeZone: 'UTC',
    });
    const fromDescriptors = routes.map((route) => `${route.method} ${route.path}`).sort();
    const fromTools = REPORT_BUILDER_MCP_TOOLS.map(
      (tool) => `${tool.method} ${tool.path.replace(/\{(\w+)\}/g, ':$1')}`,
    ).sort();
    expect(fromTools).toEqual(fromDescriptors);
  });

  it('declares behavior defaults on every tool, mount-relative', () => {
    REPORT_BUILDER_MCP_TOOLS.forEach((tool) => {
      expect(tool.path.startsWith('/reports')).toBe(true);
      expect(tool.annotations).toBeDefined();
    });
  });

  it('absolutizes through the standalone factory — the whole hand registry', () => {
    const tools = reportBuilderMcpTools({ basePath: '/api/admin/{tenantSlug}' });
    expect(tools.map((tool) => tool.operationId)).toEqual(
      REPORT_BUILDER_MCP_TOOLS.map((tool) => tool.operationId),
    );
    expect(tools[0]?.path).toBe('/api/admin/{tenantSlug}/reports/system');
  });
});

describe('the runtime manifests', () => {
  it('hands hosts the existing factories, not wrappers that could drift', () => {
    expect(reportBuilderServerManifest.http?.create).toBe(createApiReportBuilder);
    expect(reportBuilderWebManifest.surface?.create).toBe(createWebReportBuilder);
  });

  it('suggests the admin area as one splat route with a matching nav anchor', () => {
    const area = reportBuilderWebManifest.areas?.[0];
    expect(area?.area).toBe('admin');
    expect(area?.routes?.map((route) => route.path)).toEqual(['reports/*']);
    expect(area?.nav?.[0]?.path).toBe('reports/*');
  });
});
