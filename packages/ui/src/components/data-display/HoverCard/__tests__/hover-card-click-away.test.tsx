/**
 * A PRESS OUTSIDE AN OPEN CARD DISMISSES IT (FUT-2619).
 *
 * The popover root is `pointer-events: none`, so the page under an open card
 * stays usable. That also takes MUI's invisible backdrop out of play, and the
 * backdrop was the card's only click-away. Touch has no mouse-leave, so a card
 * opened by long-press had nothing left to close it but Escape.
 *
 * `useClickAway` listens for `pointerdown` on the document, in the capture
 * phase, while the card is open. A press on the trigger or inside the card is
 * not "away". The listener only observes: the press keeps its default and
 * still reaches its target.
 *
 * The long-press cases pin a second bug on the same path: the touch timer read
 * `event.currentTarget` after React had nulled it, so a long-pressed card
 * opened with no anchor, and "a tap on the trigger" could not be recognised.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('a pointerdown on the page outside the card closes it', () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(document.body);
    runTimers();

    expect(openCards()).toBe(0);
  });

  it('a pointerdown inside the card does not close it', () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(screen.getByText('Perfil'));
    runTimers();

    expect(openCards()).toBe(1);
  });

  it('a pointerdown on the trigger does not close it', () => {
    const { trigger } = renderCard();
    openByHover(trigger);

    fireEvent.pointerDown(trigger);
    runTimers();

    expect(openCards()).toBe(1);
  });

  it('the outside press is not swallowed: it keeps its default and its click still lands', () => {
    const { trigger, outside, onOutside } = renderCard();
    openByHover(trigger);

    const notCancelled = fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    runTimers();

    expect(notCancelled).toBe(true);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(openCards()).toBe(0);
  });

  it('a card opened by long-press is anchored to its trigger, and a tap elsewhere closes it', () => {
    const { trigger } = renderCard();

    fireEvent.touchStart(trigger);
    runTimers(); // the long-press delay
    runTimers(); // the enter delay it hands over to
    expect(openCards()).toBe(1);

    // Anchored: a tap on the trigger is recognised as inside, and keeps it open.
    fireEvent.pointerDown(trigger);
    runTimers();
    expect(openCards()).toBe(1);

    fireEvent.pointerDown(document.body);
    runTimers();
    expect(openCards()).toBe(0);
  });

  it('listens only while open, in the capture phase, and stops on close and on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const pointerdown = (spy: typeof add) =>
      spy.mock.calls.filter(([type, , options]) => type === 'pointerdown' && options === true).length;

    const { trigger, unmount } = renderCard();
    expect(pointerdown(add)).toBe(0);

    openByHover(trigger);
    expect(pointerdown(add)).toBe(1);

    fireEvent.pointerDown(document.body);
    runTimers();
    expect(pointerdown(remove)).toBe(1);

    openByHover(trigger);
    expect(pointerdown(add)).toBe(2);
    unmount();
    expect(pointerdown(remove)).toBe(2);
    add.mockRestore();
    remove.mockRestore();
  });
});
