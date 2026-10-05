// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../core';
import { AttentionHost, createAttentionPreferences, type AttentionCollapsedMessages } from '../react';
import { EMPTY_NOTE_MS, TAB_WIDTH_PX } from '../react/attention-collapsible';

import { MESSAGES, NOW, bell, registry, sample, views } from './attention-fixture';

/**
 * The folded mode (FUT-3316): a host that gives the words gets a thin tab on
 * the right edge instead of a button resting over its pages.
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

  it('is narrower than the gutter a page keeps from the edge', () => {
    expect(TAB_WIDTH_PX).toBeLessThan(16);
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

  it('opens halfway down the right edge, where the tab is', () => {
    host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    expect(screen.getByTestId('attention-dock').getAttribute('data-side')).toBe('right');
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

  it('leaves the drag out of the device: folding back always returns to the same spot', () => {
    const mounted = host([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-tab'));
    fireEvent.click(screen.getByRole('button', { name: 'Fold the button' }));
    expect(mounted.preferences.read().dock).toBeNull();
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
