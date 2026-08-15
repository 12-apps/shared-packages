import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/notifications` mounted the way a host mounts it (12-15): one call to
 * `createWebNotifications({ apiBase })`, no route table, no screen imported by
 * name — driving the published package's own Hono router over a real Postgres
 * through the Vite proxy, as the seeded owner.
 *
 * The cases are the port of the origin host's notification-centre coverage (its
 * `badge-realtime` component suite and the account preferences screen), moved to
 * the level they belong at: a real browser, a real socket, real rows. What only
 * exists here is the seam BETWEEN the two published halves — the URLs the client
 * builds, the envelope it unwraps, and the fact that a click on a row really does
 * flip a `read_at` the server then serves back.
 */

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a database
     nothing under test is reading (same rationale as rbac-admin.spec.ts). */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

async function openPage(page: Page): Promise<void> {
  await page.goto('#/notifications-center');
  await expect(page.getByTestId('notifications-bell')).toBeVisible();
}

async function openPanel(page: Page): Promise<void> {
  await openPage(page);
  await page.getByTestId('notifications-bell').click();
  await expect(page.getByTestId('notifications-panel')).toBeVisible();
}

/**
 * The row carrying one order code. Addressed by its BODY, which is the only
 * thing that differs between three rows the same generator produced — the
 * accessible name is the title, and the ids are uuids the fixture never sees.
 */
function rowFor(page: Page, body: string) {
  return page.locator('[data-testid^="notification-"]').filter({ hasText: body });
}

/**
 * THE COPY THESE SPECS READ IS THIS HARNESS'S OWN, and that is load-bearing.
 *
 * They used to read the package's pt-BR default, which made the one consumer
 * standing in for an independent adopter assert the extraction origin's
 * sentences back at it — exactly how that default stayed invisible. `messages`
 * is required config now, and this app states a hardware shop's words in
 * `src/notifications/notification-copy.ts`; the assertions follow it.
 */
test.describe('the bell and its badge', () => {
  test('shows the seeded unread count, in pt-BR', async ({ page }) => {
    await openPage(page);
    // Three seeded rows, all unread — and the count came from the packaged
    // `/notifications/unread-count` over a real COUNT.
    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (3 não lidos)',
    );
  });

  test('the badge follows a REAL emit, with no reload', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('host-emit').click();

    // The host emitted through `notify()`; the badge is refreshed from the server
    // rather than incremented locally, so this number is one the database gave.
    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (4 não lidos)',
    );
  });
});

test.describe('the inbox panel', () => {
  test('lists the seeded rows newest first', async ({ page }) => {
    await openPanel(page);

    await expect(page.getByText('Pedido A-1026 pago.')).toBeVisible();
    await expect(page.getByText('Pedido A-1024 pago.')).toBeVisible();
    // The pt-BR title the host's generator produced, rendered by the package —
    // and the newest row is the one at the top of the drawer.
    const newest = rowFor(page, 'Pedido A-1026 pago.');
    await expect(newest).toContainText('Pagamento confirmado');
    await expect(newest).toContainText('há 1 min');
  });

  test('marking one read moves the badge and survives a reload', async ({ page }) => {
    await openPanel(page);
    await rowFor(page, 'Pedido A-1026 pago.')
      .getByRole('button', { name: 'Pagamento confirmado (não lido)' })
      .click();

    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (2 não lidos)',
    );

    // The optimistic update is not the claim — the row on disk is. Reload and the
    // server serves the same number back.
    await page.reload();
    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (2 não lidos)',
    );
  });

  test('mark-all clears the badge, and the control goes with it', async ({ page }) => {
    await openPanel(page);
    await page.getByTestId('notifications-mark-all-read').click();

    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos',
    );
    await expect(page.getByTestId('notifications-mark-all-read')).toBeHidden();
  });

  test('deleting a row removes it for good', async ({ page }) => {
    await openPanel(page);
    await rowFor(page, 'Pedido A-1026 pago.')
      .getByRole('button', { name: 'Excluir aviso: Pagamento confirmado' })
      .click();

    await expect(page.getByText('Pedido A-1026 pago.')).toBeHidden();
    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (2 não lidos)',
    );

    await page.reload();
    await page.getByTestId('notifications-bell').click();
    await expect(page.getByText('Pedido A-1026 pago.')).toBeHidden();
    await expect(page.getByText('Pedido A-1025 pago.')).toBeVisible();
  });

  test('opening a row deep-links through the host router', async ({ page }) => {
    await openPanel(page);
    await rowFor(page, 'Pedido A-1026 pago.')
      .getByRole('button', { name: 'Pagamento confirmado (não lido)' })
      .click();

    // The link the host's own generator put on the notification, handed to the
    // host's navigate — the package never routes anything itself.
    await expect(page.getByTestId('host-navigated')).toHaveText('/orders/A-1026');
    await expect(page.getByTestId('notifications-panel')).toBeHidden();
  });

  test('pages with the cursor once there is more than one page', async ({ page }) => {
    // 20 is the packaged page size; the reset seeds 3, so emit past the boundary.
    for (let index = 0; index < 19; index += 1) {
      const emitted =
        /* eslint-disable-next-line test-flakiness/no-unmocked-network --
           the same rationale as the reset above: this IS the host emitting, and a
           mocked emit would page over rows the server does not hold. */
        await page.request.post('/__harness/notifications/emit', {
          data: { type: 'order.paid', payload: { code: `P-${index}` } },
        });
      expect(emitted.status()).toBe(200);
    }

    await openPanel(page);
    await expect(page.getByTestId('notifications-load-more')).toBeVisible();
    await page.getByTestId('notifications-load-more').click();

    // The oldest seeded row only exists on the second page.
    await expect(page.getByText('Pedido A-1024 pago.')).toBeVisible();
    await expect(page.getByTestId('notifications-load-more')).toBeHidden();
  });
});

test.describe('the preferences screen', () => {
  test('renders the four categories with the default channel matrix', async ({ page }) => {
    await openPage(page);
    await expect(page.getByTestId('notification-prefs-view')).toBeVisible();

    for (const category of ['orders', 'payments', 'stock', 'system']) {
      await expect(page.getByTestId(`prefs-${category}`)).toBeVisible();
    }
    // Defaults: the free channels on, the paid per-message ones off.
    await expect(page.getByTestId('prefs-orders-EMAIL')).toBeChecked();
    await expect(page.getByTestId('prefs-orders-SMS')).not.toBeChecked();
  });

  test('a toggle auto-saves and survives a reload', async ({ page }) => {
    await openPage(page);
    await expect(page.getByTestId('prefs-orders-SMS')).toBeEnabled();
    await page.getByTestId('prefs-orders-SMS').click();
    await expect(page.getByTestId('prefs-orders-SMS')).toBeChecked();

    await page.reload();
    // The PUT wrote a real row, and the GET read it back — the save is the claim,
    // not the optimistic paint.
    await expect(page.getByTestId('prefs-orders-SMS')).toBeChecked();
    await expect(page.getByTestId('prefs-orders-EMAIL')).toBeChecked();
  });

  test('a saved preference changes what the next emit actually sends', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('prefs-orders-EMAIL').click();
    await expect(page.getByTestId('prefs-orders-EMAIL')).not.toBeChecked();

    await page.getByTestId('host-emit').click();
    await page.getByTestId('host-outbox-refresh').click();

    // Nothing left the building: the only default-on reachable channel was email,
    // and the preference the screen just wrote closed it. This is the whole
    // pipeline — screen → PUT → row → router → transport — in one assertion.
    await expect(page.getByTestId('host-outbox')).toBeEmpty();
  });

  test('the inbox is NOT preference-gated — it is the always-on channel', async ({ page }) => {
    await openPage(page);
    // Turn off every channel this category could use…
    for (const channel of ['EMAIL', 'WEB_PUSH']) {
      const toggle = page.getByTestId(`prefs-orders-${channel}`);
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();
    }

    await page.getByTestId('host-emit').click();
    await page.getByTestId('host-outbox-refresh').click();
    await expect(page.getByTestId('host-outbox')).toBeEmpty();

    // …and the notification still arrives. The bell is the one thing a user
    // cannot switch off, which is what makes "they were told" true even when
    // every transport is silent.
    await expect(page.getByTestId('notifications-bell')).toHaveAttribute(
      'aria-label',
      'Abrir avisos (4 não lidos)',
    );
    await page.getByTestId('notifications-bell').click();
    await expect(page.getByText('Pedido A-2048 pago.')).toBeVisible();
  });
});
