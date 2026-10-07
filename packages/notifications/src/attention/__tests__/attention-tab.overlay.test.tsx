// @vitest-environment jsdom
/**
 * The folded tab floats over the page, flush with the right edge, so it is an
 * overlay that takes no room (ADR "an overlay takes no room"): it says so with
 * `data-ui-overlay`, and it is drawn OPAQUE — the quiet fill is a see-through
 * token, which used to let the page's own text show through the tab.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AttentionItem } from '../core';
import { AttentionHost, createAttentionPreferences } from '../react';

import { MESSAGES, NOW, bell, registry, sample, views } from './attention-fixture';

function host(items: readonly AttentionItem[]): void {
  render(
    <AttentionHost
      registry={registry}
      views={views}
      items={items}
      now={NOW}
      messages={MESSAGES}
      preferences={createAttentionPreferences({ storageKey: `attention-overlay:${expect.getState().currentTestName ?? ''}` })}
      collapsed={{ tab: () => 'Abrir', collapse: 'Recolher', empty: 'Nada' }}
    />,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the folded tab as an overlay', () => {
  it('says it is an overlay with nothing waiting', () => {
    host([]);

    expect(screen.getByTestId('attention-tab').hasAttribute('data-ui-overlay')).toBe(true);
  });

  it('says it is an overlay with something late', () => {
    host([bell('12', 2), sample('7', 12)]);

    expect(screen.getByTestId('attention-tab').hasAttribute('data-ui-overlay')).toBe(true);
  });

  it('lays its quiet fill over an opaque paper', () => {
    host([]);

    const style = window.getComputedStyle(screen.getByTestId('attention-tab'));
    expect(style.backgroundImage).toContain('linear-gradient');
    expect(style.backgroundColor).not.toBe('');
    expect(style.backgroundColor).not.toBe('transparent');
  });
});
