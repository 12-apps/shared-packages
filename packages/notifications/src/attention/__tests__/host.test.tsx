// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attentionKind, defineAttention, type AttentionItem } from '../core';
import {
  AttentionHost,
  AttentionQuickSettings,
  attentionView,
  createAttentionPreferences,
  type AttentionMessages,
} from '../react';

/**
 * The attention button through what a host touches: a registry, the views per
 * kind, the items, and the copy. The copy here is a made-up clinic's, so
 * nothing in the suite leans on any adopter's words.
 */
const MIN = 60_000;
const NOW = Date.parse('2026-10-02T20:00:00.000Z');
const ago = (minutes: number): number => NOW - minutes * MIN;

interface RoomItem extends AttentionItem {
  readonly room: string;
}

const registry = defineAttention({
  categories: ['ward', 'lab'],
  kinds: [
    attentionKind<RoomItem>({
      id: 'bell',
      category: 'ward',
      budgetMs: 5 * MIN,
    }),
    attentionKind<RoomItem>({
      id: 'sample',
      category: 'lab',
      budgetMs: 10 * MIN,
      permission: 'lab:read',
    }),
  ],
});

const MESSAGES: AttentionMessages = {
  waited: (minutes) => `${minutes} min`,
  button: ({ title, what, waited, others }) =>
    `Next: ${title}, ${what}, ${waited}${others ? `; ${others} more` : ''}`,
  others: (count) => `See ${count} more`,
  othersTitle: 'Also waiting',
  preferences: {
    title: 'Alerts',
    quickLabel: 'Alert settings',
    sound: 'Sound',
    vibration: 'Vibration',
    push: 'Notifications',
    levels: { off: 'Off', late: 'Urgent only', all: 'Everything' },
    vibrationUnavailable: 'This device cannot vibrate from a web page.',
    pushEnable: 'Allow notifications',
    pushUnavailable: 'Not available on this device.',
    testSound: 'Play a test',
    testVibration: 'Vibrate a test',
    position: 'Button position',
    positionMoved: 'You moved the button.',
    positionResting: 'In the corner.',
    resetPosition: 'Back to the corner',
  },
};

const openSheets: string[] = [];

const views = {
  bell: attentionView<RoomItem>({
    icon: <svg data-testid="icon-bell" />,
    describe: (item) => ({ title: `Room ${item.room}`, what: 'Rang the bell' }),
    renderSheet: ({ item, close }) => (
      <div role="dialog" aria-label={`Room ${item.room}`}>
        <button type="button" onClick={close}>
          close
        </button>
      </div>
    ),
  }),
  sample: attentionView<RoomItem>({
    icon: <svg data-testid="icon-sample" />,
    describe: (item) => ({ title: `Room ${item.room}`, what: 'Sample ready' }),
    onOpen: (item) => openSheets.push(item.id),
  }),
};

const bell = (id: string, minutes: number): RoomItem => ({
  id,
  kind: 'bell',
  since: ago(minutes),
  room: id,
});
const sample = (id: string, minutes: number): RoomItem => ({
  id,
  kind: 'sample',
  since: ago(minutes),
  room: id,
});

function renderHost(items: readonly AttentionItem[], can?: (p: string) => boolean) {
  // One key per case, named after it: no counter shared between cases.
  const preferences = createAttentionPreferences({
    storageKey: `attention-test:${expect.getState().currentTestName ?? ''}`,
  });
  const view = render(
    <AttentionHost
      registry={registry}
      views={views}
      items={items}
      now={NOW}
      can={can}
      messages={MESSAGES}
      preferences={preferences}
    />,
  );
  return { ...view, preferences };
}

beforeEach(() => {
  openSheets.length = 0;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the attention button', () => {
  it('draws nothing while nothing waits', () => {
    renderHost([]);
    expect(screen.queryAllByTestId('attention-button')).toHaveLength(0);
  });

  it('names the next thing, its wait, and how many more there are', () => {
    renderHost([bell('12', 2), sample('7', 12)]);
    const button = screen.getByTestId('attention-button');
    // The late lab sample outranks the fresh bell, across categories.
    expect(button.getAttribute('aria-label')).toBe('Next: Room 7, Sample ready, 12 min; 1 more');
    expect(button.getAttribute('data-severity')).toBe('late');
    expect(within(button).getByTestId('icon-sample')).toBeTruthy();
    expect(screen.getByTestId('attention-others').textContent).toContain('+1');
  });

  it('asks harder as the clock runs', () => {
    const { rerender, preferences } = renderHost([bell('1', 1)]);
    expect(screen.getByTestId('attention-button').getAttribute('data-pulse')).toBe('still');
    const at = (minutes: number) => (
      <AttentionHost
        registry={registry}
        views={views}
        items={[bell('1', minutes)]}
        now={NOW}
        messages={MESSAGES}
        preferences={preferences}
      />
    );
    rerender(at(2));
    expect(screen.getByTestId('attention-button').getAttribute('data-pulse')).toBe('soft');
    rerender(at(4));
    expect(screen.getByTestId('attention-button').getAttribute('data-pulse')).toBe('strong');
    rerender(at(11));
    expect(screen.getByTestId('attention-button').getAttribute('data-pulse')).toBe('spent');
  });

  it('hides the kinds the reader may not see', () => {
    renderHost([bell('12', 2), sample('7', 12)], (permission) => permission !== 'lab:read');
    expect(screen.getByTestId('attention-button').getAttribute('aria-label')).toBe(
      'Next: Room 12, Rang the bell, 2 min',
    );
    expect(screen.queryAllByTestId('attention-others')).toHaveLength(0);
  });

  it("opens the kind's own sheet, and closes it", () => {
    renderHost([bell('12', 2)]);
    fireEvent.click(screen.getByTestId('attention-button'));
    const sheet = screen.getByRole('dialog', { name: 'Room 12' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'close' }));
    expect(screen.queryAllByRole('dialog', { name: 'Room 12' })).toHaveLength(0);
  });

  it('hands the tap to the host when the kind opens something of its own', () => {
    renderHost([sample('7', 1)]);
    fireEvent.click(screen.getByTestId('attention-button'));
    expect(openSheets).toEqual(['7']);
  });

  it('lists the others, inked in the worst of them, and opens the one picked', async () => {
    renderHost([sample('7', 25), bell('12', 7), bell('3', 1)]);
    const others = screen.getByTestId('attention-others');
    expect(others.getAttribute('data-severity')).toBe('late');
    fireEvent.click(others);
    const row = await screen.findByTestId('attention-others-12');
    expect(row.textContent).toContain('Room 12');
    fireEvent.click(row);
    expect(screen.getByRole('dialog', { name: 'Room 12' })).toBeTruthy();
  });
});

