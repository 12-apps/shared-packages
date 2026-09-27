/**
 * CONFIRMING FUT-2771's "if applicable" FOR `RadioGroup` (`Radio`).
 *
 * FUT-2771 asked to confirm whether `Radio` has the same gap `Checkbox` had:
 * `size` typed as MUI's own `'small' | 'medium'` and forwarded straight
 * through, rather than the house `SizeValue`. It does NOT — `RadioGroup.size`
 * was already `SizeValue` (`RadioGroup.types.ts`) before this ticket, and never
 * accepted MUI's own words at all (MUI's `RadioGroup` has no `size` prop of its
 * own for this one to have inherited). So there is nothing to migrate or
 * deprecate here; this file pins that so a future change cannot quietly widen
 * the prop back to MUI's words without a test noticing.
 *
 * This is UNCHANGED, confirmatory behaviour — it is not the FUT-2771 fix.
 */
import { describe, expect, it } from 'vitest';

import { SIZE_VALUES } from '../../../../tokens/vocabulary';
import type { RadioGroupProps } from '../RadioGroup.types';

describe('RadioGroupProps size', () => {
  it('already speaks the house SizeValue vocabulary', () => {
    const accepted: RadioGroupProps['size'] = 'sm';
    expect(accepted).toBe('sm');
  });

  it("rejects MUI's own words: it never accepted them, so there is nothing to deprecate", () => {
    // @ts-expect-error `RadioGroup.size` has always been `SizeValue`; MUI's own
    // `RadioGroup` has no `size` prop for this one to have inherited from.
    // Accepting `'small'` here would mean a real gap had reappeared.
    const rejected: RadioGroupProps['size'] = 'small';
    expect(rejected).toBe('small');
  });

  it("matches the house SizeValue array exactly", () => {
    expect(SIZE_VALUES).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
  });
});
