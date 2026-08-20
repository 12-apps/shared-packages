import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { PGlite } from '@electric-sql/pglite';

import { createApiAuth } from '@12-apps/auth/server';
import { createEmailCredentials, type EmailCredentials } from '@12-apps/auth';
import { emailAuthRouter, emailAuthSettingsRouter } from '@12-apps/auth/hono';
import { createAuthMailer } from '@12-apps/auth/notifications';
import { PT_BR_MESSAGES } from '@12-apps/auth/server';
import type { EmailDriver } from '@12-apps/notifications/server';

import { authSettingsStore, authStore } from './auth-store';
import { HARNESS_SPA_ORIGIN } from './port';

/**
 * `@12-apps/auth`'s e-mail + password surface, mounted the way an adopter
 * mounts it (12-25).
 *
 * Five factories, one host:
 *
 *  - `createEmailCredentials` — the flow, given the four ports;
 *  - `emailAuthRouter` — its eight endpoints, mounted whole;
 *  - `emailAuthSettingsRouter` — the two operator switches, mounted SEPARATELY
 *    and at a path a real host gates for platform staff;
 *  - `createApiAuth` — real Auth.js, with the flow's `authenticate` handed to
 *    its credentials provider, so a password sign-in mints a real session;
 *  - and the packaged React screens, in the SPA.
 *
 * The whole point of doing it here is that nothing on the money path is
 * stubbed. The journeys in `@12-apps/auth/e2e` post to the REAL credentials
 * callback, read the mail this mailer actually rendered, and click the link
 * that was inside it — so a broken `appUrl`, a moved path or a token put in a
 * body instead of a query string fails here rather than in a support ticket.
 *
 * ## What is genuinely the host's, and all that is here
 *
 * Who a caller is, where the screens live, what the refusals say, and how a
 * message is delivered. Everything after that is the package's.
 */

/**
 * Where links point.
 *
 * The SPA's origin, not the API's — a link built against the backend's port
 * reaches a server with no pages on it. This is the same `appUrl` mistake a
 * real deployment makes behind a reverse proxy, and the reason the port is one
 * constant rather than three literals.
 *
 * The three paths are HASH routes because this SPA routes on the hash (see
 * `frontend/src/main.tsx`). `new URL('/#/auth-verify', origin)` puts the token
 * in the query and the route in the fragment — `…/?token=abc#/auth-verify` —
 * which each page reads from `location.search`. A host with real paths passes
 * real paths; the package builds the link either way.
 */
const APP_URL = process.env.HARNESS_APP_URL ?? HARNESS_SPA_ORIGIN;
const VERIFY_PATH = '/#/auth-verify';
const RESET_PATH = '/#/auth-reset-password';
const LOGIN_PATH = '/#/auth-login';

/**
 * The host's OWN session cookie, for the one thing Auth.js cannot do here.
 *
 * Two scenarios open with "she is already signed in" for an account that has
 * never had a password — a social sign-up. This harness configures no OAuth
 * provider (a CI runner has no Google credentials, and a journey that left for
 * one would be testing Google), so there is no handshake available to produce
 * that session.
 *
 * A host cookie is the stand-in, and it is not a shortcut around the subject:
 * `resolveUserId` is explicitly the seam a host fills, the sign-in the
 * scenarios actually ASSERT still goes through the real credentials callback,
 * and this cookie only ever satisfies a precondition. The same harness already
 * does this twice for other packages (`harness-actor`, `harness-consent`).
 */
const HOST_SESSION_COOKIE = 'harness-auth-actor';

/**
 * WHERE a message goes — the vendor seam, and the only half of the mailer this
 * host owns (12-25).
 *
 * `EmailDriver` is `@12-apps/notifications`' own port, so this is a fourth
 * driver beside its `resend` and `log` ones. A real adopter passes
 * `EMAIL_DRIVERS.resend({...})` and writes none of this; the harness keeps the
 * message instead, because the journeys READ what was sent and click the link
 * inside it.
 *
 * The PLAIN-TEXT half is stored. The HTML carries the same URL twice — once on
 * the button, once in the paste-this fallback — so "the first http… in the
 * document" is ambiguous there in a way it never is here.
 */
function recordingDriver(pg: PGlite): EmailDriver {
  return {
    send: async (to, message) => {
      await pg.query('INSERT INTO auth_sent_mail (to_email, subject, body) VALUES ($1, $2, $3)', [
        to,
        message.subject,
        message.text,
      ]);
    },
  };
}

export interface AuthHost {
  credentials: EmailCredentials;
  /** Real Auth.js — `/api/auth/**`, credentials provider included. */
  apiAuth: ReturnType<typeof createApiAuth>;
  /** The eight shopper endpoints, for `/api/auth/email`. */
  emailRouter: Hono;
  /** The two operator switches, for `/api/platform/auth-settings`. */
  settingsRouter: Hono;
  /** The suite's own window: seed an account, read the outbox, take a session. */
  harnessRoutes: Hono;
}

/**
 * Who is calling, for the session-gated routes.
 *
 * The REAL Auth.js session first — the journeys sign in through the credentials
 * callback and then open the account page, and a host that only trusted a
 * header would prove nothing about whether that cookie survived the round trip.
 * The host cookie is the fallback, for the reason on {@link HOST_SESSION_COOKIE}.
 */