describe('the device settings', () => {
  it('keeps one store behind every control, and survives a reload', () => {
    const store = createAttentionPreferences({ storageKey: 'attention-settings' });
    render(<AttentionQuickSettings store={store} messages={MESSAGES.preferences} />);
    expect(screen.getByTestId('attention-quick-settings').getAttribute('data-on')).toBe('false');
    act(() => {
      store.write({ sound: 'all' });
    });
    expect(screen.getByTestId('attention-quick-settings').getAttribute('data-on')).toBe('true');
    expect(createAttentionPreferences({ storageKey: 'attention-settings' }).read().sound).toBe('all');
  });

  it('falls back to the defaults when storage holds nonsense', () => {
    window.localStorage.setItem('attention-broken', '{"sound":"loud","dock":{"side":"up"}}');
    expect(createAttentionPreferences({ storageKey: 'attention-broken', defaults: { sound: 'late' } }).read()).toEqual({
      sound: 'late',
      vibration: 'off',
      push: 'off',
      dock: null,
    });
  });
});

describe('news rings and buzzes, as the device allows', () => {
  function vibrating(): ReturnType<typeof vi.fn> {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrate,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    return vibrate;
  }

  it('buzzes long for an item that turned urgent, never for what was there at mount', () => {
    const vibrate = vibrating();
    const store = createAttentionPreferences({ storageKey: 'attention-buzz' });
    store.write({ vibration: 'late' });
    const at = (items: readonly AttentionItem[]) => (
      <AttentionHost
        registry={registry}
        views={views}
        items={items}
        now={NOW}
        messages={MESSAGES}
        preferences={store}
      />
    );
    const { rerender } = render(at([bell('1', 7)]));
    expect(vibrate).not.toHaveBeenCalled();
    // A fresh calm arrival: the device asked for urgent only.
    rerender(at([bell('1', 7), bell('2', 1)]));
    expect(vibrate).not.toHaveBeenCalled();
    // The fresh one turns late.
    rerender(at([bell('1', 7), bell('2', 6)]));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate.mock.calls[0]?.[0]).toEqual([300, 120, 300, 120, 300]);
  });

  it('stays silent with the channel off', () => {
    const vibrate = vibrating();
    const preferences = createAttentionPreferences({
      storageKey: 'attention-quiet',
    });
    const at = (items: readonly AttentionItem[]) => (
      <AttentionHost
        registry={registry}
        views={views}
        items={items}
        now={NOW}
        messages={MESSAGES}
        preferences={preferences}
      />
    );
    const { rerender } = render(at([]));
    rerender(at([bell('1', 9)]));
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('the dock', () => {
  // jsdom has no PointerEvent, and the generic Event it falls back to drops the
  // coordinates. A MouseEvent carries them; that is all the dock reads.
  beforeEach(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventStandIn extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      }
      Object.defineProperty(window, 'PointerEvent', {
        configurable: true,
        value: PointerEventStandIn,
      });
    }
  });

  it('moves on a drag, snaps to the nearer side, remembers it, and does not open on the release', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    const { preferences: store } = renderHost([bell('12', 2)]);
    const dock = screen.getByTestId('attention-dock');
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      left: 320,
      top: 700,
      width: 64,
      height: 64,
      right: 384,
      bottom: 764,
      x: 320,
      y: 700,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(dock, { clientX: 350, clientY: 730, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 60, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(dock, { clientX: 60, clientY: 330, pointerId: 1 });
    fireEvent.click(screen.getByTestId('attention-button'));
    expect(screen.queryAllByRole('dialog', { name: 'Room 12' })).toHaveLength(0);
    expect(store.read().dock?.side).toBe('left');
    expect(screen.getByTestId('attention-dock').getAttribute('data-side')).toBe('left');
    // A plain tap still opens it.
    fireEvent.click(screen.getByTestId('attention-button'));
    expect(screen.getByRole('dialog', { name: 'Room 12' })).toBeTruthy();
  });
});
