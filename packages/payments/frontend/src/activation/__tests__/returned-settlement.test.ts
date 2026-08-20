// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RETURNED_SETTLEMENT_KEY,
  clearReturnedSettlement,
  takeReturnedSettlement,
} from '../returned-settlement';

/**
 * The return trip's ids, and the ordering that keeps them alive.
 *
 * The defect these pin: reading and scrubbing in one call destroyed the ids on
 * the second render, and a reload destroyed an in-memory copy too — so a
 * payment the provider had already confirmed was verified once, thrown away,
 * and never asked about again.
 */

function land(search: string): void {
  window.history.replaceState({}, '', `/config/payments${search}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  land('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('takeReturnedSettlement', () => {
  it('captures both ids, because asking with one of them always answers no', () => {
    land('?transaction_nsu=TX9&slug=loja-teste');
    expect(takeReturnedSettlement()).toEqual({ transactionNsu: 'TX9', slug: 'loja-teste' });
  });

  it('parks them before scrubbing, so a SECOND read still has them', () => {
    land('?transaction_nsu=TX9&slug=loja-teste');
    takeReturnedSettlement();

    // The resume effect re-runs whenever its parent re-renders, and "check now"
    // asks again by hand. Both must carry the same proof as the first ask.
    expect(takeReturnedSettlement()).toEqual({ transactionNsu: 'TX9', slug: 'loja-teste' });
  });

  it('takes the ids out of the address bar, keeping the rest of the query', () => {
    land('?provider=redirect&transaction_nsu=TX9&order_nsu=OR1&slug=s&receipt_url=r&capture_method=c');
    takeReturnedSettlement();
    expect(window.location.search).toBe('?provider=redirect');
  });

  it('accepts the transaction id under either spelling', () => {
    land('?transaction_id=TX7');
    expect(takeReturnedSettlement()).toEqual({ transactionNsu: 'TX7' });
  });

  it('captures a lone slug — a half answer is still evidence of the trip', () => {
    land('?slug=loja-teste');
    expect(takeReturnedSettlement()).toEqual({ slug: 'loja-teste' });
  });

  it('answers with the parked ids when the URL carries none', () => {
    window.sessionStorage.setItem(RETURNED_SETTLEMENT_KEY, JSON.stringify({ transactionNsu: 'TX1' }));
    expect(takeReturnedSettlement()).toEqual({ transactionNsu: 'TX1' });
    // …and leaves the address bar alone: there was nothing of ours in it.
    expect(window.location.search).toBe('');
  });

  it('answers empty when nothing is parked and nothing came back', () => {
    expect(takeReturnedSettlement()).toEqual({});
  });

  it('survives storage refusing the write — the in-URL copy still answers', () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    land('?transaction_nsu=TX9');
    expect(takeReturnedSettlement()).toEqual({ transactionNsu: 'TX9' });
  });

  it('survives storage refusing the read', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(takeReturnedSettlement()).toEqual({});
  });

  it('ignores an unparsable parked value rather than throwing at the caller', () => {
    window.sessionStorage.setItem(RETURNED_SETTLEMENT_KEY, 'not json');
    expect(takeReturnedSettlement()).toEqual({});
  });

  it('parks under the key it is given, so two surfaces do not read each other', () => {
    land('?transaction_nsu=TX9');
    takeReturnedSettlement('other:slot');

    expect(window.sessionStorage.getItem(RETURNED_SETTLEMENT_KEY)).toBeNull();
    expect(takeReturnedSettlement('other:slot')).toEqual({ transactionNsu: 'TX9' });
    expect(takeReturnedSettlement()).toEqual({});
  });
});

describe('clearReturnedSettlement', () => {
  it('drops the parked ids once the charge is done with them', () => {
    land('?transaction_nsu=TX9');
    takeReturnedSettlement();
    clearReturnedSettlement();
    expect(takeReturnedSettlement()).toEqual({});
  });

  it('clears the key it is given', () => {
    land('?transaction_nsu=TX9');
    takeReturnedSettlement('other:slot');
    clearReturnedSettlement('other:slot');
    expect(takeReturnedSettlement('other:slot')).toEqual({});
  });

  it('is best-effort — a refusing store is not an error the screen sees', () => {
    vi.spyOn(window.sessionStorage, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearReturnedSettlement()).not.toThrow();
  });
});
