import { useCallback, useEffect, useState, type JSX } from 'react';

import { createWebNotifications } from '@12-apps/notifications/react';

import { HARNESS_NOTIFICATION_MESSAGES } from '../notifications/notification-copy';

/**
 * The whole wiring a frontend host performs for @12-apps/notifications (12-15).
 *
 * Everything the notification centre IS — the bell with its live badge, the
 * slide-over inbox with its optimistic mark-read / delete / mark-all and its
 * cursor pager, the preferences matrix with its availability hints — lives inside
 * the package. This file names where the API is mounted, and that is the only
 * part that is genuinely the host's.
 *
 * There is no `transport`, deliberately: the package's default is same-origin
 * `fetch`, Vite proxies `/api` to `harness/backend`, and so every click below
 * crosses a real socket into the package's own Hono router over a real Postgres —
 * the arrangement a real consumer has. The backend's actor seam answers
 * headerless requests as the seeded owner.
 *
 * The three things around the packaged surface are the HOST's own, and are here
 * because they are what a page needs to be drivable:
 *
 *  - `onNavigate` — the host router's navigate, rendered as a line of text so a
 *    spec can assert the deep link the panel chose without a router;
 *  - **Emitir** — the same emit a real host performs from its domain code, so the
 *    badge and the list can be watched arriving rather than seeded;
 *  - the **outbox** — what the vendors actually received. The payments harness's
 *    wire probe, applied to notifications: an assertion becomes a string
 *    comparison against what crossed, instead of a screenshot of a screen.
 */
const notifications = createWebNotifications({
  apiBase: '/api/account',
  // Required now, and stated by THIS host in its own words. It used to be
  // omitted, which meant rendering the package's ~40-sentence pt-BR default —
  // the extraction origin's copy — while claiming to be an independent
  // consumer. See `../notifications/notification-copy`.
  messages: HARNESS_NOTIFICATION_MESSAGES,
});
const { BellButton, Panel, page: PreferencesSurface, store } = notifications;

interface OutboxEntry {
  channel: string;
  destination: string;
  payload: string;
}

/** The host's emit button + the wire probe under it. */
function HostControls({ onNavigated }: { onNavigated: string | null }): JSX.Element {
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await fetch('/__harness/notifications/outbox', {
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json()) as { data: { entries: OutboxEntry[] } };
    setOutbox(payload.data.entries);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const emit = async (): Promise<void> => {
    setBusy(true);
    try {
      await fetch('/__harness/notifications/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'order.paid', payload: { code: 'A-2048' } }),
      });
      // The host's own write knows the inbox moved, so it says so. Without a
      // message bus the badge is otherwise on its 60 s poll — which is the
      // package's standing contract (a dropped event must cost latency, never
      // correctness), and exactly why a host that CAN tell it, does. A host with
      // a bus passes `subscribe` instead and this line goes away.
      store.invalidate();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <button type="button" data-testid="host-emit" disabled={busy} onClick={() => void emit()}>
        Emitir notificação
      </button>{' '}
      <button type="button" data-testid="host-outbox-refresh" onClick={() => void refresh()}>
        Atualizar envios
      </button>
      {onNavigated ? <p data-testid="host-navigated">{onNavigated}</p> : null}
      <ul data-testid="host-outbox">
        {outbox.map((entry, index) => (
          <li key={`${entry.channel}-${index}`} data-testid={`host-outbox-${entry.channel}`}>
            {entry.channel} → {entry.destination}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotificationsCenterPage(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [navigated, setNavigated] = useState<string | null>(null);

  return (
    <div>
      <h2>Sino (pacote)</h2>
      <BellButton onClick={() => setOpen(true)} />
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        onNavigate={(link) => setNavigated(link)}
      />

      <h2>Host</h2>
      <HostControls onNavigated={navigated} />

      <h2>Preferências (pacote)</h2>
      <PreferencesSurface />
    </div>
  );
}
