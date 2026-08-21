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

  it('declares the package identity and the one runtime capability', () => {
    expect(productResearchManifest.name).toBe('@12-apps/product-research');
    expect(productResearchManifest.contract).toBe(1);
    expect(productResearchManifest.server).toEqual(['jobs']);
    expect(productResearchManifest.observability).toEqual({ namespace: 'product-research' });
    // Library-with-ports: no route descriptors, no createApi* factory — the
    // origin host's research routes are host code over the ports.
    expect(productResearchManifest).not.toHaveProperty('web');
    // Host-authored tools over host-mounted routes; with no http capability
    // a declared tool path would guess at the host's URL space.
    expect(productResearchManifest).not.toHaveProperty('mcp');
    expect(productResearchManifest).not.toHaveProperty('permissions');
    expect(productResearchManifest).not.toHaveProperty('e2e');
    expect(productResearchManifest).not.toHaveProperty('env');
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

  it('hands the payload to the one host dep and adds no second log stream', async () => {
    const runResearch = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const payload = {
      clientId: 't1',
      requestId: 'req-1',
      query: { term: 'farinha de trigo' },
    };
    // The handler ignores the attempt context by design — the pipeline logs
    // through its own LoggerPort — so the concrete signature takes two args.
    await RESEARCH_JOBS.blueprints.run.handle(payload as never, { runResearch });
    expect(runResearch).toHaveBeenCalledWith(payload);
  });
});
