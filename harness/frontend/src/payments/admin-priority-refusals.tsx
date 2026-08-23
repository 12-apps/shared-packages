import { useState, type JSX } from 'react';

import { refusalTag } from './admin-cases';
import type { AdminWorld } from './admin-store';

/**
 * Split out of `admin-cases.tsx` for the 400-line size gate. It is the right
 * cut anyway: everything else in that file is the settings MOUNT and its
 * world, and this is a pair of raw requests the mounted control can never
 * make.
 */

/**
 * The two `assertReorderOnly` refusals the package's own reorder control can
 * never send (it always permutes the rendered chain), issued raw at the
 * mount. Both land in the shared `admin-priorities-refusal` fact as
 * `"<status> <error>"`.
 */
export function PriorityRefusalButtons({
  world,
  legs,
}: {
  world: AdminWorld;
  legs: { testid: string; label: string; providers: string[] }[];
}): JSX.Element {
  const [refusal, setRefusal] = useState('(none)');
  const put = async (providers: string[]): Promise<void> => {
    const response = await world.fetchImpl(`${world.baseUrl}/settings/priorities`, {
      method: 'PUT',
      body: JSON.stringify({ providers }),
    });
    setRefusal(`${response.status} ${await refusalTag(response)}`);
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
      {legs.map((leg) => (
        <button
          key={leg.testid}
          type="button"
          data-testid={leg.testid}
          onClick={() => void put(leg.providers)}
        >
          {leg.label}
        </button>
      ))}
      <output data-testid="admin-priorities-refusal">{refusal}</output>
    </div>
  );
}