function resolveUserId(apiAuth: ReturnType<typeof createApiAuth>, pg: PGlite) {
  const idFor = async (email: string): Promise<string | null> => {
    const { rows } = await pg.query<{ id: string }>('SELECT id FROM auth_users WHERE email = $1', [
      email,
    ]);
    return rows[0]?.id ?? null;
  };

  return async (c: Context): Promise<string | null> => {
    const session = await apiAuth.auth(c.req.raw);
    const signedIn = session?.user?.email ?? getCookie(c, HOST_SESSION_COOKIE);
    return signedIn ? idFor(signedIn) : null;
  };
}

/**
 * The suite's controls, deliberately under `/__harness` and never `/api`:
 * nothing may mistake them for part of the package's surface.
 *
 * There is no "seed a password" here on purpose. The journeys give an account
 * its password by driving the REAL reset flow (see `givePassword` in the
 * packaged steps), so a seeded password is one the application itself produced
 * — a hash written by the harness could drift from the package's format and
 * fail as "sign-in is broken".
 */
function harnessRouter(pg: PGlite): Hono {
  const app = new Hono();

  app.post('/auth/seed-user', async (c) => {
    const body = (await c.req.json()) as {
      email: string;
      name?: string;
      emailVerified?: boolean;
    };
    // Replaced, not upserted: a scenario that says "already has an account"
    // must not inherit a password an earlier scenario left on that address.
    await pg.query('DELETE FROM auth_users WHERE email = $1', [body.email]);
    await pg.query(
      `INSERT INTO auth_users (id, email, name, password_hash, email_verified_at)
            VALUES ($1, $2, $3, NULL, $4)`,
      [
        randomUUID(),
        body.email,
        body.name ?? null,
        // NULL rather than an empty string, and that is the state the whole
        // "add a password to a Google account" journey is about: the card can
        // only offer `add` when the server says there is no hash at all.
        body.emailVerified === false ? null : new Date(),
      ],
    );
    return c.body(null, 204);
  });

  /** Take a session without a password — see {@link HOST_SESSION_COOKIE}. */
  app.post('/auth/sign-in-as', async (c) => {
    const { email } = (await c.req.json()) as { email: string };
    setCookie(c, HOST_SESSION_COOKIE, email, { path: '/', httpOnly: true, sameSite: 'Lax' });
    return c.body(null, 204);
  });

  /** The outbox, newest first, so "the last message" is the first row. */
  app.get('/auth/mail', async (c) => {
    const { rows } = await pg.query<{ subject: string; body: string }>(
      'SELECT subject, body FROM auth_sent_mail WHERE to_email = $1 ORDER BY id DESC',
      [c.req.query('email') ?? ''],
    );
    return c.json({ messages: rows.map((row) => ({ subject: row.subject, text: row.body })) });
  });

  return app;
}

export function authHost(pg: PGlite): AuthHost {
  const settings = authSettingsStore(pg);

  const credentials = createEmailCredentials({
    store: authStore(pg),
    /**
     * The mailer comes from the PACKAGE, not from this host (12-25).
     *
     * `@12-apps/auth/notifications` renders the four messages through
     * `renderAuthMail` and hands each to an `@12-apps/notifications` driver, so
     * the host supplies only the vendor. That is the whole integration: no
     * `sendVerification`, no `sendPasswordReset`, no layout and no escaping
     * written here — the two packages already own a half each, and a host
     * writing them again is copying.
     */
    mailer: createAuthMailer({
      driver: recordingDriver(pg),
      loginUrl: `${APP_URL}${LOGIN_PATH}`,
    }),
    // A RESOLVER, not a fixed object: both switches are flipped mid-scenario by
    // the operator console, and a value captured at construction would take
    // effect on the next restart instead of the next request.
    settings: () => settings.current(),
    appUrl: APP_URL,
    verifyPath: VERIFY_PATH,
    resetPath: RESET_PATH,
    loginPath: LOGIN_PATH,
  });

  const apiAuth = createApiAuth({
    secret: process.env.AUTH_SECRET ?? 'harness-auth-secret-not-a-real-one',
    authUrl: APP_URL,
    basePath: '/api/auth',
    // The SPA reaches this server through Vite's proxy, so the Host header
    // Auth.js sees is the SPA's origin rather than its own. Without this every
    // request is refused as `UntrustedHost` — and the symptom is that
    // `/api/auth/session` 500s while every other route answers, which reads as
    // a broken session. This is the flag a real deployment behind a reverse
    // proxy needs, for the same reason.
    trustHost: true,
    // No OAuth provider — see HOST_SESSION_COOKIE. The sign-in screen still
    // OFFERS Google, because that button is the HOST's and one scenario asserts
    // it survives adding a password.
    providers: [],
    emailPassword: { authenticate: (input) => credentials.authenticate(input) },
    // The gate fails CLOSED with none supplied — every sign-in refused. A
    // harness with no allowlist is the permissive end of that, deliberately.
    signInGate: () => true,
  });

  const userId = resolveUserId(apiAuth, pg);

  return {
    credentials,
    apiAuth,
    emailRouter: emailAuthRouter({ credentials, messages: PT_BR_MESSAGES, resolveUserId: userId }),
    settingsRouter: emailAuthSettingsRouter({ store: settings, resolveUserId: userId }),
    harnessRoutes: harnessRouter(pg),
  };
}
