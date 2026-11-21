// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AttentionItem } from '../core';
import { AttentionHost, attentionView, createAttentionPreferences } from '../react';

import { MESSAGES, NOW, bell, registry, sample, views as baseViews } from './attention-fixture';

/**
 * `renderActions` on an attention kind's view: the host's controls on a row of
 * the "+N" list, beside the row's button and never inside it.
 */

interface Seen {
  closed: number;
  acted: string[];
  opened: string[];
}

type Actions = (item: AttentionItem, close: () => void, seen: Seen) => ReactNode;

function mount(actions?: Actions, items: readonly AttentionItem[] = [sample('7', 25), bell('12', 7), bell('3', 1)]): Seen {
  const seen: Seen = { closed: 0, acted: [], opened: [] };
  const views = {
    bell: attentionView({
      ...baseViews.bell,
      onOpen: (item) => seen.opened.push(item.id),
      renderSheet: undefined,
      ...(actions ? { renderActions: ({ item, close }) => actions(item, close, seen) } : {}),
    }),
    sample: baseViews.sample,
  };
  render(
    <AttentionHost
      registry={registry}
      views={views}
      items={items}
      now={NOW}
      messages={MESSAGES}
      preferences={createAttentionPreferences({
        storageKey: `attention-actions:${expect.getState().currentTestName ?? ''}`,
      })}
    />,
  );
  if (screen.queryAllByTestId('attention-others').length > 0 && items.length > 1) {
    fireEvent.click(screen.getByTestId('attention-others'));
  }
  return seen;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('attention renderActions', () => {
  it('draws no slot and the same row when the kind has none', async () => {
    mount();
    const row = await screen.findByTestId('attention-others-12');
    expect(document.querySelectorAll('[data-testid^="attention-actions-"]')).toHaveLength(0);
    expect(row.closest('li')?.children).toHaveLength(1);
  });

  it.each([null, undefined, false, true])('treats %s as no actions', async (answer) => {
    mount(() => answer);
    await screen.findByTestId('attention-others-12');
    expect(screen.queryAllByTestId('attention-actions-12')).toHaveLength(0);
  });

  it('draws the controls beside the row button, after it, never inside it', async () => {
    mount((item) => <button type="button">{`Accept ${item.id}`}</button>);
    const row = await screen.findByTestId('attention-others-12');
    const accept = screen.getByRole('button', { name: 'Accept 12' });

    expect(row.contains(accept)).toBe(false);
    expect(accept.closest('[inert], [aria-hidden="true"]') === null).toBe(true);
    expect(row.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('attention-actions-12').closest('li')).toBe(row.closest('li'));
  });

  it('never opens the row on an action click, and hands the host close', async () => {
    const seen = mount((item, close, record) => (
      <button
        type="button"
        onClick={() => {
          record.acted.push(item.id);
          record.closed += 1;
          close();
        }}
      >
        {`Accept ${item.id}`}
      </button>
    ));
    await screen.findByTestId('attention-others-12');
    fireEvent.click(screen.getByRole('button', { name: 'Accept 12' }));

    expect(seen.acted).toEqual(['12']);
    expect(seen.opened).toEqual([]);
    expect(seen.closed).toBe(1);
  });

  it('still opens the row from its own button', async () => {
    const seen = mount(() => <button type="button">Accept</button>);
    fireEvent.click(await screen.findByTestId('attention-others-12'));
    expect(seen.opened).toEqual(['12']);
  });

  it('puts only the kind that has actions through the slot', async () => {
    mount((item) => (item.id === '12' ? <button type="button">Accept</button> : null));
    await screen.findByTestId('attention-others-12');
    expect(screen.getByTestId('attention-actions-12')).toBeTruthy();
    expect(screen.queryAllByTestId('attention-actions-3')).toHaveLength(0);
  });

  describe('the head item', () => {
    const accept = (item: AttentionItem): ReactNode => <button type="button">{`Accept ${item.id}`}</button>;

    it('shows a lone pending item its actions, one tap from the dock button', async () => {
      const seen = mount(accept, [bell('12', 7)]);
      expect(screen.queryAllByTestId('attention-actions-12')).toHaveLength(0);
      fireEvent.click(screen.getByTestId('attention-button'));
      expect(await screen.findByRole('button', { name: 'Accept 12' })).toBeTruthy();
      expect(seen.opened).toEqual([]);
      expect(screen.queryAllByTestId('attention-others')).toHaveLength(0);
    });

    it('lists the head first, with the others after it, from the +N too', async () => {
      mount(accept, [bell('12', 7), bell('3', 1)]);
      fireEvent.click(screen.getByTestId('attention-others'));
      await screen.findByTestId('attention-others-12');
      const rows = screen.getAllByTestId(/^attention-others-\d+$/).map((el) => el.getAttribute('data-testid'));
      expect(rows).toEqual(['attention-others-12', 'attention-others-3']);
      expect(screen.getByTestId('attention-actions-12')).toBeTruthy();
      expect(screen.getByTestId('attention-actions-3')).toBeTruthy();
    });

    it('keeps an item its actions when it becomes the head', async () => {
      const first = [bell('12', 7), bell('3', 1)];
      const view = render(
        <AttentionHost
          registry={registry}
          views={{ bell: attentionView({ ...baseViews.bell, renderActions: ({ item }) => accept(item) }), sample: baseViews.sample }}
          items={first}
          now={NOW}
          messages={MESSAGES}
          preferences={createAttentionPreferences({ storageKey: 'attention-actions:become-head' })}
        />,
      );
      fireEvent.click(screen.getByTestId('attention-others'));
      await screen.findByTestId('attention-actions-3');
      view.rerender(
        <AttentionHost
          registry={registry}
          views={{ bell: attentionView({ ...baseViews.bell, renderActions: ({ item }) => accept(item) }), sample: baseViews.sample }}
          items={[first[1] as AttentionItem]}
          now={NOW}
          messages={MESSAGES}
          preferences={createAttentionPreferences({ storageKey: 'attention-actions:become-head' })}
        />,
      );
      fireEvent.click(await screen.findByTestId('attention-button'));
      expect(await screen.findByRole('button', { name: 'Accept 3' })).toBeTruthy();
    });

    it('opens the head from its own list row, and never from an action', async () => {
      const seen = mount(accept, [bell('12', 7)]);
      fireEvent.click(screen.getByTestId('attention-button'));
      fireEvent.click(await screen.findByRole('button', { name: 'Accept 12' }));
      expect(seen.opened).toEqual([]);
      fireEvent.click(screen.getByTestId('attention-others-12'));
      expect(seen.opened).toEqual(['12']);
    });

    it('opens the head item directly, as before, when its kind draws no actions', () => {
      const seen = mount(undefined, [bell('12', 7)]);
      fireEvent.click(screen.getByTestId('attention-button'));
      expect(seen.opened).toEqual(['12']);
      expect(screen.queryAllByTestId('attention-others-list')).toHaveLength(0);
    });
  });
});
