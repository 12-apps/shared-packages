import { describe, expect, it } from 'vitest';

import { entityLifecycleRouter } from '../../hono';
import type { EntityOps, Snapshot } from '../../types';
import type { LifecycleActor } from '../context';
import { PT_BR_LIFECYCLE_MESSAGES } from '../pt-BR';

import { createMemoryLifecycleDb } from './memory-db';

/**
 * The Hono binding keeps the transport/validation line: a body that is present
 * but is not JSON is a 400 (malformed JSON is never a validation problem), while
 * an absent or wrong-shaped body is the strict parse's 422.
 */
const ACTOR: LifecycleActor = {
  tenantId: 't1',
  userId: 'u1',
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals: false },
  permissions: new Set(['products:approve']),
};

function mounted() {
  const rows = new Map<string, Snapshot>();
  const ops: EntityOps = {
    readSnapshot: async (_tenant, id) => rows.get(id) ?? null,
    applySnapshot: async (_tenant, id, snapshot) => {
      const key = id ?? 'item-1';
      rows.set(key, { ...snapshot });
      return key;
    },
    archive: async () => false,
    unarchive: async () => false,
    hardDelete: async () => undefined,
  };
  const db = createMemoryLifecycleDb();
  return entityLifecycleRouter({
    messages: PT_BR_LIFECYCLE_MESSAGES,
    db: async () => db,
    entities: [
      {
        entityType: 'product',
        slug: 'products',
        features: { versioning: true, drafts: true, approvals: true },
        label: () => 'Item',
        approvePermission: 'products:approve',
        ops,
        newItemDrafts: {},
      },
    ],
    resolveActor: () => ACTOR,
  }).router;
}

async function post(body: string | undefined) {
  const response = await mounted().request('/products/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('the hono binding on a draft body', () => {
  it('answers 400 with the host sentence for a body that is not JSON', async () => {
    const answer = await post('not json');
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: PT_BR_LIFECYCLE_MESSAGES.invalidBody });
  });

  it('answers 422 with problems for JSON of the wrong shape, and for no body', async () => {
    const wrong = await post('{"nope":true}');
    expect(wrong.status).toBe(422);
    expect(wrong.body).toHaveProperty('problems');
    expect((await post(undefined)).status).toBe(422);
  });
});
