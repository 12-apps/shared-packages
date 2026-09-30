/**
 * ONLY THE CARD TAKES THE POINTER (FUT-2619).
 *
 * `HoverCard` renders through MUI's `Popover`, a modal: a root and an
 * invisible backdrop that cover the whole viewport. The card's own hover
 * handlers sit on that root. So while a card was open the pointer was "on the
 * card" wherever it went: the backdrop's `mouseover` reached the card's
 * `onMouseEnter`, which cancels a pending close, and a card left by moving the
 * mouse away stayed open. With a real mouse it never closed. In test-storybook
 * the browser's own mouseover on the freshly mounted backdrop raced the
 * story's `unhover`, and five stories failed intermittently on a card that
 * would not close.
 *
 * The paper already asked for `pointer-events: auto`, a request that only
 * means something if the root says `none`. The root never did.
 *
 * jsdom does no hit-testing, so the race itself cannot be replayed here; the
 * browser proves the behaviour. What this pins is its cause: the root, and
 * with it the backdrop, is transparent to the pointer, and the card is not.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from '../HoverCard';

describe('HoverCard: the popover lets the pointer through, the card does not', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function openCard() {
    render(
      <HoverCard title="Perfil" loadingText="Carregando…" enterDelay={100}>
        <button type="button">gatilho</button>
      </HoverCard>,
    );
    fireEvent.mouseEnter(screen.getByTestId('hover-card-trigger'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const card = screen.getByTestId('hover-card-content');
    const root = card.closest('.MuiPopover-root') as HTMLElement;
    const paper = card.closest('.MuiPopover-paper') as HTMLElement;
    return { root, paper };
  }

  it('the viewport-wide popover root takes no pointer events', () => {
    const { root } = openCard();

    expect(root).not.toBeNull();
    expect(getComputedStyle(root).pointerEvents).toBe('none');
  });

  it('the card itself still takes the pointer, so moving onto it keeps it open', () => {
    const { paper } = openCard();

    expect(paper).not.toBeNull();
    expect(getComputedStyle(paper).pointerEvents).toBe('auto');
  });
});
