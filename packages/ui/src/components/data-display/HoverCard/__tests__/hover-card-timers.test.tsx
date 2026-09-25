/**
 * A CLOSED HOVER CARD STAYS CLOSED (FUT-2619).
 *
 * The card opens on a timer (`enterDelay`) and closes on one (`exitDelay`), and
 * `useHoverCard` kept ONE ref per timer. Two paths left an open-timer running
 * with nothing able to cancel it:
 *
 *  - `openCard` overwrote `enterTimeoutRef` without clearing what it held, so a
 *    second `mouseenter` before the first delay ran out orphaned the first
 *    timer. Neither a close, nor Escape, nor unmount could reach it any more.
 *  - `handleClose` (Escape, and the popover's own `onClose`) closed the card
 *    and cleared nothing, so an open-timer still pending simply fired after it.
 *
 * Either way the card reopened by itself after being dismissed. In the browser
 * `Cards/HoverCard/Tests › Keyboard Navigation` found the card's title still
 * there 3 s after Escape, and `› Integration` intermittently found the card
 * still mounted after unhover.
 *
 * Fake timers make the order exact: each case says which timers are pending
 * when the card is dismissed, then runs every timer that is left. "Closed" is
 * read only after that: the popover's exit transition keeps the card mounted
 * until its own timer runs, so the DOM right after Escape proves nothing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from '../HoverCard';

const ENTER = 100;

function renderCard() {
  render(
    <HoverCard title="Perfil" loadingText="Carregando…" enterDelay={ENTER} exitDelay={0}>
      <button type="button">gatilho</button>
    </HoverCard>,
  );
  return screen.getByTestId('hover-card-trigger');
}

/** How many cards are mounted: 0 closed, 1 open (2 would be its own bug). */
const openCards = () => screen.queryAllByTestId('hover-card-content').length;
const isOpen = () => openCards() > 0;

/** Advance in small steps until the card is open; fails if it never opens. */
function advanceUntilOpen(limit = 1000) {
  for (let elapsed = 0; elapsed < limit && !isOpen(); elapsed += 5) {
    act(() => {
      vi.advanceTimersByTime(5);
    });
  }
  expect(isOpen()).toBe(true);
}

const pressEscape = () => {
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape' });
  });
};

const runEveryPendingTimer = () => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
};

describe('HoverCard: a dismissed card does not reopen by itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a second mouseenter before the delay leaves one open-timer, not two', () => {
    const trigger = renderCard();

    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(ENTER / 10);
    });
    // The pointer re-enters (a click then a hover, a jitter across the edge).
    fireEvent.mouseEnter(trigger);

    advanceUntilOpen();
    pressEscape();

    runEveryPendingTimer();
    expect(openCards()).toBe(0);
  });

  it('Escape cancels an open-timer that is still pending', () => {
    const trigger = renderCard();

    fireEvent.mouseEnter(trigger);
    advanceUntilOpen();

    // Out and straight back in: the card is open AND an open-timer is pending.
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    pressEscape();

    runEveryPendingTimer();
    expect(openCards()).toBe(0);
  });

  it('still opens on hover after a dismissal (the fix cancels timers, not the card)', () => {
    const trigger = renderCard();

    fireEvent.mouseEnter(trigger);
    advanceUntilOpen();
    pressEscape();
    runEveryPendingTimer();
    expect(openCards()).toBe(0);

    fireEvent.mouseLeave(trigger);
    runEveryPendingTimer();
    fireEvent.mouseEnter(trigger);
    advanceUntilOpen();
  });
});
