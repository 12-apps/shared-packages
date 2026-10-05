// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../core';
import { AttentionHost, createAttentionPreferences, type AttentionCollapsedMessages } from '../react';
import { EMPTY_NOTE_MS } from '../react/attention-collapsible';

import { MESSAGES, NOW, bell, registry, sample, views } from './attention-fixture';

/**
 * The folded mode: a host that gives the words gets a half disc on the right
 * edge instead of a button resting over its pages.
 */
const FOLDED: AttentionCollapsedMessages = {
  tab: (count, worst) => (count === 0 ? 'Nothing waiting — open' : `${count} waiting, the worst ${worst} — open`),
  collapse: 'Fold the button',
  empty: 'Nothing to see',
};

function host(items: readonly AttentionItem[], { folds = true }: { readonly folds?: boolean } = {}) {
  const collapsed = folds ? FOLDED : undefined;
  const preferences = createAttentionPreferences({
    storageKey: `attention-folded:${expect.getState().currentTestName ?? ''}`,
  });
  const element = (next: readonly AttentionItem[]) => (
    <AttentionHost
      registry={registry}
      views={views}
      items={next}
      now={NOW}
      messages={MESSAGES}
      preferences={preferences}
      collapsed={collapsed}
    />
  );
  const view = render(element(items));
  return { ...view, preferences, update: (next: readonly AttentionItem[]) => view.rerender(element(next)) };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the folded button', () => {
  it('rests as a tab with nothing waiting, where an unfolded host draws nothing', () => {
    host([]);
    const tab = screen.getByTestId('attention-tab');
    expect(tab.getAttribute('aria-label')).toBe('Nothing waiting — open');
    expect(tab.getAttribute('data-severity')).toBe('none');
    expect(tab.textContent).toBe('');
    expect(screen.queryAllByTestId('attention-dock')).toHaveLength(0);
  });

  it('carries the count in the colour of the worst, and no button until it is opened', () => {
    host([bell('12', 2), sample('7', 12)]);
    const tab = screen.getByTestId('attention-tab');
    expect(tab.textContent).toBe('2');
    expect(tab.getAttribute('data-severity')).toBe('late');
    expect(tab.getAttribute('aria-label')).toBe('2 waiting, the worst late — open');
    expect(screen.queryAllByTestId('attention-button')).toHaveLength(0);
  });

  it('prints two digits, with the full number in its name', () => {
    host(Array.from({ length: 12 }, (_, i) => bell(`r${i}`, 2)));
    const tab = screen.getByTestId('attention-tab');
    expect(tab.textContent).toBe('12');
    expect(tab.getAttribute('data-count')).toBe('12');
    expect(tab.getAttribute('aria-label')).toBe('12 waiting, the worst calm — open');
  });

  it('prints 99+ past two digits', () => {
    host(Array.from({ length: 120 }, (_, i) => bell(`r${i}`, 2)));
    expect(screen.getByTestId('attention-tab').textContent).toBe('99+');
  });

  it('pulses as the open button does', () => {
    host([sample('7', 12), bell('12', 2)]);
    const tab = screen.getByTestId('attention-tab');
    const pulse = tab.getAttribute('data-pulse');
    expect(pulse).not.toBe('still');
    expect(tab.querySelectorAll('span[aria-hidden]').length).toBeGreaterThan(0);
    fireEvent.click(tab);
    expect(screen.getByTestId('attention-button').getAttribute('data-pulse')).toBe(pulse);
  });

  it('stays still with nothing waiting', () => {
    host([]);
    const tab = screen.getByTestId('attention-tab');
    expect(tab.getAttribute('data-pulse')).toBe('still');
    expect(tab.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
  });

  it('puts the minus under the button at its rest, halfway down', () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByTestId('attention-collapse-spot').getAttribute('data-place')).toBe('below');
  });

  it('hides the minus while the list of the others is open', () => {
    host([bell('12', 2), bell('3', 1)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    fireEvent.click(screen.getByTestId('attention-others'));
    expect(screen.queryAllByTestId('attention-collapse-spot')).toHaveLength(0);
  });

  it('opens into the ordinary button beside a round minus, and folds back on it', () => {
    host([bell('12', 2), sample('7', 12)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByTestId('attention-button').getAttribute('aria-label')).toBe(
      'Next: Room 7, Sample ready, 12 min; 1 more',
    );
    expect(screen.getByTestId('attention-others').textContent).toContain('+1');
    expect(screen.queryAllByTestId('attention-tab')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Fold the button' }));
    expect(screen.getByTestId('attention-tab')).toBeTruthy();
    expect(screen.queryAllByTestId('attention-button')).toHaveLength(0);
  });

  it('says there is nothing to see, and folds itself back a moment later', () => {
    vi.useFakeTimers();
    host([]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByRole('status').textContent).toBe('Nothing to see');
    expect(screen.queryAllByTestId('attention-button')).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(EMPTY_NOTE_MS);
    });
    expect(screen.getByTestId('attention-tab')).toBeTruthy();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('folds itself back when the last thing waiting leaves', () => {
    const { update } = host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByTestId('attention-button')).toBeTruthy();
    update([]);
    expect(screen.getByTestId('attention-tab')).toBeTruthy();
    expect(screen.queryAllByTestId('attention-dock')).toHaveLength(0);
  });

  it('stays open while something is still waiting', () => {
    const { update } = host([bell('12', 2), bell('3', 1)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    update([bell('3', 1)]);
    expect(screen.getByTestId('attention-button').getAttribute('aria-label')).toContain('Room 3');
    expect(screen.queryAllByTestId('attention-tab')).toHaveLength(0);
  });

  it('still opens the head item from the open button', () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    fireEvent.click(screen.getByTestId('attention-button'));
    expect(screen.getByRole('dialog', { name: 'Room 12' })).toBeTruthy();
  });

  it('keeps an open sheet mounted when the button folds', () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    fireEvent.click(screen.getByTestId('attention-button'));
    const sheet = screen.getByRole('dialog', { name: 'Room 12' });
    fireEvent.click(screen.getByRole('button', { name: 'Fold the button' }));
    expect(screen.getByTestId('attention-tab')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Room 12' })).toBe(sheet);
  });
});

describe("focus follows the reader's own taps", () => {
  it('lands on the button when the tab opens it, and back on the tab when the minus folds it', async () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('attention-button')));
    fireEvent.click(screen.getByRole('button', { name: 'Fold the button' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('attention-tab')));
  });

  it('lands on the minus when nothing waits', async () => {
    host([]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('attention-collapse')));
  });

  it('leaves focus alone when it folds by itself', async () => {
    const { update } = host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('attention-button')));
    // Nobody tapped the minus: the fold is the data's, and focus is not pulled to the tab.
    update([]);
    const tab = await screen.findByTestId('attention-tab');
    await waitFor(() => expect(document.activeElement).not.toBe(tab));
  });
});

