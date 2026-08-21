/**
 * The wiring-compliance suite (the report-builder shape). The manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';

import packageJson from '../../../package.json';
import { createApiProductResearch, PT_BR_RESEARCH_MESSAGES } from '../../http';
import { RESEARCH_JOBS } from '../../jobs';
import { productResearchManifest } from '../index';
import { productResearchServerManifest } from '../server';

describe('the shared manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(productResearchManifest)).toBe(productResearchManifest);
    expect(defineServerManifest(productResearchManifest, productResearchServerManifest)).toBe(
      productResearchServerManifest,
    );
  });

  it('declares the package identity and the two runtime capabilities', () => {
    expect(productResearchManifest.name).toBe('@12-apps/product-research');
    expect(productResearchManifest.contract).toBe(1);
    expect(productResearchManifest.server).toEqual(['http', 'jobs']);
    expect(productResearchManifest.observability).toEqual({ namespace: 'product-research' });
    // No web surface, no packaged journeys, zero process.env reads.
    expect(productResearchManifest).not.toHaveProperty('web');
    expect(productResearchManifest).not.toHaveProperty('e2e');
    expect(productResearchManifest).not.toHaveProperty('env');
  });

  it('contributes its two permission ids, and every route declares one of them', () => {
    expect(productResearchManifest.permissions?.ids).toEqual(['research:read', 'research:write']);
    const { routes } = createApiProductResearch({
      store: {} as never,
      checks: {} as never,
      credentials: {} as never,
      messages: PT_BR_RESEARCH_MESSAGES,
      connectors: { isMounted: () => false, types: () => [], credentialFieldsFor: () => undefined },
    });
    expect(routes).toHaveLength(16);
    for (const route of routes) {
      expect(['research:read', 'research:write']).toContain(route.permission);
    }
    // The history LISTING stays host code (its query grammar is the host's
    // search-grid config), so the GET beside the declared start POST is
    // deliberately absent here.
    expect(
      routes.some((route) => route.method === 'GET' && route.path === '/research'),
    ).toBe(false);
  });

  it('declares MCP tools only for operations whose whole wire contract it states', () => {
    const ids = productResearchManifest.mcp?.endpoints.map((tool) => tool.operationId);
    expect(ids).toEqual([
      'startResearch',
      'getResearchRequest',
      'getResearchRun',
      'listManualPrices',
      'importManualPrices',
      'addManualQuote',
    ]);
    // Reads are marked; the start spends outbound calls beyond the host's data.
    const byId = new Map(productResearchManifest.mcp?.endpoints.map((tool) => [tool.operationId, tool]));
    expect(byId.get('getResearchRun')?.annotations).toEqual({ readOnly: true });
    expect(byId.get('startResearch')?.annotations).toEqual({ openWorld: true });
  });

  it('declares the budget blueprint, phrased by the pt-BR pack the origin host uses', () => {
    const blueprint = productResearchManifest.notifications?.[0];
    expect(blueprint?.type).toBe('research.budget-exhausted');
    expect(blueprint?.category).toBe('system');
    const content = blueprint?.generate({
      scope: 'TENANT_DAY',
      sourceType: 'SERP',
      period: '2026-08-21',
      capUnits: 5,
      tenantSlug: 'acme',
    } as never);
    expect(content?.title).toBe('Cota diária de busca paga esgotada');
    expect(content?.link).toBe('/admin/acme/research');
    expect(content?.data).toMatchObject({ scope: 'TENANT_DAY', capUnits: 5 });
  });

  it('declares the Prisma contribution prisma:sync actually copies', () => {
    expect(productResearchManifest.db).toEqual({
      partial: 'prisma/product-research.prisma',
      migrations: 'prisma/migrations',
    });
  });

  it('mirrors db into package.json, and the exports map matches the declarations', () => {
    expect(() => assertDbMirror(productResearchManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(productResearchManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(productResearchManifest, packageJson)).not.toThrow();
  });
});

describe('the run blueprint — the first payload-carrying one', () => {
  it('declares the retry policy the pipeline reasons about', () => {
    expect(productResearchServerManifest.jobs).toBe(RESEARCH_JOBS);
    expect(RESEARCH_JOBS.namespace).toBe('research');
    const blueprint = RESEARCH_JOBS.blueprints.run;
    expect(blueprint.name).toBe('run');
    // Three attempts, 5s → 10s → 20s: the spacing the source-budget
    // truncation assumes when it makes attempts two and three nearly free.
    expect(blueprint.attempts).toBe(3);
    expect(blueprint.backoff).toEqual({ type: 'exponential', delayMs: 5_000 });
    // Enqueue-driven, one run per buyer request: no cadence, and no lease —
    // idempotency is per-runId, not a single-flight name.
    expect(blueprint).not.toHaveProperty('schedule');
    expect(blueprint).not.toHaveProperty('interval');
    expect(blueprint).not.toHaveProperty('lease');
  });

  it('hands the ids-only ref to the one host dep and adds no second log stream', async () => {
    const runResearch = vi.fn().mockResolvedValue({ status: 'succeeded' });
    // The payload is the request's IDENTITY, never the query: a retry (or an
    // orphan re-enqueue days later) must re-read the row, not re-run a stale
    // copy — and the dep answering null for a vanished request is a completed
    // job, not a retryable failure.
    const payload = { clientId: 't1', requestId: 'req-1' };
    // The handler ignores the attempt context by design — the pipeline logs
    // through its own LoggerPort — so the concrete signature takes two args.
    await RESEARCH_JOBS.blueprints.run.handle(payload as never, { runResearch });
    expect(runResearch).toHaveBeenCalledWith(payload);
  });
});
