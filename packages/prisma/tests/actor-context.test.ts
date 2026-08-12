import { describe, expect, it } from 'vitest';

import { getActorUserId, runWithActor, setActor } from '../src/actor-context';

describe('actor-context (FUT-168)', () => {
  it('exposes the actor set by runWithActor to code inside the callback', () => {
    expect(getActorUserId()).toBeUndefined();
    const seen = runWithActor('user-1', () => getActorUserId());
    expect(seen).toBe('user-1');
    // The store does not leak outside the callback.
    expect(getActorUserId()).toBeUndefined();
  });

  it('runWithActor propagates through awaits inside the callback', async () => {
    const seen = await runWithActor('user-2', async () => {
      await Promise.resolve();
      return getActorUserId();
    });
    expect(seen).toBe('user-2');
  });

  it('setActor applies within the current async context and its later awaits', async () => {
    await runWithActor('outer', async () => {
      setActor('inner');
      await Promise.resolve();
      // setActor in this scope wins over the surrounding runWithActor.
      expect(getActorUserId()).toBe('inner');
    });
  });

  it('setActor ignores an empty id (superadmin without a users row)', () => {
    runWithActor('user-3', () => {
      setActor('');
      // Empty id is a no-op, so the surrounding actor is preserved.
      expect(getActorUserId()).toBe('user-3');
    });
  });
});
