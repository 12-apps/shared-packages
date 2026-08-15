// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import { createWebNotifications } from '../create-web-notifications';
import type { NotificationsResult, NotificationsTransport } from '../transport';

/**
 * The published FRONTEND surface, driven through `createWebNotifications` —
 * the only thing a host calls.
 *
 * The TRANSPORT is substituted rather than `globalThis.fetch`, which is what
 * that seam exists for: the assertions are about the screens and the shared
 * store, and every URL the packaged client builds is asserted directly.
 */

/** Fixed: nothing here asserts a relative timestamp, only the row's identity. */
const SEEDED_AT = '2026-08-13T09:00:00.000Z';

interface Recorded {
  reads: string[];
  writes: { path: string; method: string; body?: unknown }[];
}

function inboxPage(
  count: number,
  offset = 0,
  nextCursor: string | null = null,
): { items: unknown[]; nextCursor: string | null } {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      id: `n${offset + index}`,
      type: 'order.paid',
      category: 'orders',
      title: `Pagamento ${offset + index}`,
      body: 'Pedido pago.',
      link: `/orders/${offset + index}`,
      data: {},
      readAt: null,
      createdAt: SEEDED_AT,
    })),
    nextCursor,
  };
}

/**
 * THE HOST'S OWN taxonomy, not the extraction origin's four.
 *
 * `categories` became required config one release ago and their LABELS became
 * required in this one — which is the pairing that was missing, because a host
 * could declare its own two and still be handed a labels map describing
 * somebody else's four. These are `CLINIC_MESSAGES.categoryLabels`' keys, so
 * the screen below proves both halves come from the same host.
 */
const PREFERENCES = {
  preferences: {
    consultas: { EMAIL: true, SMS: false, WHATSAPP: false, WEB_PUSH: true },
    vacinas: { EMAIL: true, SMS: false, WHATSAPP: false, WEB_PUSH: true },
  },
  availability: { EMAIL: true, SMS: false, WHATSAPP: false, WEB_PUSH: false },
  categories: ['consultas', 'vacinas'],
};

function fakeTransport(
  responses: Record<string, unknown>,
  recorded: Recorded,
  /**
   * How writes answer. `ok` by default; the other two are what the honesty claim
   * is ABOUT — an optimistic edit is only honest if a rejected or failed write
   * puts the server's answer back on screen, and with an always-`ok` transport an
   * implementation that swallowed the failure would pass every case here.
   */
  writes: 'ok' | 'denied' | 'throws' = 'ok',
): NotificationsTransport {
  return {
    get<T>(path: string): Promise<T> {
      recorded.reads.push(path);
      const match = Object.keys(responses).find((key) => path === key);
      if (!match) return Promise.reject(new Error(`no stub for ${path}`));
      return Promise.resolve(responses[match] as T);
    },
    send<T>(path: string, method: string, body?: unknown): Promise<NotificationsResult<T>> {
      recorded.writes.push({ path, method, body });
      if (writes === 'throws') return Promise.reject(new Error('network down'));
      if (writes === 'denied') return Promise.resolve({ ok: false, error: 'Não foi possível.' });
      return Promise.resolve({ ok: true, data: (responses[path] ?? {}) as T });
    },
  };
}

const bellLabel = (): string | null =>
  screen.getByTestId('notifications-bell').getAttribute('aria-label');

let recorded: Recorded;

beforeEach(() => {
  recorded = { reads: [], writes: [] };
});

afterEach(cleanup);

