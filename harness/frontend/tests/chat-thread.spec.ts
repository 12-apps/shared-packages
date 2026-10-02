import { expect, test } from '@playwright/test';

/**
 * `@12-apps/chat` — the thread screen, driven end to end against the routes.
 *
 * The screen is unit-tested inside the package against a stub fetch, and the
 * routes are tested in the backend harness against a real database. Neither
 * puts the two in one process: a composer POSTing one body shape and a handler
 * reading another stay green in their own suites forever. Here every send
 * crosses a real socket — Vite proxies `/api` to `harness/backend`, which
 * serves the packed tarball's own handlers over PGlite — and the thread a
 * second party loads is the row the first party's send wrote.
 */

test.beforeEach(async ({ request }) => {
  // Deletes every thread, so "the other party sees what I sent" is a claim
  // about this run.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject, as in discounts.spec.ts beside this file. */
  await request.post('/__harness/reset');
});

test('the mounted surface renders an empty thread in the host words', async ({ page }) => {
  await page.goto('#/chat-thread');

  await expect(page.getByTestId('page-chat-thread')).toBeVisible();
  await expect(page.getByTestId('chat-thread')).toBeVisible();
  // The package's own en-US pack, passed rather than retyped: copy is
  // REQUIRED config with no defaults, so this title is proof the host gave it.
  await expect(page.getByTestId('chat-empty')).toContainText('No messages yet');
});

test('a message sent by one party reaches the other, labelled by role', async ({ page }) => {
  await page.goto('#/chat-thread');
  await expect(page.getByTestId('chat-empty')).toBeVisible();

  await page.getByTestId('chat-input').fill('Is the visit still on?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-messages')).toContainText('Is the visit still on?');

  // Sign in as the field agent: the thread reloads as somebody else, from the
  // database, and shows the author only by the role label the host chose.
  await page.getByTestId('chat-as-sam').click();
  const messages = page.getByTestId('chat-messages');
  await expect(messages).toContainText('Is the visit still on?');
  await expect(messages).toContainText('Requester');
  // The agent's quick replies are the host's words, offered by the package.
  await expect(page.getByTestId('chat-quick-on-site')).toBeVisible();
});

test('contact info from the blocking role is refused with the server sentence', async ({
  page,
}) => {
  await page.goto('#/chat-thread');
  await page.getByTestId('chat-as-sam').click();
  await expect(page.getByTestId('chat-empty')).toBeVisible();

  await page.getByTestId('chat-input').fill('Call me on 555 123 4567');
  await page.getByTestId('chat-send').click();

  // The refusal's sentence is the BACKEND's copy, carried on the wire as
  // `{ error, message }` and shown as-is — the seam this page exists for.
  await expect(page.getByTestId('chat-send-failed')).toContainText(
    'phone numbers, e-mail addresses, links and social profiles cannot be sent',
  );
  await expect(page.getByTestId('chat-empty')).toBeVisible();
});

test('a party of a finished request reads, and cannot write', async ({ page }) => {
  await page.goto('#/chat-thread');
  await page.getByTestId('chat-request-request-done').click();

  await expect(page.getByTestId('chat-closed')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toHaveCount(0);
});

test('the web host binds the surface and leaves the native one to its own host', async ({
  page,
}) => {
  await page.goto('#/wiring-report');

  await expect(page.getByTestId('wiring-@12-apps/chat-surface')).toHaveAttribute(
    'data-status',
    'bound',
  );
  await expect(page.getByTestId('wiring-@12-apps/chat-surface-native')).toHaveAttribute(
    'data-status',
    'out-of-scope',
  );
  await expect(page.getByTestId('wiring-@12-apps/chat-http')).toHaveAttribute(
    'data-status',
    'out-of-scope',
  );
});
