import { expect } from '@playwright/test';

import { authWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * The three e-mail + password journeys: signing up, getting back in after
 * forgetting, and adding a password to an account that only had a social login.
 *
 * ## What makes these portable
 *
 * Every assertion reads a test id that `@12-apps/auth`'s own screens render —
 * `forgot-password-form`, `reset-submit`, `verify-failed`, `save-password`,
 * `password-security-card[data-mode]`, `auth-failure[data-reason]`. They mean
 * the same thing in every consumer because the same components draw them.
 *
 * Nothing here matches USER-FACING TEXT. The copy belongs to the host — a step
 * asserting "E-mail ou senha incorretos." would run only in a pt-BR app — so
 * refusals are read off `data-reason`, which is a code and identical
 * everywhere.
 *
 * ## Two conventions, both load-bearing
 *
 * **State is seeded, never driven through the UI.** "She already has an account
 * with this password" is set up through {@link AuthWorld.seedUser}; building it
 * by driving the sign-up form would make every later scenario depend on the one
 * under test in the first.
 *
 * **The link is read from what the mailer actually SENT**, through
 * {@link AuthWorld.lastMail}. Seeding a token and navigating to the verify page
 * exercises the consumption while proving nothing about the link a real person
 * receives — and a wrong app URL or a moved path fails only there.
 */

/** Pronoun alternation, so one definition serves every scenario's person. */
const THEY = '(?:she|he|they)';
const THEIR = '(?:her|his|their)';

/** The clickable link inside a message, read out of the plain-text half. */
function linkFrom(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`no link in the message body:\n${text}`);
  return match[0];
}

/**
 * Give an account a password by driving the REAL reset flow.
 *
 * Deliberately not a seeded hash: the format is `@12-apps/auth`'s, and a
 * harness that duplicated it would let the two drift silently — a test seeding
 * a hash the app cannot verify fails in a way that looks like broken sign-in.
 * One extra round trip buys the guarantee that a seeded password is a password
 * the application itself produced.
 */
