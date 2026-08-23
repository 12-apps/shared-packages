import { describe, expect, it } from 'vitest';

import { LifecycleError, type LifecycleErrorCode } from '../../errors';
import { LifecycleApiError, foldLifecycle } from '../context';
import { PT_BR_LIFECYCLE_MESSAGES as MESSAGES } from '../pt-BR';

/**
 * `foldLifecycle` as a PUBLIC contract (FUT-760).
 *
 * It was reachable only from inside this package, so a host funnelling its own
 * CRUD through `lifecycleEntity(type).lifecycle` restated the whole table —
 * eight codes, their statuses and their sentences — in a module of its own.
 * These cases are what let that copy be deleted rather than merely duplicated
 * one level up: they pin the status of every code the union declares, so a new
 * code cannot quietly inherit 422 without this file saying so.
 */

/** Every code the union declares, so adding one to `LifecycleErrorCode` lands here. */
const EVERY_CODE: Record<LifecycleErrorCode, number> = {
  ENTITY_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  ENTRY_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  REQUEST_NOT_FOUND: 404,
  REQUEST_ALREADY_DECIDED: 409,
  FEATURE_DISABLED: 403,
  NOT_AUTHORIZED: 403,
  // Not in ERROR_SURFACE — the deliberate fall-through, asserted so that
  // "unmapped" stays a decision rather than an omission nobody notices.
  INVALID_STATE: 422,
};

const throwing = (error: unknown) => () => Promise.reject(error);

describe('foldLifecycle', () => {
  it('returns the value when nothing throws', async () => {
    await expect(foldLifecycle(MESSAGES, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  for (const [code, status] of Object.entries(EVERY_CODE)) {
    it(`maps ${code} to ${status} with the configured sentence`, async () => {
      const thrown = await foldLifecycle(
        MESSAGES,
        throwing(new LifecycleError(code as LifecycleErrorCode, 'internal detail')),
      ).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(LifecycleApiError);
      expect((thrown as LifecycleApiError).status).toBe(status);
      // The library's own message never reaches the wire: the sentence is the
      // host's configured copy, which is what makes the pack swappable.
      expect((thrown as LifecycleApiError).message).not.toBe('internal detail');
      expect(Object.values(MESSAGES)).toContain((thrown as LifecycleApiError).message);
    });
  }

  it('leaves a foreign error alone — it is not this package failing', async () => {
    const boom = new TypeError('a bug in the host');
    await expect(foldLifecycle(MESSAGES, throwing(boom))).rejects.toBe(boom);
  });

  it('passes an already-folded LifecycleApiError through unchanged', async () => {
    // Nested folds are the normal case once a host wraps a packaged descriptor:
    // re-folding must not restate a 404 as the generic 422.
    const already = new LifecycleApiError(404, MESSAGES.entityNotFound);
    await expect(foldLifecycle(MESSAGES, throwing(already))).rejects.toBe(already);
  });

  it('says the HOST configured words, not this package own', async () => {
    const custom = { ...MESSAGES, entityNotFound: 'Gone.' };
    const thrown = await foldLifecycle(
      custom,
      throwing(new LifecycleError('ENTITY_NOT_FOUND', 'x')),
    ).catch((error: unknown) => error);
    expect((thrown as LifecycleApiError).message).toBe('Gone.');
  });
});
