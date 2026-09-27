/**
 * A PRESS OUTSIDE AN OPEN CARD DISMISSES IT (FUT-2619).
 *
 * The popover root is `pointer-events: none`, so the page under an open card
 * stays usable. That also takes MUI's invisible backdrop out of play, and the
 * backdrop was the card's only click-away. Touch has no mouse-leave, so a card
 * opened by long-press had nothing left to close it but Escape.
 *
 * `useClickAway` listens for `pointerdown` on the document, in the CAPTURE
 * phase, while the card is open — so a `stopPropagation` further in, on a
 * nested control's own bubble or on something else entirely, cannot swallow
 * it (FUT-2776). A press on the trigger or inside the card is not "away".
 * The listener only observes: the press keeps its default and still reaches
 * its target.
 *
 * That capture placement means the decision cannot be made synchronously —
 * `document` is the outermost node on the capture path, so this listener
 * fires BEFORE the card's own `onPointerDownCapture` ownership marker further
 * down the same tree gets its turn. `useClickAway` defers with
 * `queueMicrotask`, which runs once the whole native capture-then-bubble
 * dispatch (marker included) has finished. Every assertion below that follows
 * a `fireEvent.pointerDown` that this listener is meant to evaluate awaits
 * `flushClickAway()` first, to give that microtask its turn.
 *
 * The long-press cases pin a second bug on the same path: the touch timer read
 * `event.currentTarget` after React had nulled it, so a long-pressed card
 * opened with no anchor, and "a tap on the trigger" could not be recognised.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from '../HoverCard';

const ENTER = 100;

function renderCard() {
  const onOutside = vi.fn();
  const { unmount } = render(
    <>
      <HoverCard title="Perfil" loadingText="Carregando…" enterDelay={ENTER} exitDelay={0}>
        <button type="button">gatilho</button>
      </HoverCard>
      <button type="button" onClick={onOutside}>
        fora
      </button>
    </>,
  );
  return {
    trigger: screen.getByTestId('hover-card-trigger'),
    outside: screen.getByText('fora'),
    onOutside,
    unmount,
  };
}

/** How many cards are mounted: 0 closed, 1 open. */
const openCards = () => screen.queryAllByTestId('hover-card-content').length;

const runTimers = () => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
};

/**
 * Gives `useClickAway`'s deferred `queueMicrotask` its turn. Fake timers
 * (`vi.useFakeTimers`) do not fake microtasks, so a real `Promise` tick is
 * enough — but it has to happen inside `act` so the resulting `setState`
 * (via `handleClose`) is flushed before the next assertion reads the DOM.
 */
const flushClickAway = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  // The popover unmounts its content only once MUI's exit transition ends,
  // which runs on a (fake) timer of its own — a SEPARATE tick from the
  // microtask above that decides whether to close at all.
  runTimers();
};

function openByHover(trigger: HTMLElement) {
  fireEvent.mouseEnter(trigger);
  runTimers();
  expect(openCards()).toBe(1);
}

describe('HoverCard: click-away', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a pointerdown on the page outside the card closes it', async () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(document.body);
    await flushClickAway();

    expect(openCards()).toBe(0);
  });

  it('a pointerdown inside the card does not close it', async () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(screen.getByText('Perfil'));
    await flushClickAway();

    expect(openCards()).toBe(1);
  });

  it('a pointerdown on the trigger does not close it', async () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(trigger);
    await flushClickAway();

    expect(openCards()).toBe(1);
  });

  it('the outside press is not swallowed: it keeps its default and its click still lands', async () => {
    const { trigger, outside, onOutside } = renderCard();
    openByHover(trigger);

    const notCancelled = fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    await flushClickAway();

    expect(notCancelled).toBe(true);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(openCards()).toBe(0);
  });

  it('a card opened by long-press is anchored to its trigger, and a tap elsewhere closes it', async () => {
    const { trigger } = renderCard();

    fireEvent.touchStart(trigger);
    runTimers(); // the long-press delay
    runTimers(); // the enter delay it hands over to
    expect(openCards()).toBe(1);

    // Anchored: a tap on the trigger is recognised as inside, and keeps it open.
    fireEvent.pointerDown(trigger);
    await flushClickAway();
    expect(openCards()).toBe(1);

    fireEvent.pointerDown(document.body);
    await flushClickAway();
    expect(openCards()).toBe(0);
  });

  /**
   * PINS why the document listener stays on CAPTURE (FUT-2776 adversarial
   * review): an interim revision moved it to bubble, which is defeated by a
   * `stopPropagation` ANYWHERE on the path, including something that has
   * nothing to do with the card at all. Capture on `document` runs before
   * the native dispatch ever reaches that element, so it sees the press
   * regardless of what that element's own bubble handler goes on to do.
   */
  it('an outside element that stops native propagation on its own pointerdown still closes the card', async () => {
    const onOutsidePointerDown = vi.fn((event: React.PointerEvent) => event.stopPropagation());
    render(
      <>
        <HoverCard title="Perfil" loadingText="Carregando…" enterDelay={ENTER} exitDelay={0}>
          <button type="button">gatilho</button>
        </HoverCard>
        <button type="button" data-testid="outside-stopper" onPointerDown={onOutsidePointerDown}>
          fora que para a propagação
        </button>
      </>,
    );
    const trigger = screen.getByTestId('hover-card-trigger');
    openByHover(trigger);

    fireEvent.pointerDown(screen.getByTestId('outside-stopper'));
    await flushClickAway();

    expect(onOutsidePointerDown).toHaveBeenCalledTimes(1);
    expect(openCards()).toBe(0);
  });

  it('listens only while open, in the capture phase, and stops on close and on unmount', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const pointerdown = (spy: typeof add) =>
      spy.mock.calls.filter(([type, , options]) => type === 'pointerdown' && options === true).length;

    const { trigger, unmount } = renderCard();
    expect(pointerdown(add)).toBe(0);

    openByHover(trigger);
    expect(pointerdown(add)).toBe(1);

    fireEvent.pointerDown(document.body);
    await flushClickAway();
    expect(pointerdown(remove)).toBe(1);

    openByHover(trigger);
    expect(pointerdown(add)).toBe(2);
    unmount();
    expect(pointerdown(remove)).toBe(2);
    add.mockRestore();
    remove.mockRestore();
  });
});
