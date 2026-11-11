import { describe, expect, it } from 'vitest';

import { impersonationRouter } from '../hono';

import { actor, TEST_MESSAGES, testServerConfig } from './fixtures';

/**
 * The Hono binding keeps the transport/validation line: a body that is present
 * but is not JSON is a 400 (malformed JSON is never a validation problem), while
 * an absent or wrong-shaped body is the strict parse's 422.
 */
function mounted() {
  return impersonationRouter({ ...testServerConfig(), resolveActor: () => actor() });
}

async function start(body: string | undefined) {
  const response = await mounted().platform.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('the hono binding on a start body', () => {
  it('answers 400 with the host sentence for a body that is not JSON', async () => {
    const answer = await start('not json');
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: TEST_MESSAGES.invalidBody });
  });

  it('answers 422 with problems for JSON of the wrong shape, and for no body', async () => {
    expect((await start('{"surprise":1}')).status).toBe(422);
    expect((await start(undefined)).status).toBe(422);
  });
});