describe('the bell and the badge', () => {
  it('renders the unread count in the pt-BR accessible name', async () => {
    const { BellButton } = createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      transport: fakeTransport(
        { '/api/account/notifications/unread-count': { count: 3 } },
        recorded,
      ),
    });
    render(<BellButton onClick={() => undefined} />);

    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(3)));
  });

  it('refetches on a hint from the host bus, and unsubscribes on unmount', async () => {
    // The realtime seam. The hint carries NO count — it says only "ask again" —
    // so the number on screen is always one the server just gave us, which is
    // what keeps a dropped event a latency cost rather than a correctness one.
    const bus = { counts: 1, hint: (): void => undefined, unsubscribed: 0 };
    const { BellButton } = createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      transport: {
        get: <T,>(path: string): Promise<T> => {
          recorded.reads.push(path);
          return Promise.resolve({ count: bus.counts } as T);
        },
        send: <T,>(): Promise<NotificationsResult<T>> =>
          Promise.resolve({ ok: true, data: undefined as T }),
      },
      subscribe: (onHint) => {
        bus.hint = onHint;
        return () => {
          bus.unsubscribed += 1;
        };
      },
    });
    const view = render(<BellButton onClick={() => undefined} />);

    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(1)));
    bus.counts = 7;
    bus.hint();
    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(7)));

    view.unmount();
    expect(bus.unsubscribed).toBe(1);
  });

  it('asks for nothing at all while disabled (a signed-out header)', async () => {
    const { BellButton } = createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      transport: fakeTransport(
        { '/api/account/notifications/unread-count': { count: 3 } },
        recorded,
      ),
    });
    render(<BellButton enabled={false} onClick={() => undefined} />);

    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBell));
    expect(recorded.reads).toEqual([]);
  });
});

