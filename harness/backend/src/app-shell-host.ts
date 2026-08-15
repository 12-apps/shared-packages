/**
 * Everything `@12-apps/app-shell/server` needs from a HOST, in one object (12-18).
 *
 * What is genuinely the host's, and all that is here: who is calling, whether that
 * caller has accepted the deployment's current terms, how an acceptance is recorded,
 * and how the signed handoff cookie is minted. Everything after that — the two
 * paths, the `{ data }` envelope, the 204, the 500 over a failed write, the cookie's
 * flags — is the package's, which is the claim under test.
 *
 * ## Why there is no table here, and no migration
 *
 * `@12-apps/app-shell` owns NO Prisma model, deliberately: "has this user accepted
 * version X" is a fact about the host's own identity row, and a model in the package
 * would be a second answer to a question the host's user table already answers. So
 * this host keeps it in a Map — which is not a shortcut, it is the point. An
 * adopter's answer is a column on `users`; the harness's is a Map; the package
 * cannot tell and must not care.
 *
 * ## Why the version is MOVABLE
 *
 * The failure this surface exists for is a version BUMP, which in production ships
 * as a deploy. A harness that could only ever be on one version could never
 * reproduce it, so `/__harness/app-shell/bump` moves it — through a GETTER on the
 * config, because the descriptors read `termsVersion` when they handle a request
 * rather than when the router is built. A router rebuilt on every bump would have to
 * be re-mounted, and Hono registers a sub-router's handlers at `route()` time.
 */
import type { Hono } from 'hono';

import { appShellRouter } from '@12-apps/app-shell/hono';
import type { AppShellServerConfig, ConsentActor } from '@12-apps/app-shell/server';

/** The version this deployment starts on. */
const INITIAL_VERSION = '2026-07-27';

/** The header a spec sets to act as someone else. */
const ACTOR_HEADER = 'x-harness-actor';

/**
 * The cookie a browser presents instead of that header — the SPA's identity.
 *
 * Its own name rather than the realtime page's `harness-actor`: every page module in
 * that SPA is evaluated at boot, and that one assigns its cookie unconditionally, so a
 * spec setting `harness-actor` before navigating would have it overwritten on load.
 */
const ACTOR_COOKIE = 'harness-consent';

/**
 * The seeded users. `owner` has accepted the initial version; `novo` has accepted
 * nothing at all, so it is stale from the first request with no bump needed.
 */
const SEEDED: ReadonlyArray<readonly [string, string | null]> = [
  ['owner', INITIAL_VERSION],
  ['novo', null],
];

interface ConsentState {
  version: string;
  /** userId → the version they last accepted. */
  accepted: Map<string, string | null>;
  /** Who was told about an acceptance, in order — the `onAccepted` seam's proof. */
  published: string[];
  /** Set by the suite to make the host's own write fail. */
  recordFails: boolean;
}

export type HarnessAppShell = ReturnType<typeof appShellHost>;

/**
 * Who is asking, from a header OR a cookie.
 *
 * Both, because the two callers genuinely differ: a vitest `app.request()` sets a
 * header, and the SPA sets a cookie — `document.cookie` is the only identity a
 * browser presents by itself, which is the same reason a real host reads a session
 * cookie. `anonymous` is how either asks for the signed-out path.
 */
function resolveActor(request: { header(name: string): string | undefined }): ConsentActor | null {
  const cookie = request.header('cookie') ?? '';
  const fromCookie = new RegExp(`${ACTOR_COOKIE}=([^;]+)`).exec(cookie)?.[1];
  const userId = request.header(ACTOR_HEADER) ?? fromCookie;
  if (!userId || userId === 'anonymous') return null;
  return { userId };
}

export function appShellHost() {
  const state: ConsentState = {
    version: INITIAL_VERSION,
    accepted: new Map(SEEDED),
    published: [],
    recordFails: false,
  };

  const config: AppShellServerConfig = {
    // A getter, not a value — see the module docstring.
    get termsVersion() {
      return state.version;
    },
    consent: {
      resolveActor,
      // The host's own predicate. An adopter passes the one its guards use; this one
      // is a Map lookup, and the package cannot tell the difference.
      isCurrent: (actor, version) => state.accepted.get(actor.userId) === version,
      record: (actor, version) => {
        // The suite's switch for the 500 path. A host whose write fails must THROW:
        // answering 204 over it would tell the user they accepted while every guard
        // keeps refusing them.
        if (state.recordFails) throw new Error('the harness host refused the write');
        state.accepted.set(actor.userId, version);
      },
      // Where a real host publishes a realtime hint so the user's other devices
      // re-ask. Recorded rather than published: the harness has no second tab.
      onAccepted: (actor) => state.published.push(actor.userId),
      cookie: {
        name: 'signup_terms',
        // A host secret the browser never has. Signed, not encrypted — what matters
        // is that `document.cookie` cannot forge it.
        sign: (version, expiresAt) => `${version}.${expiresAt}.harness-signature`,
        ttlMs: 60_000,
        // The package defaults this to `true`; the harness is served over plain HTTP,
        // where a `Secure` cookie is one the browser silently declines to store. This is
        // what the opt-out looks like for a dev box — deliberate, not omitted.
        secure: false,
      },
    },
    // Required now, and this host's own sentence. The pt-BR default the package
    // used to ship was the extraction origin's wording, reached by omission —
    // and this harness omitted it, so it rendered that copy while standing in
    // for an independent consumer.
    messages: {
      recordFailed: 'Não foi possível registrar seu aceite. Tente de novo em instantes.',
    },
  };

  const shell = appShellRouter(config);

  return {
    router: shell.router,
    /** Back to the seeded fixture — the `/__harness/reset` contract. */
    reset: (): void => {
      state.version = INITIAL_VERSION;
      state.accepted = new Map(SEEDED);
      state.published = [];
      state.recordFails = false;
    },
    /** The suite's controls, mounted by {@link mountAppShellControls}. */
    controls: {
      version: (): string => state.version,
      bump: (version: string): void => {
        state.version = version;
      },
      published: (): readonly string[] => [...state.published],
      failWrites: (fails: boolean): void => {
        state.recordFails = fails;
      },
    },
  };
}

/**
 * The shell's suite controls — a terms-version BUMP, which in production is a deploy.
 *
 * Under `/__harness` and not `/api`, like every other control in this harness: deciding
 * when a host's legal documents change is exactly what stays in a host, so this is the
 * one piece of the consent story the harness cannot get from the package.
 *
 * It lives HERE rather than in `app.ts` because it reaches for nothing else — only the
 * `controls` object above — and `app.ts` is the file every package in this series adds
 * to, so it is the one that keeps meeting the size gate.
 */
export function mountAppShellControls(app: Hono, host: ReturnType<typeof appShellHost>): void {
  app.post('/__harness/app-shell/bump', async (c) => {
    const body = (await c.req.json()) as { version?: string };
    host.controls.bump(body.version ?? `bumped-${Date.now()}`);
    return c.json({ version: host.controls.version() });
  });

  /** Make the host's own `record` fail, so the 500 path is reachable from a browser. */
  app.post('/__harness/app-shell/fail-writes', async (c) => {
    const body = (await c.req.json()) as { fails?: boolean };
    host.controls.failWrites(body.fails !== false);
    return c.body(null, 204);
  });

  /** What `onAccepted` was called with — a real host would have published a hint. */
  app.get('/__harness/app-shell/published', (c) =>
    c.json({ published: host.controls.published() }),
  );
}
