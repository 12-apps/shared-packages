// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import { createWebNotifications } from '../create-web-notifications';
import type { NotificationsResult, NotificationsTransport } from '../transport';
import type { InboxNotification } from '../../wire';

/**
 * `renderActions` — a host's own controls on an inbox row.
 *
 * Driven through `createWebNotifications`, like the rest of the published
 * surface. The panel is a lazy chunk, so waits cover an import as well.
 */
configure({ asyncUtilTimeout: 5_000 });

const LIST = '/api/account/notifications?limit=20';

interface Written {
  path: string;
  body?: unknown;
}

function inbox(count: number): { items: unknown[]; nextCursor: null } {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      id: `n${index}`,
      type: 'order.paid',
      category: 'orders',
      title: `Pagamento ${index}`,
      body: 'Pedido pago.',
      link: `/orders/${index}`,
      data: {},
      readAt: null,
      createdAt: '2026-08-13T09:00:00.000Z',
    })),
    nextCursor: null,
  };
}

function transport(items: unknown, written: Written[]): NotificationsTransport {
  return {
    get<T>(path: string): Promise<T> {
      if (path === LIST) return Promise.resolve(items as T);
      return Promise.reject(new Error(`no stub for ${path}`));
    },
    send<T>(path: string, _method: string, body?: unknown): Promise<NotificationsResult<T>> {
      written.push({ path, body });
      return Promise.resolve({ ok: true, data: {} as T });
    },
  };
}

function mount(
  renderActions?: (notification: InboxNotification) => ReactNode,
  count = 2,
): { Panel: ReturnType<typeof createWebNotifications>['Panel']; written: Written[] } {
  const written: Written[] = [];
  const { Panel } = createWebNotifications({
    apiBase: '/api/account',
    messages: CLINIC_MESSAGES,
    transport: transport(inbox(count), written),
    ...(renderActions ? { renderActions } : {}),
  });
  return { Panel, written };
}

const link = (index: number): HTMLElement =>
  screen.getByRole('button', { name: `Pagamento ${index} (${CLINIC_MESSAGES.unreadSuffix})` });

afterEach(cleanup);

describe('renderActions', () => {
  it('draws no slot at all without a renderer', async () => {
    const { Panel } = mount();
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    expect(document.querySelectorAll('[data-testid^="notification-actions-"]')).toHaveLength(0);
    // The row is the link and the delete control and nothing else.
    expect(screen.getByTestId('notification-n0').querySelectorAll('button')).toHaveLength(2);
  });

  it('draws no slot for a row whose renderer answers null, undefined or a boolean', async () => {
    const { Panel } = mount(
      (n) => (n.id === 'n0' ? <button type="button">Aceitar</button> : null),
      3,
    );
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    expect(screen.getByTestId('notification-actions-n0')).toBeTruthy();
    expect(screen.queryAllByTestId('notification-actions-n1')).toHaveLength(0);
    expect(screen.queryAllByTestId('notification-actions-n2')).toHaveLength(0);
    expect(screen.getByTestId('notification-n1').querySelectorAll('button')).toHaveLength(2);
  });

  it.each([undefined, false, true])('treats %s as no actions', async (answer) => {
    const { Panel } = mount(() => answer, 1);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notification-n0')).toBeTruthy());
    expect(screen.queryAllByTestId('notification-actions-n0')).toHaveLength(0);
  });

  it('draws the controls beside the link, never inside it', async () => {
    const { Panel } = mount(() => <button type="button">Aceitar</button>, 1);
    render(<Panel open onClose={() => undefined} />);

    const accept = await screen.findByRole('button', { name: 'Aceitar' });
    expect(link(0).contains(accept)).toBe(false);
    expect(accept.closest('[inert], [aria-hidden="true"]') === null).toBe(true);
    expect(screen.getByTestId('notification-n0').contains(accept)).toBe(true);
  });

  it('does not follow the link or mark the row on an action click', async () => {
    const acted: string[] = [];
    const navigated: string[] = [];
    const closed = { count: 0 };
    const { Panel, written } = mount(
      (n) => (
        <button type="button" onClick={() => acted.push(n.id)}>
          Aceitar
        </button>
      ),
      1,
    );
    render(
      <Panel
        open
        onClose={() => {
          closed.count += 1;
        }}
        onNavigate={(to) => navigated.push(to)}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));

    expect(acted).toEqual(['n0']);
    expect(navigated).toEqual([]);
    expect(closed.count).toBe(0);
    expect(written).toEqual([]);
  });

  it('still opens the row and marks it seen from the link', async () => {
    const navigated: string[] = [];
    const { Panel, written } = mount(() => <button type="button">Aceitar</button>, 1);
    render(<Panel open onClose={() => undefined} onNavigate={(to) => navigated.push(to)} />);

    await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(link(0));

    await waitFor(() => expect(navigated).toEqual(['/orders/0']));
    expect(written).toContainEqual({
      path: '/api/account/notifications/mark-read',
      body: { ids: ['n0'] },
    });
  });

  it('puts the actions after the link in tab order', async () => {
    const { Panel } = mount(
      () => (
        <>
          <button type="button">Aceitar</button>
          <button type="button">Recusar</button>
        </>
      ),
      1,
    );
    render(<Panel open onClose={() => undefined} />);
    await screen.findByRole('button', { name: 'Recusar' });

    const row = screen.getByTestId('notification-n0');
    const stops = Array.from(row.querySelectorAll<HTMLElement>('button')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    );
    const at = (label: string): number => stops.findIndex((s) => s?.startsWith(label));
    expect(at('Pagamento 0')).toBe(0);
    expect(at('Aceitar')).toBeGreaterThan(at('Pagamento 0'));
    expect(at('Recusar')).toBeGreaterThan(at('Aceitar'));
  });

  it('leaves the controls tabbable: no inert or hidden ancestor', async () => {
    const { Panel } = mount(() => <button type="button">Aceitar</button>, 1);
    render(<Panel open onClose={() => undefined} />);
    const accept = await screen.findByRole('button', { name: 'Aceitar' });

    for (let el: HTMLElement | null = accept; el; el = el.parentElement) {
      expect(el.hasAttribute('inert')).toBe(false);
      expect(el.getAttribute('aria-hidden')).not.toBe('true');
    }
  });
});
