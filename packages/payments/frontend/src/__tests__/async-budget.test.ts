// @vitest-environment jsdom
/**
 * The setup file is wired, and still says 15s.
 *
 * `setupFiles` is one line in `vitest.config.ts`, and dropping it breaks
 * nothing visibly: every case here keeps passing on a quiet machine and the
 * suite only turns red later, on a loaded runner, in whichever file rendered
 * slowest that day. That is the failure this package already had — so the
 * budget is asserted rather than assumed.
 */
import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('the async budget every findBy in this package waits under', () => {
  it('is the raised one, not Testing Library’s 1s default', () => {
    // 1000 is the default. Reading it here means the setup file never ran.
    expect(getConfig().asyncUtilTimeout).toBe(15_000);
  });
});
