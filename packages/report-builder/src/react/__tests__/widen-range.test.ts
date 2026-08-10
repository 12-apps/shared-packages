import { describe, expect, it, vi } from 'vitest';

import { widenAction, widenLabel, widerRange } from '../lib/widen-range';

/**
 * FUT-391: an empty block offers the widening rather than reporting a dead end.
 *
 * "Sem dados no período" is ambiguous — "nothing happened" and "your window is
 * too small" look identical — and the common cause is the window, so the state
 * that reports the emptiness also offers the fix.
 */
describe('widerRange', () => {
  it('steps to the next wider period', () => {
    expect(widerRange('today')).toBe('7d');
    expect(widerRange('7d')).toBe('30d');
  });

  it('returns null at the widest', () => {
    // Nothing to offer: at 30 days the emptiness means the data is not there.
    expect(widerRange('30d')).toBeNull();
  });

  it('offers nothing from the periods that are not on the ladder', () => {
    // FUT-755 put two more pills on the toggle and neither can be a rung.
    // `month` is month-TO-DATE, so for the first week of every month it is
    // NARROWER than `7d` — offering it as "see more" would hand back fewer
    // rows, the exact confusion the offer exists to end. `custom` names dates
    // the empty state does not have, so it would resolve to nothing at all.
    //
    // This is the regression guard for the ladder itself: it used to walk
    // `REPORT_RANGES`, so both would have become offers the moment the toggle
    // grew them.
    expect(widerRange('month')).toBeNull();
    expect(widerRange('custom')).toBeNull();
  });
});

describe('widenLabel', () => {
  it('names the period it would switch to', () => {
    expect(widenLabel('7d')).toBe('Ver 7 dias');
    expect(widenLabel('30d')).toBe('Ver 30 dias');
  });
});

describe('widenAction', () => {
  it('builds an action that widens the canvas', () => {
    const onRangeChange = vi.fn();
    const action = widenAction('today', onRangeChange);

    expect(action?.label).toBe('Ver 7 dias');
    action?.onClick();
    expect(onRangeChange).toHaveBeenCalledWith('7d');
  });

  it('offers NOTHING at the widest period', () => {
    // An offer the reader cannot take is worse than none — it implies the
    // emptiness has a fix when it does not.
    expect(widenAction('30d', vi.fn())).toBeUndefined();
  });

  it('does not fire until the action is taken', () => {
    const onRangeChange = vi.fn();
    widenAction('7d', onRangeChange);
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