describe('the inbox panel', () => {
  function mount(pages: Record<string, unknown>): ReturnType<typeof createWebNotifications> {
    return createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      transport: fakeTransport(
        { '/api/account/notifications/unread-count': { count: 2 }, ...pages },
        recorded,
      ),
    });
  }

  it('lists the newest page, read through the packaged URL', async () => {
    const { Panel } = mount({ '/api/account/notifications?limit=20': inboxPage(2) });
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    expect(recorded.reads).toContain('/api/account/notifications?limit=20');
  });

  it('shows the pt-BR empty state when there is nothing', async () => {
    const { Panel } = mount({ '/api/account/notifications?limit=20': inboxPage(0) });
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByTestId('notifications-empty').textContent).toContain(
        CLINIC_MESSAGES.emptyTitle,
      ),
    );
  });

  it('shows the error state with a retry when the read fails', async () => {
    const { Panel } = mount({});
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByTestId('notifications-error').textContent).toContain(
        CLINIC_MESSAGES.loadFailedTitle,
      ),
    );
  });

  it('marks a row read optimistically and moves the badge in the same tick', async () => {
    const { Panel, BellButton } = mount({
      '/api/account/notifications?limit=20': inboxPage(2),
    });
    render(
      <>
        <BellButton onClick={() => undefined} />
        <Panel open onClose={() => undefined} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(2)));

    fireEvent.click(screen.getByRole('button', { name: `Pagamento 0 (${CLINIC_MESSAGES.unreadSuffix})` }));

    // The bell and the panel share ONE store, which is what makes this true.
    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(1)));
    expect(recorded.writes).toContainEqual({
      path: '/api/account/notifications/mark-read',
      method: 'POST',
      body: { ids: ['n0'] },
    });
  });

  it('marks all read and drops the badge to zero', async () => {
    const { Panel, BellButton } = mount({
      '/api/account/notifications?limit=20': inboxPage(2),
    });
    render(
      <>
        <BellButton onClick={() => undefined} />
        <Panel open onClose={() => undefined} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('notifications-mark-all-read')).toBeTruthy());
    fireEvent.click(screen.getByTestId('notifications-mark-all-read'));

    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBell));
    expect(recorded.writes).toContainEqual({
      path: '/api/account/notifications/mark-read',
      method: 'POST',
      body: { all: true },
    });
  });

  it('soft-deletes a row and takes its unread place in the count with it', async () => {
    const { Panel, BellButton } = mount({
      '/api/account/notifications?limit=20': inboxPage(2),
    });
    render(
      <>
        <BellButton onClick={() => undefined} />
        <Panel open onClose={() => undefined} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('notification-delete-n0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('notification-delete-n0'));

    await waitFor(() => expect(screen.queryByTestId('notification-n0')).toBeNull());
    await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(1)));
    expect(recorded.writes).toContainEqual({
      path: '/api/account/notifications/delete',
      method: 'POST',
      body: { ids: ['n0'] },
    });
  });

  it('pages with the cursor the server handed back', async () => {
    const { Panel } = mount({
      '/api/account/notifications?limit=20': inboxPage(1, 0, 'c1'),
      '/api/account/notifications?limit=20&cursor=c1': inboxPage(1, 20),
    });
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notifications-load-more')).toBeTruthy());
    fireEvent.click(screen.getByTestId('notifications-load-more'));

    await waitFor(() => expect(screen.getByTestId('notification-n20')).toBeTruthy());
    expect(recorded.reads).toContain('/api/account/notifications?limit=20&cursor=c1');
  });

  it('deep-links through the host router and closes the panel', async () => {
    const navigated: string[] = [];
    const closed = { count: 0 };
    const { Panel } = mount({ '/api/account/notifications?limit=20': inboxPage(1) });
    render(
      <Panel
        open
        onClose={() => {
          closed.count += 1;
        }}
        onNavigate={(link) => navigated.push(link)}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Pagamento 0 (${CLINIC_MESSAGES.unreadSuffix})` }));

    await waitFor(() => expect(navigated).toEqual(['/orders/0']));
    expect(closed.count).toBe(1);
  });

  describe('optimistic edits are honest about a write that did not land', () => {
    /** Same stubs, but every write fails — one by denial, one by rejection. */
    function mountFailing(
      writes: 'denied' | 'throws',
    ): ReturnType<typeof createWebNotifications> {
      return createWebNotifications({
        apiBase: '/api/account',
        messages: CLINIC_MESSAGES,
        transport: fakeTransport(
          {
            '/api/account/notifications/unread-count': { count: 2 },
            '/api/account/notifications?limit=20': inboxPage(2),
          },
          recorded,
          writes,
        ),
      });
    }

    it.each(['denied', 'throws'] as const)(
      'REFETCHES the server truth when a mark-read comes back %s',
      async (writes) => {
        // The claim under test is invalidate-on-error, and with an always-`ok`
        // transport an implementation that swallowed the failure and left the row
        // showing "read" would pass every other case in this file. The refetch —
        // not a local rollback — is what makes the screen stop asserting
        // something the database does not say.
        const { Panel, BellButton } = mountFailing(writes);
        render(
          <>
            <BellButton onClick={() => undefined} />
            <Panel open onClose={() => undefined} />
          </>,
        );
        await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
        await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(2)));
        const readsBefore = recorded.reads.length;

        fireEvent.click(screen.getByRole('button', { name: `Pagamento 0 (${CLINIC_MESSAGES.unreadSuffix})` }));

        // The badge went back to the server's 2, and the row is unread again —
        // both because page one was reloaded, not because a local undo guessed.
        await waitFor(() => expect(recorded.reads.length).toBeGreaterThan(readsBefore));
        await waitFor(() => expect(bellLabel()).toBe(CLINIC_MESSAGES.openBellWithUnread(2)));
        await waitFor(() =>
          expect(screen.getByRole('button', { name: `Pagamento 0 (${CLINIC_MESSAGES.unreadSuffix})` })).toBeTruthy(),
        );
      },
    );

    it('brings a deleted row BACK when the delete did not land', async () => {
      const { Panel } = mountFailing('denied');
      render(<Panel open onClose={() => undefined} />);
      await waitFor(() => expect(screen.getByTestId('notification-delete-n0')).toBeTruthy());

      fireEvent.click(screen.getByTestId('notification-delete-n0'));

      await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    });
  });

  it('reads NOTHING while closed, and reads on open', async () => {
    const { Panel } = mount({ '/api/account/notifications?limit=20': inboxPage(1) });
    const { rerender } = render(<Panel open={false} onClose={() => undefined} />);

    // The gate is `open`, not "the list never loads": the same stub is read the
    // moment the panel opens, which is what makes the empty array above mean
    // something.
    await waitFor(() => expect(recorded.reads).toEqual([]));
    rerender(<Panel open onClose={() => undefined} />);
    await waitFor(() =>
      expect(recorded.reads).toEqual(['/api/account/notifications?limit=20']),
    );
  });
});

describe('the preferences screen', () => {
  function mount(): ReturnType<typeof createWebNotifications> {
    return createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      transport: fakeTransport(
        {
          '/api/account/notification-preferences': PREFERENCES,
          '/api/account/push-subscriptions': { vapidPublicKey: null, count: 0 },
        },
        recorded,
      ),
    });
  }

  it('renders the HOST taxonomy AND the host labels, not a hardcoded four', async () => {
    const { page: PreferencesPage } = mount();
    render(<PreferencesPage />);

    await waitFor(() => expect(screen.getByTestId('prefs-consultas')).toBeTruthy());
    expect(screen.getByTestId('prefs-vacinas')).toBeTruthy();
    // The origin's categories are absent, which is the property under test: a
    // package that still knew them would render them here.
    await waitFor(() => expect(screen.queryByTestId('prefs-orders')).toBeNull());
    expect(screen.getByTestId('prefs-consultas').textContent).toContain(
      CLINIC_MESSAGES.categoryLabels['consultas']?.title,
    );
  });

  it('disables an unreachable channel and says why, in pt-BR', async () => {
    const { page: PreferencesPage } = mount();
    render(<PreferencesPage />);

    await waitFor(() => expect(screen.getByTestId('prefs-consultas-SMS')).toBeTruthy());
    expect((screen.getByTestId('prefs-consultas-SMS') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('prefs-consultas-EMAIL') as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(screen.getByTestId('prefs-hint-SMS').textContent).toContain(
      CLINIC_MESSAGES.channelUnavailableHints['SMS'],
    );
  });

  it('auto-saves one toggle as a single-key PUT', async () => {
    const { page: PreferencesPage } = mount();
    render(<PreferencesPage />);

    await waitFor(() => expect(screen.getByTestId('prefs-consultas-EMAIL')).toBeTruthy());
    fireEvent.click(screen.getByTestId('prefs-consultas-EMAIL'));

    await waitFor(() =>
      expect(recorded.writes).toContainEqual({
        path: '/api/account/notification-preferences',
        method: 'PUT',
        // One category, one channel: the whole reason the server MERGES a save
        // rather than replacing the row.
        body: { consultas: { EMAIL: false } },
      }),
    );
  });

  it('hides the browser push step when the platform cannot send at all', async () => {
    const { page: PreferencesPage } = mount();
    render(<PreferencesPage />);
    await waitFor(() => expect(screen.getByTestId('prefs-consultas')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('web-push-device-setup')).toBeNull());
  });
});

/**
 * THE SECOND DOOR onto the same wiring (FUT-859).
 *
 * `subscribe` is read at FACTORY time, which is module scope. A host whose
 * realtime connection lives in React context — a provider in the tree plus a
 * `useTopics` hook, which is the common shape — cannot reach it from there, so
 * it had no way to wire the badge at all and the bell simply never heard an
 * event.
 *
 * `useSignal` is that host's door, and it is the shape `@12-apps/app-shell`
 * already uses for the identical problem in its consent dialog. Two packages
 * solving one problem two ways is how an adopter concludes the feature is not
 * available to it.
 */
describe('the realtime hint, wired as a hook', () => {
  it('refetches the badge when a host HOOK signals, not just a factory callback', async () => {
    const hints: (() => void)[] = [];
    const { BellButton } = createWebNotifications({
      apiBase: '/api/account',
      messages: CLINIC_MESSAGES,
      // Called during render, so a real host may read context here — which is
      // the entire point of this door existing beside `subscribe`.
      useSignal: (onHint) => {
        hints.push(onHint);
      },
      transport: fakeTransport(
        { '/api/account/notifications/unread-count': { count: 1 } },
        recorded,
      ),
    });

    render(<BellButton onClick={() => undefined} />);
    // Waits for the first badge read to land, so the count below is a REFETCH
    // rather than the mount's own fetch arriving late.
    await waitFor(() => expect(recorded.reads.length).toBeGreaterThan(0));

    const readsBefore = recorded.reads.length;
    act(() => {
      hints.at(-1)?.();
    });
    await waitFor(() => expect(recorded.reads.length).toBeGreaterThan(readsBefore));
  });
});
