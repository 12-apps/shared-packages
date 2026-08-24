import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/observability-frontend` from a real browser, reporting to a real
 * endpoint.
 *
 * The package's own suite is jsdom over a mocked SDK, and there are four things
 * it cannot reach — each of which is the whole feature:
 *
 *  - **the transport.** What a suite should assert is the bytes that LEFT, not
 *    an argument to a spy. The backend harness stands up the endpoint a DSN
 *    points at (`observability-host.ts`), so the SDK's real serialisation and
 *    its real POST both run, over Vite's proxy.
 *  - **`beforeSend` deciding NO.** An event that was dropped and an event that
 *    was never produced are indistinguishable from inside the page. Only
 *    somewhere the events land can tell them apart — which is why every noise
 *    case here is asserted against an ingest that received the others.
 *  - **a real uncaught throw.** jsdom dispatches a synthetic `ErrorEvent`; a
 *    browser produces one from an actual uncaught error, which is the only way
 *    to know the listener is on the right target reading the right field.
 *  - **OFF being genuinely off.** The default state is no DSN, no SDK, no
 *    network — and the only proof of "no network" is a server that recorded
 *    nothing.
 */

const PAGE = '#/observability';

interface CapturedEvent {
  level?: string;
  message?: string;
  tags?: Record<string, string>;
  exception?: { values?: { value?: string }[] };
  contexts?: Record<string, Record<string, unknown>>;
  request?: { url?: string };
}

/* eslint-disable test-flakiness/no-unmocked-network -- driving the real backend
   is the point of this harness: these are the suite's own controls on the server
   the browser reports to, and mocking them would leave nothing under test. */

async function reset(page: Page): Promise<void> {
  expect((await page.request.post('/__harness/reset')).ok()).toBe(true);
}

/** Serve a DSN pointing at THIS origin, so the SDK's transport reaches us. */
async function reportTo(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/__harness/observability/config', {
    // A DSN is a URL: `<protocol>://<publicKey>@<host>/<projectId>`, and the SDK
    // derives `<host>/api/<projectId>/envelope/` from it. Pointing it at the
    // page's own origin is what puts our ingest at the far end of a real send.
    data: { dsn: `${origin.replace('://', '://harnesskey@')}/1`, release: 'harness@1.0.0' },
  });
  expect(response.ok()).toBe(true);
}

async function events(page: Page): Promise<CapturedEvent[]> {
  const response = await page.request.get('/__harness/observability/events');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: CapturedEvent[] }).data;
}

/* eslint-enable test-flakiness/no-unmocked-network */

/** Everything the ingest holds, once at least one event has landed. */
async function settled(page: Page): Promise<CapturedEvent[]> {
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(0);
  return events(page);
}

function texts(seen: CapturedEvent[]): string {
  return JSON.stringify(seen);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await reset(page);
});

test('sends nothing at all until a DSN is served', async ({ page }) => {
  // The package's own contract, and the state dev, CI and every un-opted-in
  // deployment sit in. `reload` because `startObservability` runs once per
  // document load — the config it read is the one served at boot.
  await page.reload();
  await page.getByTestId('obs-throw-uncaught').click();
  await page.getByTestId('obs-boundary').click();

  await expect(page.getByTestId('obs-last-action')).toHaveText('boundary');
  // Nothing left the browser. A server that recorded nothing is the only thing
  // that can say so — a flag on the page would be the page marking its own work.
  expect(await events(page)).toEqual([]);
});

test('a served DSN turns the real SDK on and a crash reaches the ingest', async ({ page }) => {
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-boundary').click();

  const seen = await settled(page);
  expect(texts(seen)).toContain('harness boundary boom');
  // The tag `reportRouteCrash` sets, which is what tells the noise filter a
  // chunk failure arriving at a boundary has already survived the loader's
  // silent retry and is therefore real.
  expect(seen.some((event) => event.tags?.['error.source'] === 'route-boundary')).toBe(true);
  // The component trace, which a stack alone does not carry and which is
  // usually the only thing that names the page.
  expect(texts(seen)).toContain('HarnessPage');
});

test('catches what escapes React, and a promise nobody caught', async ({ page }) => {
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-throw-uncaught').click();
  await page.getByTestId('obs-reject').click();

  await expect
    .poll(async () => texts(await events(page)))
    .toContain('harness uncaught boom');
  // The second funnel: a rejected promise is how a failed request arrives when
  // no caller handles it, and it fires no `window.onerror` at all.
  await expect.poll(async () => texts(await events(page))).toContain('harness rejected boom');
});

test('a handled failure is reported as a warning, not as a crash', async ({ page }) => {
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-warning').click();

  const seen = await settled(page);
  const warning = seen.find((event) => event.message?.includes('contact save failed'));
  // `warning`, not `error`: it is real, but conflating a handled failure with a
  // crash makes the error list useless for triage.
  expect(warning?.level).toBe('warning');
});

test('drops the browser noise that is never our bug', async ({ page }) => {
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-noise-resize').click();
  // A second, REPORTABLE error after it. Without one, "the ingest is empty"
  // would also be satisfied by an SDK that never started — so this case would
  // pass for the wrong reason.
  await page.getByTestId('obs-boundary').click();

  const seen = await settled(page);
  expect(texts(seen)).toContain('harness boundary boom');
  expect(texts(seen)).not.toContain('ResizeObserver');
});

test('drops a dead chunk from a global handler, and a clean 4xx', async ({ page }) => {
  // Both come from the HOST's classifiers, which the package refuses to guess
  // at: what counts as a routine non-5xx answer depends on this app's HTTP
  // client, and what a dead chunk looks like depends on its lazy-route
  // strategy. `main.tsx` spells both in this app's own terms.
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-stale-chunk').click();
  await page.getByTestId('obs-ignorable').click();
  await page.getByTestId('obs-boundary').click();

  const seen = await settled(page);
  expect(texts(seen)).toContain('harness boundary boom');
  expect(texts(seen)).not.toContain('dynamically imported module');
  expect(texts(seen)).not.toContain('EMPTY_CART');
});

test('says which store, without saying who', async ({ page }) => {
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-set-context').click();
  await page.getByTestId('obs-boundary').click();

  const seen = await settled(page);
  const tagged = seen.find((event) => event.tags?.['tenant'] !== undefined);
  // The tenant is what separates "this page is broken" from "this page is
  // broken for one store's data" — the difference between fixing code and
  // fixing a row.
  expect(tagged?.tags?.['tenant']).toBe('ferragens-norte');
  expect(tagged?.tags?.['role']).toBe('OWNER');
});

test('a second component writing context does not erase the first', async ({ page }) => {
  // THE reason `impersonatedStore` is a separate key from `tenant`. Two
  // independent components set this — a layout knows the tenant, the shared
  // impersonation banner knows the impersonation — and if both wrote `tenant`
  // the later effect would silently overwrite the earlier one, in an order
  // neither controls.
  await reportTo(page);
  await page.reload();

  await page.getByTestId('obs-set-context').click();
  await page.getByTestId('obs-set-impersonation').click();
  await page.getByTestId('obs-boundary').click();

  const seen = await settled(page);
  const tagged = seen.find((event) => event.tags?.['tenant'] !== undefined);
  expect(tagged?.tags?.['tenant']).toBe('ferragens-norte');
  expect(tagged?.tags?.['impersonated_store']).toBe('padaria-sul');
  expect(tagged?.tags?.['impersonating']).toBe('true');
});
