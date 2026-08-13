import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/realtime` mounted the way a host mounts it (12-16): one call to
 * `createWebEvents({ apiBase })`, plus a two-line worker module — driving the published
 * package's own Hono router through the Vite proxy over a real Postgres.
 *
 * ## What this proves that a unit test cannot
 *
 * The seam BETWEEN the two published halves. The server's SSE frame and the browser's decoder
 * are separate modules with separate test suites, and each one's tests feed it a body it wrote
 * itself — which is exactly where FUT-740's three criticals lived. Here the frame is produced
 * by `@12-apps/realtime/server` in another process, crosses a proxy, and is decoded by
 * `@12-apps/realtime/react` in a real browser. Nothing in the loop is a fixture.
 *
 * ## What it deliberately does NOT do
 *
 * It does not probe the network for "did the app subscribe". Since FUT-660 the connection may
 * live in a SharedWorker, so the ticket request is issued by the worker and neither
 * `page.on("request")` nor `context.on("request")` sees it — a SharedWorker is attached to no
 * page. A probe that passed would only be observing the in-page fallback, i.e. asserting the
 * optimisation is OFF. A Gherkin step doing exactly that went red on future-pay's main and was
 * removed. The claim is covered where it can be: at the route (the backend suites), over the
 * bus (the outbox suite), and here as an end-to-end ROUND TRIP.
 */

/** Publish one hint through the host's stand-in for a domain publisher. */
async function publishHint(
  page: Page,
  body: { tenantId?: string; domain?: string; type?: string },
): Promise<void> {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked publish would move nothing on the real bus
     the page is subscribed to (same rationale as rbac-admin.spec.ts beside this file). */
  const response = await page.request.post('/__harness/realtime/publish', { data: body });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ published: true });
}

async function openLive(page: Page): Promise<void> {
  await page.goto('#/realtime-events');
  // The stream is live before anything is asserted: a hint published into a bus nobody is
  // listening to is lost forever (best-effort delivery, no replay), so a spec that published
  // first would be racing its own subscription.
  await expect(page.getByTestId('kitchen-status')).toHaveText('connected');
}

test.describe('the live stream', () => {
  test('reports itself connected, and only then says "Ao vivo"', async ({ page }) => {
    await openLive(page);
    // A screen that says live must be reading a real status — reporting live while stale is
    // the exact failure FUT-645/646 exist to prevent.
    await expect(page.getByTestId('kitchen-chip')).toHaveText('Ao vivo');
  });

  test('relaxes the poll while connected, and never stops it', async ({ page }) => {
    await openLive(page);
    // Polling is a permanent FLOOR: `reconcileRefetchInterval` slows it, never returns false.
    await expect(page.getByTestId('kitchen-poll')).toHaveText('30000');
  });

  test('a published hint reaches the subscribed screen', async ({ page }) => {
    await openLive(page);
    await expect(page.getByTestId('kitchen-hints')).toHaveText('0');

    await publishHint(page, { tenantId: 'tenant-a', domain: 'kitchen' });

    // THE round trip: published by `@12-apps/realtime/server` in another process, framed by
    // its SSE wire, proxied, decoded by `@12-apps/realtime/react` in this browser, routed to
    // the screen that registered the domain.
    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
  });

  test('two hints arrive as two hints', async ({ page }) => {
    await openLive(page);
    await publishHint(page, { domain: 'kitchen' });
    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
    await publishHint(page, { domain: 'kitchen' });
    await expect(page.getByTestId('kitchen-hints')).toHaveText('2');
  });

  test('routes a hint to ONE screen — the shared connection stays invisible', async ({ page }) => {
    await openLive(page);
    await expect(page.getByTestId('orders-status')).toHaveText('connected');

    await publishHint(page, { domain: 'kitchen' });
    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
    // A kitchen board that invalidated on an orders event would re-read on every table change
    // in the building; the same is true in reverse, and this is that half.
    await expect(page.getByTestId('orders-hints')).toHaveText('0');

    await publishHint(page, { domain: 'orders', type: 'orders.changed' });
    await expect(page.getByTestId('orders-hints')).toHaveText('1');
    // And the kitchen counter did not move again.
    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
  });

  test('never delivers ANOTHER tenant’s hint', async ({ page }) => {
    await openLive(page);
    // The topic is resolved server-side from the path slug, so `tenant-b` is a different
    // channel this connection was never subscribed to.
    await publishHint(page, { tenantId: 'tenant-b', domain: 'kitchen' });
    // Then one that MUST arrive. Asserting the order rather than an absence: waiting for a
    // non-event needs a timer, and the foreign publish went first.
    await publishHint(page, { tenantId: 'tenant-a', domain: 'kitchen' });
    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
  });

  test('serves the user-scoped consumer from the OTHER endpoint', async ({ page }) => {
    await openLive(page);
    // A separate provider, a separate context, a separate connection — because the scope of a
    // subscription is a property of its endpoint.
    await expect(page.getByTestId('bell-status')).toHaveText('connected');
  });

  test('carries the connection on one of the two known hosts', async ({ page }) => {
    await openLive(page);
    // Which one depends on the browser, and both are correct: the SharedWorker is an
    // OPTIMISATION and the in-page channel is fully functional. What must never happen is a
    // third answer — a host that failed to build would render `none` while the status above
    // said connected, which is the arrangement being live by accident.
    await expect(page.getByTestId('events-host')).toHaveText(/^(shared-worker|in-page)$/);
  });
});

test.describe('the durable half', () => {
  test('an outbox event reaches the screen only once a drain publishes it', async ({ page }) => {
    await openLive(page);

    /* eslint-disable-next-line test-flakiness/no-unmocked-network --
       as above: the real backend transaction is the subject. */
    const enqueued = await page.request.post('/__harness/realtime/outbox', {
      data: { domain: 'kitchen' },
    });
    expect(await enqueued.json()).toMatchObject({ pending: 1 });
    // Committed, and NOT yet on the wire: that gap is the whole point of an outbox.
    await expect(page.getByTestId('kitchen-hints')).toHaveText('0');

    /* eslint-disable-next-line test-flakiness/no-unmocked-network -- as above. */
    const drained = await page.request.post('/__harness/realtime/drain', { data: {} });
    expect(await drained.json()).toMatchObject({ published: 1 });

    await expect(page.getByTestId('kitchen-hints')).toHaveText('1');
  });
});
