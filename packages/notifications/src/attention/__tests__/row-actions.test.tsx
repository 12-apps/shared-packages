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

function mount(actions?: Actions): Seen {
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
      items={[sample('7', 25), bell('12', 7), bell('3', 1)]}
      now={NOW}
      messages={MESSAGES}
      preferences={createAttentionPreferences({
        storageKey: `attention-actions:${expect.getState().currentTestName ?? ''}`,
      })}
    />,
  );
  fireEvent.click(screen.getByTestId('attention-others'));
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
});
