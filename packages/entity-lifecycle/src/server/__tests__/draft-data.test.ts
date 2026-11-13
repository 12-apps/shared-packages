/* eslint-disable test-flakiness/no-test-isolation --
   nothing here is shared between tests: every `api` is a fresh `buildApi()`
   created INSIDE its own `it`, over a fresh in-memory db. The rule flags the
   name, not a cross-test dependency (as in `create-api.test.ts`). */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EntityOps, Snapshot } from '../../types';
import type { LifecycleActor, LifecycleRoute } from '../context';
import { createApiEntityLifecycle } from '../create-api-entity-lifecycle';
import { PT_BR_LIFECYCLE_MESSAGES } from '../pt-BR';
import type { LifecycleEntityRegistration } from '../registration';

import { createMemoryLifecycleDb } from './memory-db';

/**
 * A collection's own draft `data` validator, enforced by the package's OWN
 * handlers (FUT-4867) — so a host that mounts the generated routes directly
 * refuses the same unknown key its advertised schema does, and a collection
 * registered without one serves exactly what it served before.
 */

function memoryOps(): { ops: EntityOps; rows: Map<string, Snapshot> } {
  const rows = new Map<string, Snapshot>();
  let next = 0;
  const ops: EntityOps = {
    readSnapshot: async (_tenant, id) => rows.get(id) ?? null,
    async applySnapshot(_tenant, id, snapshot) {
      const key = id ?? `item-${++next}`;
      rows.set(key, { ...snapshot });
      return key;
    },
    archive: async (_tenant, id) => rows.delete(id),
    unarchive: async () => false,
    async hardDelete(_tenant, id) {
      rows.delete(id);
    },
  };
  return { ops, rows };
}

/** Loss reasons validate their drafts; suppliers register no validator at all. */
const reasonDraftData = z
  .strictObject({
    name: z.string().min(1),
    category: z.enum(['QUEBRA', 'VENCIMENTO']),
    meta: z.strictObject({ note: z.string() }),
  })
  .partial();

function buildApi(overrides: Partial<LifecycleEntityRegistration> = {}) {
  const db = createMemoryLifecycleDb();
  const { ops, rows } = memoryOps();
  const base = {
    features: { versioning: true, drafts: true, approvals: true },
    label: () => 'Item',
    ops,
  };
  const api = createApiEntityLifecycle({
    messages: PT_BR_LIFECYCLE_MESSAGES,
    db: async () => db,
    entities: [
      {
        ...base,
        entityType: 'loss-reason',
        slug: 'loss-reasons',
        newItemDrafts: {},
        draftData: reasonDraftData,
        ...overrides,
      },
      { ...base, entityType: 'supplier', slug: 'suppliers' },
    ],
  });
  return { api, rows };
}

const actor: LifecycleActor = {
  tenantId: 't1',
  userId: 'u1',
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals: false },
  permissions: new Set(),
};

type Api = ReturnType<typeof buildApi>['api'];

function routeOf(api: Api, method: string, path: string): LifecycleRoute {
  const found = api.routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

const call = (route: LifecycleRoute, params: Record<string, string>, body: unknown) =>
  route.handle({ actor, params, query: {}, body });

interface Refusal {
  error: string;
  problems: Array<{ path: string; message: string }>;
}

describe('draftData on a registration', () => {
  it('refuses an unknown key inside data on every draft write, at its path', async () => {
    const { api } = buildApi();
    const created = await call(routeOf(api, 'POST', '/loss-reasons/drafts'), {}, { data: { name: 'Quebra' } });
    expect(created.status).toBe(200);
    const draftId = (created.body as { data: { draft: { id: string } } }).data.draft.id;

    const writes: Array<[LifecycleRoute, Record<string, string>]> = [
      [routeOf(api, 'POST', '/loss-reasons/drafts'), {}],
      [routeOf(api, 'PUT', '/loss-reasons/:id/draft'), { id: 'item-1' }],
      [routeOf(api, 'PUT', '/loss-reasons/drafts/:draftId'), { draftId }],
    ];
    for (const [route, params] of writes) {
      const top = await call(route, params, { data: { name: 'Quebra', colour: 'red' } });
      expect(`${route.method} ${route.path} -> ${top.status}`).toBe(`${route.method} ${route.path} -> 422`);
      expect((top.body as Refusal).error).toBe(PT_BR_LIFECYCLE_MESSAGES.invalidBody);
      expect((top.body as Refusal).problems).toEqual([{ path: 'data.colour', message: 'Unrecognized key' }]);

      const deep = await call(route, params, { data: { meta: { note: 'x', extra: 1 } } });
      expect(deep.status).toBe(422);
      expect((deep.body as Refusal).problems.map((problem) => problem.path)).toEqual(['data.meta.extra']);

      // Two unknown keys in one object are two problems, as the hand check writes them.
      const two = await call(route, params, { data: { colour: 'red', size: 2 } });
      expect((two.body as Refusal).problems).toEqual([
        { path: 'data.colour', message: 'Unrecognized key' },
        { path: 'data.size', message: 'Unrecognized key' },
      ]);

      const wrongType = await call(route, params, { data: { category: 'OUTRA' } });
      expect((wrongType.body as Refusal).problems.map((problem) => problem.path)).toEqual(['data.category']);
    }
  });

  it('saves a draft that passes, partial as a working copy is', async () => {
    const { api } = buildApi();
    const created = await call(
      routeOf(api, 'POST', '/loss-reasons/drafts'),
      {},
      { data: { category: 'QUEBRA', meta: { note: 'pela metade' } } },
    );
    expect(created.status).toBe(200);
    const draft = (created.body as { data: { draft: { data: Snapshot } } }).data.draft;
    expect(draft.data).toEqual({ category: 'QUEBRA', meta: { note: 'pela metade' } });
  });

  it('still refuses a key beside data, before the validator runs', async () => {
    const { api } = buildApi();
    const response = await call(routeOf(api, 'POST', '/loss-reasons/drafts'), {}, { data: {}, status: 'X' });
    expect(response.status).toBe(422);
    expect((response.body as Refusal).problems.map((problem) => problem.path)).toEqual(['status']);
  });

  it('leaves a collection without one exactly as open as before', async () => {
    const { api } = buildApi();
    const response = await call(
      routeOf(api, 'POST', '/suppliers/drafts'),
      {},
      { data: { anything: { nested: [1, 2] }, colour: 'red' } },
    );
    expect(response.status).toBe(200);
    const { api: unvalidated } = buildApi({ draftData: undefined });
    const open = await call(routeOf(unvalidated, 'POST', '/loss-reasons/drafts'), {}, { data: { colour: 'red' } });
    expect(open.status).toBe(200);
  });
});