async function givePassword(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  const world = authWorld();
  const asked = await page.request.post('/api/auth/email/forgot-password', { data: { email } });
  expect(asked.ok(), `asking for a reset link failed: ${await asked.text()}`).toBe(true);
  const message = world.lastMail(email, world.subjects.reset);
  expect(message, `no reset mail reached ${email}`).toBeDefined();
  const token = new URL(linkFrom(message!.text)).searchParams.get('token');
  const reset = await page.request.post('/api/auth/email/reset-password', {
    data: { token, password },
  });
  expect(reset.ok(), `setting the password failed: ${await reset.text()}`).toBe(true);
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('the platform offers e-mail and password sign-in', async ({ page }) => {
  await authWorld().setEmailAuthEnabled(page, true);
});

Given('the platform requires e-mail confirmation', async ({ page }) => {
  await authWorld().setRequireVerification(page, true);
});

Given('the platform does not require e-mail confirmation', async ({ page }) => {
  await authWorld().setRequireVerification(page, false);
});

Given(/^"(.+)" has no account yet$/, async ({ account }, email: string) => {
  // Nothing to seed: the absence IS the state. Naming the address is what lets
  // every later step say "she".
  account.start(email);
});

Given(/^"(.+)" already has an account$/, async ({ page, account }, email: string) => {
  account.start(email);
  await authWorld().seedUser(page, { email, name: 'Existing Account', emailVerified: true });
});

Given(
  /^"(.+)" has an account with the password "(.+)"$/,
  async ({ page, account }, email: string, password: string) => {
    account.start(email, password);
    await authWorld().seedUser(page, { email, name: 'Account With Password', emailVerified: true });
    await givePassword(page, email, password);
  },
);

Given(/^"(.+)" signed up with Google and has no password$/, async ({ page, account }, email: string) => {
  account.start(email);
  // A social provider and a verified address is exactly what a sign-in gate
  // writes for a social sign-up — and no password hash, which is the state the
  // whole journey is about.
  await authWorld().seedUser(page, {
    email,
    name: 'Social Account',
    provider: 'google',
    emailVerified: true,
  });
});

Given(new RegExp(`^${THEY} is already signed in$`), async ({ context, account }) => {
  await authWorld().signInAs(context, account.email);
});

Given(
  new RegExp(`^${THEY} created an account with the password "(.+)"$`),
  async ({ page, account }, password: string) => {
    account.rememberPassword(password);
    const response = await page.request.post('/api/auth/email/signup', {
      data: { email: account.email, password, name: 'New Account' },
    });
    expect(response.ok(), `sign-up failed: ${await response.text()}`).toBe(true);
  },
);

Given(new RegExp(`^${THEY} asked for a link to reset ${THEIR} password$`), async ({ page, account }) => {
  const response = await page.request.post('/api/auth/email/forgot-password', {
    data: { email: account.email },
  });
  expect(response.ok()).toBe(true);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When(
  new RegExp(`^${THEY} creates an account with the password "(.+)"$`),
  async ({ page, account }, password: string) => {
    account.rememberPassword(password);
    await page.goto(authWorld().paths.signup);
    await page.getByTestId('accept-terms').check();
    await page.getByTestId('signup-email').fill(account.email);
    await page.getByTestId('signup-password').fill(password);
    await page.getByTestId('signup-submit').click();
  },
);

When(/^someone tries to create an account with "(.+)"$/, async ({ page, account }, email: string) => {
  account.start(email);
  await page.goto(authWorld().paths.signup);
  await page.getByTestId('accept-terms').check();
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('some other password 21');
  await page.getByTestId('signup-submit').click();
});

When(
  new RegExp(`^${THEY} tries to sign in with "(.+)"$`),
  async ({ page, account }, password: string) => {
    await page.goto(authWorld().paths.login);
    await page.getByTestId('login-email').fill(account.email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
  },
);

When(new RegExp(`^${THEY} opens the confirmation link we sent ${THEIR}$`), async ({ page, account }) => {
  const world = authWorld();
  const message = world.lastMail(account.email, world.subjects.verify);
  expect(message, `no confirmation mail reached ${account.email}`).toBeDefined();
  account.rememberLink(linkFrom(message!.text));
  await page.goto(account.lastLink);
});

When(new RegExp(`^${THEY} opens the reset link we sent ${THEIR}$`), async ({ page, account }) => {
  const world = authWorld();
  const message = world.lastMail(account.email, world.subjects.reset);
  expect(message, `no reset mail reached ${account.email}`).toBeDefined();
  account.rememberLink(linkFrom(message!.text));
  await page.goto(account.lastLink);
});

When(new RegExp(`^${THEY} opens that same link again$`), async ({ page, account }) => {
  await page.goto(account.lastLink);
});

When(
  new RegExp(`^${THEY} chooses "(.+)" as ${THEIR} new password$`),
  async ({ page, account }, password: string) => {
    account.rememberPassword(password);
    await page.getByTestId('reset-password').fill(password);
    await page.getByTestId('reset-password-confirm').fill(password);
    await page.getByTestId('reset-submit').click();
  },
);

When(new RegExp(`^${THEY} asks for a link to reset ${THEIR} password$`), async ({ page, account }) => {
  await page.goto(authWorld().paths.forgotPassword);
  await page.getByTestId('forgot-email').fill(account.email);
  await page.getByTestId('forgot-submit').click();
});

When(/^someone asks for a reset link for "(.+)"$/, async ({ page, account }, email: string) => {
  account.start(email);
  await page.goto(authWorld().paths.forgotPassword);
  await page.getByTestId('forgot-email').fill(email);
  await page.getByTestId('forgot-submit').click();
});

When(new RegExp(`^${THEY} opens ${THEIR} account(?: again)?$`), async ({ page }) => {
  await page.goto(authWorld().paths.account);
  await expect(page.getByTestId('password-security-card')).toBeVisible();
});

When(
  new RegExp(`^${THEY} creates the password "(.+)"$`),
  async ({ page, account }, password: string) => {
    account.rememberPassword(password);
    await page.getByTestId('new-password').fill(password);
    await page.getByTestId('new-password-confirm').fill(password);
    await page.getByTestId('save-password').click();
  },
);

When(
  new RegExp(`^${THEY} tries to change ${THEIR} password to "(.+)" with the wrong current password$`),
  async ({ page }, password: string) => {
    await page.getByTestId('current-password').fill('not the password 00');
    await page.getByTestId('new-password').fill(password);
    await page.getByTestId('new-password-confirm').fill(password);
    await page.getByTestId('save-password').click();
  },
);

When(
  new RegExp(`^${THEY} changes ${THEIR} password to "(.+)" using "(.+)"$`),
  async ({ page, account }, password: string, current: string) => {
    account.rememberPassword(password);
    await page.getByTestId('current-password').fill(current);
    await page.getByTestId('new-password').fill(password);
    await page.getByTestId('new-password-confirm').fill(password);
    await page.getByTestId('save-password').click();
  },
);

When(new RegExp(`^${THEY} signs out$`), async ({ context }) => {
  // Signing out is not what any of these scenarios are about, so the world does
  // it however the host does — driving a menu here would make them fail for a
  // reason belonging to another feature.
  await authWorld().signOut(context);
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then(new RegExp(`^${THEY} is told to check ${THEIR} inbox$`), async ({ page }) => {
  await expect(page.getByTestId('signup-verification-sent')).toBeVisible();
});

Then(new RegExp(`^${THEY} is told to confirm ${THEIR} e-mail first$`), async ({ page }) => {
  await expect(page.getByTestId('auth-failure')).toHaveAttribute(
    'data-reason',
    'email-not-verified',
  );
});

Then(new RegExp(`^${THEY} is told ${THEIR} e-mail is confirmed$`), async ({ page }) => {
  await expect(page.getByTestId('verify-success')).toBeVisible();
});

Then(new RegExp(`^${THEY} is told the link is no longer valid$`), async ({ page }) => {
  // Either screen may answer: the verify page fails closed with its own alert,
  // and the reset page turns the refusal into its "ask for a new link" outcome.
  await expect(page.getByTestId('verify-failed').or(page.getByTestId('request-new-link')).first()).toBeVisible();
});

Then(new RegExp(`^${THEY} is signed in$`), async ({ page }) => {
  // The login screen sends her to the callback URL on success, so LEAVING the
  // sign-in page is the observable outcome.
  await expect(page).not.toHaveURL(new RegExp(`${authWorld().paths.login}(\\?|$)`));
});

Then(new RegExp(`^${THEY} is told ${THEIR} e-mail or password is wrong$`), async ({ page }) => {
  await expect(page.getByTestId('auth-failure')).toHaveAttribute(
    'data-reason',
    'invalid-credentials',
  );
});

Then(new RegExp(`^${THEY} is told ${THEIR} password was changed$`), async ({ page }) => {
  await expect(page.getByTestId('password-saved')).toBeVisible();
});

Then(new RegExp(`^${THEY} is told ${THEIR} password was created$`), async ({ page }) => {
  await expect(page.getByTestId('password-saved')).toBeVisible();
});

Then(new RegExp(`^${THEY} is told ${THEIR} current password is wrong$`), async ({ page }) => {
  // Its OWN code, not `invalid-credentials`: "the password you typed to prove
  // it is you was wrong" and "your sign-in was refused" are different events,
  // and a scenario that conflated them would pass on the wrong one.
  await expect(page.getByTestId('auth-failure')).toHaveAttribute(
    'data-reason',
    'current-password-invalid',
  );
});

Then(new RegExp(`^${THEY} is offered to create a password$`), async ({ page }) => {
  // The MODE the server put the card in, not the host's title copy.
  await expect(page.getByTestId('password-security-card')).toHaveAttribute('data-mode', 'add');
});

Then(new RegExp(`^${THEY} is offered to change ${THEIR} password$`), async ({ page }) => {
  await expect(page.getByTestId('password-security-card')).toHaveAttribute('data-mode', 'change');
});

Then(new RegExp(`^${THEY} is not asked for a current password$`), async ({ page }) => {
  await expect(page.getByTestId('current-password')).toHaveCount(0);
});

Then(new RegExp(`^${THEY} is asked for a current password$`), async ({ page }) => {
  await expect(page.getByTestId('current-password')).toBeVisible();
});

Then('signing in with Google is still offered', async ({ page }) => {
  // Adding a password must not remove the method she already had. Read from the
  // sign-in screen, which renders only the providers the deployment configures
  // — so the scenario must have signed her OUT first: a signed-in visitor is
  // redirected away and never sees a provider button at all.
  await page.goto(authWorld().paths.login);
  await expect(page.getByRole('button', { name: /Google/i })).toBeVisible();
});

Then(new RegExp(`^the message we sent says ${THEY} already has an account$`), async ({ account }) => {
  const world = authWorld();
  const message = world.lastMail(account.email);
  expect(message, `no mail reached ${account.email}`).toBeDefined();
  expect(message!.subject).toContain(world.subjects.alreadyRegistered);
});

Then(/^no message was sent to "(.+)"$/, async ({ account }, email: string) => {
  void account;
  const message = authWorld().lastMail(email);
  expect(message, `${email} should have received nothing`).toBeUndefined();
});
