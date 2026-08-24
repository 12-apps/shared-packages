import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { PGlite } from '@electric-sql/pglite';

import { createApiAuth } from '@12-apps/auth/server';
import type { EmailCredentials, EmailCredentialsMailer } from '@12-apps/auth';
import { createEmailCredentials } from '@12-apps/auth/server';
import { authManifest, authPlatformManifest } from '@12-apps/auth/manifest';
import {
  authPlatformServerManifest,
  authServerManifest,
} from '@12-apps/auth/manifest/server';
import { PT_BR_MAIL } from '@12-apps/auth/server';
import { PT_BR_MESSAGES } from '@12-apps/auth/server';
import type { EmailDriver } from '@12-apps/notifications/server';

import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import { authSettingsStore, authStore } from './auth-store';
import { HARNESS_SPA_ORIGIN } from './port';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

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

/** Where the two mounts hang — the adoption's claims. */
export const AUTH_MOUNT_PATH = '/api/auth/email';
export const AUTH_PLATFORM_MOUNT_PATH = '/api/platform/auth-settings';

/** The secret this host actually runs on — see the `env` answer below. */
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'harness-auth-secret-not-a-real-one';

export interface AuthHost {
  credentials: EmailCredentials;
  report: WiringReport;
  routes: readonly MountedRoute[];
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

/**
 * The two surfaces, adopted through `@12-apps/wiring/consumer`.
 *
 * TWO manifests, and the package argues the split in its own words: an `http`
 * capability binds ONE mount path, and the sign-in surface (anybody) and the
 * platform switches (a superadmin, behind the host's own gate) differ in
 * audience, in mount path and in the gate in front of them. Folding them into
 * one would mean the aggregate could not express that difference — and these
 * are the two endpoints that can turn a sign-in method off for everybody.
 *
 * Three things this adoption moves out of this file:
 *
 * - **`resolveUserId` is gone from both configs.** The package's own docblock
 *   calls this inversion the point: `resolveUserId` returned `string | null`,
 *   so `null` became 401 for every refusal and a host whose gate has a second
 *   one (signed in, but not permitted — a 403) had nowhere to put it. Under the
 *   contract the host answers before the route runs and `actor` arrives already
 *   proven. The bridge resolves it exactly once, here.
 * - **The mailer comes from the BINDER.** `ports.email` is this host's one
 *   delivery port, and `email.createMailer` turns it into the package's four
 *   semantic sends — so the host supplies a vendor and nothing else. It is
 *   late-bound below for an ordering reason, not a design one.
 * - **The `e2e` world is declined in writing**, and the web harness binds it.
 *   The manifest says why the declaration exists at all: "the first host
 *   adoption re-derived the whole mail-sink world by hand without discovering
 *   `./e2e` existed."
 */
export function authHost(pg: PGlite): AuthHost {
  const settings = authSettingsStore(pg);
  // The mailer belongs to the ADOPTION and the http config is written before
  // it exists — `createEmailCredentials` needs one at construction. So the
  // credentials hold a forwarder and the real mailer lands in it a few lines
  // later. Building a second one with `createAuthMailer` would work and is the
  // wrong answer: it is the binder's job to compose the host's port with the
  // package's own sentences, and two mailers is two answers to "which words".
  const mail: { current: EmailCredentialsMailer | null } = { current: null };
  const mailer = forwardingMailer(mail);

  const credentials = createEmailCredentials({
    store: authStore(pg),
    mailer,
    // A RESOLVER, not a fixed object: both switches are flipped mid-scenario by
    // the operator console, and a value captured at construction would take
    // effect on the next restart instead of the next request.
    settings: () => settings.current(),
    appUrl: APP_URL,
    verifyPath: VERIFY_PATH,
    resetPath: RESET_PATH,
    loginPath: LOGIN_PATH,
  });

  const apiAuth = authJsFor(credentials);
  const userId = resolveUserId(apiAuth, pg);
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: {
      loggerFor: harnessLoggerFor,
      // The vendor seam, and the ONLY half of the mailer this host owns.
      email: recordingDriver(pg),
    },
  });

  const adopted = host.adoptServer({
    manifest: authManifest,
    // The pack and the login URL are choices no port can carry — which words
    // the four mails use, and where the "your password changed" notice points.
    server: authServerManifest({ pack: PT_BR_MAIL, loginUrl: `${APP_URL}${LOGIN_PATH}` }),
    e2e: { declined: 'the journeys drive screens — the web harness answers for the world' },
    // The environment this host ACTUALLY runs on, its own default included.
    // `AUTH_SECRET` is declared `required`, and handing over a bare
    // `process.env` would report it unset and refuse to assemble — while the
    // server it describes would have started perfectly on the fallback above.
    // An env answer that disagrees with the running process is worse than none.
    env: { ...process.env, AUTH_SECRET },
    bindings: {
      http: {
        mountPath: AUTH_MOUNT_PATH,
        config: { credentials, messages: PT_BR_MESSAGES },
      },
      email: {},
    },
  });
  mail.current = adopted.mailer as EmailCredentialsMailer;

  host.adoptServer({
    manifest: authPlatformManifest,
    server: authPlatformServerManifest,
    bindings: {
      http: { mountPath: AUTH_PLATFORM_MOUNT_PATH, config: { store: settings } },
    },
  });

  const wired = host.assemble();
  const routesOf = (name: string) => wired.routes.filter((route) => route.packageName === name);

  return {
    credentials,
    apiAuth,
    report: wired.report,
    routes: wired.routes,
    emailRouter: honoRouterFor(routesOf(authManifest.name), userId),
    settingsRouter: honoRouterFor(routesOf(authPlatformManifest.name), userId),
    harnessRoutes: harnessRouter(pg),
  };
}

/**
 * A mailer that forwards to the one the binder built.
 *
 * Not a stub: every call lands on the package's own composition of this host's
 * driver, and a send before the adoption completed is a wiring bug this throws
 * on rather than swallows.
 */
function forwardingMailer(mail: { current: EmailCredentialsMailer | null }): EmailCredentialsMailer {
  const bound = (): EmailCredentialsMailer => {
    if (!mail.current) throw new Error('the auth mailer is not bound yet');
    return mail.current;
  };
  return {
    sendVerification: (message) => bound().sendVerification(message),
    sendPasswordReset: (message) => bound().sendPasswordReset(message),
    sendAccountExists: (message) => bound().sendAccountExists(message),
    sendPasswordChanged: (message) => bound().sendPasswordChanged?.(message) ?? Promise.resolve(),
    canDeliver: () => bound().canDeliver?.() ?? true,
  };
}

/**
 * Real Auth.js, with the flow's `authenticate` handed to its credentials
 * provider — so a password sign-in mints a real session rather than a fixture.
 *
 * Extracted from the binder below because none of it is wiring: it is this
 * host's session layer, which `@12-apps/auth`'s http capability neither
 * provides nor knows about.
 */
function authJsFor(credentials: EmailCredentials): ReturnType<typeof createApiAuth> {
  return createApiAuth({
    secret: AUTH_SECRET,
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
}