describe('the drag, while it is open', () => {
  beforeEach(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventStandIn extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      }
      Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStandIn });
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it("moves it while open, never into the device, and folding back returns it to the tab's side", () => {
    const mounted = host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    const dock = screen.getByTestId('attention-dock');
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      left: 320,
      top: 368,
      width: 64,
      height: 64,
      right: 384,
      bottom: 432,
      x: 320,
      y: 368,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(dock, { clientX: 350, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 60, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(dock, { clientX: 60, clientY: 300, pointerId: 1 });
    // The click a browser fires at the end of the drag, which the dock swallows.
    fireEvent.click(dock);
    expect(screen.getByTestId('attention-dock').getAttribute('data-side')).toBe('left');
    expect(mounted.preferences.read().dock).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fold the button' }));
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByTestId('attention-dock').getAttribute('data-side')).toBe('right');
  });

  it('puts the minus over the button once it is dragged into the bottom half', () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    const dock = screen.getByTestId('attention-dock');
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      left: 320,
      top: 368,
      width: 64,
      height: 64,
      right: 384,
      bottom: 432,
      x: 320,
      y: 368,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(dock, { clientX: 350, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 350, clientY: 740, pointerId: 1 });
    fireEvent.pointerUp(dock, { clientX: 350, clientY: 740, pointerId: 1 });
    fireEvent.click(dock);
    expect(screen.getByTestId('attention-collapse-spot').getAttribute('data-place')).toBe('above');
  });
});

describe('a host that does not fold', () => {
  it('keeps drawing nothing while nothing waits', () => {
    host([], { folds: false });
    expect(screen.queryAllByTestId('attention-tab')).toHaveLength(0);
    expect(screen.queryAllByTestId('attention-dock')).toHaveLength(0);
  });

  it('shows the button at once, with no minus', () => {
    host([bell('12', 2)], { folds: false });
    expect(screen.getByTestId('attention-button')).toBeTruthy();
    expect(screen.queryAllByTestId('attention-collapse')).toHaveLength(0);
  });
});
