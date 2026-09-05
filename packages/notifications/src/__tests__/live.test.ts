import { describe, expect, it } from 'vitest';

import {
  LIVE_SUBJECT_KEY,
  liveActivityLane,
  livePushTag,
  type LiveActivity,
} from '../live';
import { formatWebPush } from '../server/transports/web-push';

/**
 * The live-activity contract — the two decisions this file makes on a host's
 * behalf, and both are about what happens when the host is WRONG.
 */

const LANE = [
  { id: 'placed', label: 'Recebido' },
  { id: 'preparing', label: 'Em preparo' },
  { id: 'ready', label: 'Pronto' },
];

function activity(overrides: Partial<LiveActivity> = {}): LiveActivity {
  return {
    id: 'visit:42',
    kind: 'visit',
    title: 'Consulta em andamento',
    body: null,
    link: '/consultas/42',
    steps: LANE,
    activeStepId: 'preparing',
    updatedAt: '2026-08-13T09:00:00.000Z',
    ...overrides,
  };
}

describe('liveActivityLane', () => {
  it('completes every stop BEFORE the active one, and never the active one', () => {
    const lane = liveActivityLane(activity());
    expect(lane?.activeStepId).toBe('preparing');
    expect([...(lane?.completed ?? [])]).toEqual(['placed']);
  });

  it('has nothing completed while the subject sits on the first stop', () => {
    expect([...(liveActivityLane(activity({ activeStepId: 'placed' }))?.completed ?? [])]).toEqual(
      [],
    );
  });

  it('draws NO lane when the active stop is not in it', () => {
    // The failure this exists for: a host filtering a stop out of the lane
    // while the subject is standing on it. A lane rendered anyway would be a
    // row of dots with none of them lit — which reads as a process that has
    // stopped, and is worse than the card having no lane at all.
    expect(liveActivityLane(activity({ activeStepId: 'delivered' }))).toBeNull();
  });

  it('draws no lane for a laneless activity', () => {
    expect(liveActivityLane(activity({ steps: [], activeStepId: null }))).toBeNull();
    expect(liveActivityLane(activity({ activeStepId: null }))).toBeNull();
  });
});

describe('livePushTag', () => {
  it('namespaces the subject so a live tag cannot collide with a host tag', () => {
    expect(livePushTag({ [LIVE_SUBJECT_KEY]: 'visit:42' })).toBe('live:visit:42');
  });

  it('is null for an ordinary event, and for every shape that is not an id', () => {
    expect(livePushTag(undefined)).toBeNull();
    expect(livePushTag(null)).toBeNull();
    expect(livePushTag({})).toBeNull();
    expect(livePushTag({ [LIVE_SUBJECT_KEY]: '' })).toBeNull();
    expect(livePushTag({ [LIVE_SUBJECT_KEY]: 42 })).toBeNull();
    expect(livePushTag({ [LIVE_SUBJECT_KEY]: { id: 'visit:42' } })).toBeNull();
  });
});

describe('the web-push payload', () => {
  it('carries the tag that collapses every push about one subject onto one tray entry', () => {
    const message = formatWebPush({
      title: 'Consulta pronta',
      body: 'Pode subir.',
      link: '/consultas/42',
      data: { [LIVE_SUBJECT_KEY]: 'visit:42' },
    });
    expect(message.tag).toBe('live:visit:42');
  });

  it('carries a null tag for an event, so a worker reads one payload shape', () => {
    expect(formatWebPush({ title: 'Vacina vencendo', body: 'Em 3 dias.' }).tag).toBeNull();
  });
});
