/**
 * The wiring-compliance suite (the report-builder shape). The manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE —
 * the same "fails in the package's own test run" guarantee with zero
 * runtime dependencies added.
 */

import { describe, expect, it } from 'vitest';
import { PT_BR_LIFECYCLE_MESSAGES } from '../../server/pt-BR';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from '@12-apps/wiring/producer';

import packageJson from '../../../package.json';
import type { EntityOps } from '../../types';
import { createMemoryLifecycleDb } from '../../server/__tests__/memory-db';
import { entityLifecycleManifest } from '../index';
import { entityLifecycleServerManifest } from '../server';
import { entityLifecycleWebManifest } from '../web';

describe('the shared manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(entityLifecycleManifest)).toBe(entityLifecycleManifest);
    expect(defineServerManifest(entityLifecycleManifest, entityLifecycleServerManifest)).toBe(
      entityLifecycleServerManifest,
    );
    expect(defineWebManifest(entityLifecycleManifest, entityLifecycleWebManifest)).toBe(
      entityLifecycleWebManifest,
    );
  });

  it('declares the package identity and the runtime inventory', () => {
    expect(entityLifecycleManifest.name).toBe('@12-apps/entity-lifecycle');
    expect(entityLifecycleManifest.contract).toBe(1);
    expect(entityLifecycleManifest.server).toEqual(['http']);
    expect(entityLifecycleManifest.web).toEqual(['surface', 'areas']);
    expect(entityLifecycleManifest.observability).toEqual({ namespace: 'entity-lifecycle' });
  });

  it('declares NO mcp, NO permissions and NO e2e — each absence is the design', () => {
    // mcp: the tools are vocabulary-dependent (`lifecycleMcpEndpoints`
    // needs host nouns, paths and summaries) — the contract's own carve-out;
    // they join the aggregate through the adoption's mcpEndpoints extension.
    expect(entityLifecycleManifest).not.toHaveProperty('mcp');
    // permissions: routePermission/approvePermission are HOST vocabulary
    // handed in at registration — no package-owned id exists to declare.
    expect(entityLifecycleManifest).not.toHaveProperty('permissions');
    // e2e: stories ship, journeys do not.
    expect(entityLifecycleManifest).not.toHaveProperty('e2e');
  });

  it('declares the Prisma contribution prisma:sync actually copies', () => {
    expect(entityLifecycleManifest.db).toEqual({
      partial: 'prisma/entity-lifecycle.prisma',
      migrations: 'prisma/migrations',
    });
  });

  it('mirrors db into package.json, and the exports map matches the declarations', () => {
    expect(() => assertDbMirror(entityLifecycleManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(entityLifecycleManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(entityLifecycleManifest, packageJson)).not.toThrow();
  });
});

/** The ops seam a registration needs — inert, the routes are never invoked. */
function inertOps(): EntityOps {
  return {
    readSnapshot: async () => null,
    applySnapshot: async () => 'id',
    archive: async () => false,
    unarchive: async () => false,
    hardDelete: async () => undefined,
  };
}

describe('the server manifest', () => {
  it('hands hosts the existing factory, not a wrapper that could drift', async () => {
    // The route list is DYNAMIC — six shared routes plus eight per
    // registration, paths built from the host's slugs — so the pin holds
    // the SHAPE against a fixture registration rather than a static table.
    const create = entityLifecycleServerManifest.http.create;
    const api = create({
      messages: PT_BR_LIFECYCLE_MESSAGES,
      db: async () => createMemoryLifecycleDb(),
      entities: [
        {
          entityType: 'product',
          slug: 'products',
          features: { versioning: true, drafts: true, approvals: true },
          label: () => 'Item',
          ops: inertOps(),
        },
      ],
    });
    expect(api.routes).toHaveLength(6 + 8);
    const listed = api.routes.map((route) => `${route.method} ${route.path}`);
    // The registration's slug is the path root of every per-kind route…
    expect(listed).toContain('GET /products/drafts');
    expect(listed).toContain('POST /products/drafts/:draftId/publish');
    expect(listed).toContain('POST /products/:id/versions/:version/restore');
    // …and the shared console routes are fixed.
    expect(listed).toContain('GET /recycle-bin');
    expect(listed).toContain('GET /approvals');
  });
});

describe('the web manifest', () => {
  it('suggests one admin route for the one ROUTABLE screen, with a matching nav anchor', () => {
    expect(entityLifecycleWebManifest.surface.create).toBeTypeOf('function');
    const area = entityLifecycleWebManifest.areas[0];
    expect(area.area).toBe('admin');
    // `page` is the tabbed Lixeira + Aprovações console; the other surface
    // members (RecycleBinScreen, VersionHistoryDialog, DraftBanner, …) are
    // host-embedded pieces no route declaration can express.
    expect(area.routes.map((route) => `${route.path} -> ${route.screen}`)).toEqual([
      'lifecycle/* -> page',
    ]);
    expect(area.nav[0].path).toBe('lifecycle/*');
    // No permission/feature gates: host vocabulary, per the areas contract.
    expect('permission' in area.nav[0]).toBe(false);
    expect('feature' in area.routes[0]).toBe(false);
  });
});
