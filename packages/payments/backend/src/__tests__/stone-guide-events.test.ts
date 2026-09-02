import { describe, expect, it } from 'vitest';

import {
  CHARGE_EVENTS,
  GUIDE_EXEMPT_EVENTS,
  MERCHANT_EVENTS,
  REFUND_EVENTS,
} from '../providers/stone-events';
import { EN_US_STONE_SETUP_GUIDE_COPY } from '../providers/setup-guide-en-US';
import { PT_BR_STONE_SETUP_GUIDE_COPY } from '../providers/setup-guide-pt-BR';
import { PT_BR_STONE_COPY } from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';

/**
 * The guide and the parser have to name the same events, and nothing forced
 * that. `charge.overpaid` and `charge.canceled` were parsed while the guide
 * listed three events, so no store that followed it could receive either and
 * the handling was unreachable across the platform with nothing red anywhere —
 * and the first attempt at fixing it added `charge.underpaid` to that sentence
 * while missing `charge.overpaid` beside it (FUT-674).
 *
 * The sentence is composed from `MERCHANT_EVENTS` now, so the two cannot
 * disagree about wording. What a composed sentence still cannot catch is an
 * event added to the PARSER and to neither list — which is exactly how the gap
 * opened — so that is what this asserts.
 */
/** Every event the parser acts on. A function, so no test shares a binding. */
function handledEvents(): string[] {
  return [...CHARGE_EVENTS, ...REFUND_EVENTS];
}

describe('the Stone setup guide names every event the adapter acts on', () => {
  it.each(handledEvents())('%s is named to the merchant, or exempt with a reason', (event) => {
    // Neither: the parser handles it and no store is subscribed to it, so the
    // handling cannot run anywhere. Both: the exemption's reason is a lie.
    const named = MERCHANT_EVENTS.includes(event);
    const exempt = Boolean(GUIDE_EXEMPT_EVENTS.get(event));
    expect({ event, named: named || exempt, contradictory: named && exempt }).toEqual({
      event,
      named: true,
      contradictory: false,
    });
  });

  it('every merchant-facing event is one the parser acts on', () => {
    // The other direction: telling a store to subscribe to something we drop
    // costs it deliveries and tells it the integration does more than it does.
    const handled = handledEvents();
    expect(MERCHANT_EVENTS.filter((event) => !handled.includes(event))).toEqual([]);
  });

  it.each([
    ['pt-BR', PT_BR_STONE_SETUP_GUIDE_COPY],
    ['en-US', EN_US_STONE_SETUP_GUIDE_COPY],
  ])('%s renders the full list into the sentence', (_locale, copy) => {
    const sentence = copy.webhook.events(MERCHANT_EVENTS.join(', '));
    for (const event of MERCHANT_EVENTS) expect(sentence).toContain(event);
  });

  it('reaches the guide a store actually reads', () => {
    const guide = stoneProvider(PT_BR_STONE_COPY).setupGuide?.({
      webhookUrl: 'https://example.test/hook',
      brandName: 'Loja',
    });
    const steps = (guide?.sections ?? []).flatMap((section) => section.steps);
    const rendered = steps.map((step) => step.text).join('\n');
    // The composition is only worth anything if the composed sentence is the
    // one the screen shows — a guide assembled from a different string would
    // pass every assertion above and still ship the stale list.
    for (const event of MERCHANT_EVENTS) expect(rendered).toContain(event);
  });
});
