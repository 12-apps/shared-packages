import { describe, expect, it } from 'vitest';

import { DEMO_CATALOG } from '../../__tests__/demo-catalog';
import { rbacRouter } from '../../hono';
import { createFakeRbacDb } from './fake-db';
import { superActor } from './server-fixtures';
import { PT_BR_RBAC_MESSAGES } from '../pt-BR';

/**
 * The Hono binding keeps the transport/validation line: a body that is present
 * but is not JSON is a 400 (malformed JSON is never a validation problem), while
 * an absent or wrong-shaped body is the strict parse's 422.
 */
function mounted() {
  const { db } = createFakeRbacDb();
  return rbacRouter({
    db: async () => db,
    catalog: DEMO_CATALOG,
    adminRoles: ['DIRECTOR', 'HEAD_LIBRARIAN'],
    customerRole: 'PATRON',
    messages: PT_BR_RBAC_MESSAGES,
    directory: { getUsers: async () => [], searchUsers: async () => [] },
    resolveActor: () => superActor('t-1'),
  }).router;
}

async function post(body: string | undefined) {
  const response = await mounted().request('/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('the hono binding on a write body', () => {
  it('answers 400 with the host sentence for a body that is not JSON', async () => {
    const answer = await post('not json');
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: PT_BR_RBAC_MESSAGES.invalidBody });
  });

  it('answers 422 with problems for JSON of the wrong shape', async () => {
    const answer = await post('{"surprise":1}');
    expect(answer.status).toBe(422);
    expect(answer.body).toHaveProperty('problems');
  });
});
