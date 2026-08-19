import type { AccountSecurityData, SignUpClientData } from "../react/create-email-auth";
import type { EmailAuthSettings } from "../email-credentials/types";

/**
 * A whole e-mail-auth backend, in the page.
 *
 * The demo could have handed the screens a hand-written fake client, and it
 * would have looked the same. This answers HTTP instead, so the demo drives the
 * real `createEmailAuth` over the real request and response shapes — which
 * means the thing a reviewer clicks through is the actual client, actually
 * parsing actual refusal bodies, and not a mock that agrees with it by
 * construction.
 *
 * It is a demo, so it is deliberately naive: passwords are compared as strings,
 * tokens are counters, and everything lives in a `Map` that dies with the tab.
 * None of that is a shortcut in the package — it is the HOST's half, and this
 * one exists to be looked at.
 */

/** A message the demo "sent", so the page can show a mailbox to click. */
export interface DemoMessage {
  kind: "verification" | "reset-link";
  to: string;
  /** The token the link carries — the demo page turns it into a button. */
  token: string;
}

export interface DemoBackend {
  /** Hand this to both `createWebAuth` and `createEmailAuth`. */
  fetchImpl: typeof fetch;
  /**
   * Called whenever the backend's own state moves.
   *
   * The outbox is a plain array the handlers push onto, so React has no reason
   * to re-render the mailbox when a message arrives — the screens re-render
   * from their OWN state, and the panel beside them would just sit there
   * looking empty. This is what a host would wire to its store.
   */
  subscribe: (listener: () => void) => () => void;
  /** A value that changes whenever `subscribe` fires, for `useSyncExternalStore`. */
  version: () => number;
  /** What has been "sent", newest last. */
  outbox: DemoMessage[];
  /** The two platform switches the super-admin screen owns. */
  settings: EmailAuthSettings;
  /** Whoever is signed in, or null. */
  signedInAs: () => string | null;
  /** Sign somebody in, the way a social callback would. */
  signIn: (email: string) => void;
}

interface DemoUser {
  password: string | null;
  verified: boolean;
}

/** Everything the handlers below read and write. */
interface DemoState {
  users: Map<string, DemoUser>;
  tokens: Map<string, { email: string; purpose: DemoMessage["kind"] }>;
  outbox: DemoMessage[];
  settings: EmailAuthSettings;
  session: string | null;
  counter: number;
  version: number;
  listeners: Set<() => void>;
}

/** A JSON response in the shape the client parses. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ok = (data: unknown = null): Response => json(200, { data });
const refuse = (reason: string, violations?: string[]): Response =>
  json(400, violations ? { reason, violations } : { reason });

/** The demo's password policy — the same shape the real one refuses with. */
function weak(password: string): string[] | null {
  const violations: string[] = [];
  if (password.length < 8) violations.push("At least 8 characters.");
  if (!/\d/.test(password)) violations.push("Include a number.");
  return violations.length > 0 ? violations : null;
}

function notify(state: DemoState): void {
  state.version += 1;
  state.listeners.forEach((listener) => listener());
}

function issue(state: DemoState, email: string, kind: DemoMessage["kind"]): void {
  state.counter += 1;
  const token = `demo-token-${state.counter}`;
  state.tokens.set(token, { email, purpose: kind });
  state.outbox.push({ kind, to: email, token });
  notify(state);
}

/** Spend a token once, or report why not. */
function consume(state: DemoState, token: unknown, purpose: DemoMessage["kind"]): string | null {
  if (typeof token !== "string") return null;
  const row = state.tokens.get(token);
  if (!row || row.purpose !== purpose) return null;
  state.tokens.delete(token);
  return row.email;
}

type Handler = (state: DemoState, body: Record<string, unknown>) => Response;

const signUp: Handler = (state, body) => {
  const email = String(body.email ?? "").toLowerCase();
  const password = String(body.password ?? "");
  const violations = weak(password);
  if (violations) return refuse("weak-password", violations);

  // Taken or free answers identically while verification is on — the
  // non-enumerating contract. With it off, the account works immediately, so
  // the demo has to be able to say the address is taken.
  if (state.users.has(email) && !state.settings.requireEmailVerification) {
    return refuse("email-taken");
  }
  if (!state.users.has(email)) state.users.set(email, { password, verified: false });

  if (state.settings.requireEmailVerification) {
    issue(state, email, "verification");
    return ok({ status: "verification-sent" } satisfies SignUpClientData);
  }
  state.session = email;
  notify(state);
  return ok({ status: "signed-up" } satisfies SignUpClientData);
};

const resetPassword: Handler = (state, body) => {
  // Policy BEFORE the token is spent, so a weak password leaves the link live.
  const violations = weak(String(body.password ?? ""));
  if (violations) return refuse("weak-password", violations);
  const email = consume(state, body.token, "reset-link");
  if (!email) return refuse("token-invalid");
  const user = state.users.get(email);
  if (user) {
    user.password = String(body.password ?? "");
    // Clicking a link delivered to the inbox proves the address, exactly as a
    // verification link does.
    user.verified = true;
  }
  return ok();
};

const setPassword: Handler = (state, body) => {
  const user = state.session ? state.users.get(state.session) : undefined;
  if (!user) return refuse("no-account");
  const violations = weak(String(body.password ?? ""));
  if (violations) return refuse("weak-password", violations);
  if (user.password && body.currentPassword !== user.password) {
    return refuse(body.currentPassword ? "current-password-invalid" : "current-password-required");
  }
  user.password = String(body.password ?? "");
  return ok();
};

const security: Handler = (state) => {
  const user = state.session ? state.users.get(state.session) : undefined;
  return ok({
    hasPassword: Boolean(user?.password),
    emailVerified: Boolean(user?.verified),
    enabled: state.settings.enabled,
  } satisfies AccountSecurityData);
};

/**
 * The credentials callback — Auth.js's own endpoint, which is why it answers so
 * differently from the rest: a `{ url }` whose QUERY STRING carries the
 * outcome, because the browser flow it was designed for is a redirect. The
 * client asks for JSON with `X-Auth-Return-Redirect` and reads the result off
 * that URL rather than following it.
 */
const credentialsCallback: Handler = (state, body) => {
  const email = String(body.email ?? "").toLowerCase();
  const target = String(body.callbackUrl ?? "/");
  const fail = (code: string): Response =>
    json(200, { url: `${target}?error=CredentialsSignin&code=${code}` });

  if (!state.settings.enabled) return fail("method-disabled");
  const user = state.users.get(email);
  // Unknown address and wrong password are the same answer, deliberately.
  if (!user || user.password !== String(body.password ?? "")) return fail("invalid-credentials");
  if (state.settings.requireEmailVerification && !user.verified) return fail("email-not-verified");

  state.session = email;
  notify(state);
  return json(200, { url: target });
};

/** One entry per endpoint, each small enough to read whole. */
const ROUTES: Record<string, Handler> = {
  "GET /api/auth/session": (state) =>
    state.session
      ? json(200, { user: { email: state.session, name: state.session.split("@")[0] } })
      : json(200, {}),
  "GET /api/auth/csrf": () => json(200, { csrfToken: "demo-csrf-token" }),
  "POST /api/auth/callback/credentials": credentialsCallback,
  "POST /api/auth/signout": (state) => {
    state.session = null;
    notify(state);
    return json(200, {});
  },
  "GET /api/auth/email/settings": (state) => ok(state.settings),
  "POST /api/auth/email/signup": signUp,
  "POST /api/auth/email/verify": (state, body) => {
    const email = consume(state, body.token, "verification");
    if (!email) return refuse("token-invalid");
    const user = state.users.get(email);
    if (user) user.verified = true;
    return ok();
  },
  "POST /api/auth/email/resend-verification": (state, body) => {
    const email = String(body.email ?? "").toLowerCase();
    // Always acknowledges — it must not reveal whether the address exists.
    if (state.users.has(email)) issue(state, email, "verification");
    return ok();
  },
  "POST /api/auth/email/forgot-password": (state, body) => {
    const email = String(body.email ?? "").toLowerCase();
    if (state.users.has(email)) issue(state, email, "reset-link");
    // Same answer either way. That is the point of the screen.
    return ok();
  },
  "POST /api/auth/email/reset-password": resetPassword,
  "PUT /api/auth/email/password": setPassword,
  "GET /api/auth/email/password": security,
};

/** Auth.js's callback posts form-encoded; the e-mail endpoints post JSON. */
function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  const raw = typeof init?.body === "string" ? init.body : "";
  const headers = (init?.headers ?? {}) as Record<string, string>;
  if (String(headers["Content-Type"] ?? "").includes("form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

export function createDemoBackend(): DemoBackend {
  const state: DemoState = {
    users: new Map<string, DemoUser>([
      // One pre-existing account created through a social provider: an address,
      // no password. The state the security card exists for.
      ["ana@example.com", { password: null, verified: true }],
    ]),
    tokens: new Map(),
    outbox: [],
    settings: { enabled: true, requireEmailVerification: true },
    session: null,
    counter: 0,
    version: 0,
    listeners: new Set(),
  };

  const fetchImpl: typeof fetch = (input, init) => {
    const path = String(input).split("?")[0] ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = ROUTES[`${method} ${path}`];
    const response = handler ? handler(state, parseBody(init)) : json(404, { reason: "unknown" });
    return Promise.resolve(response);
  };

  return {
    fetchImpl,
    subscribe: (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    version: () => state.version,
    outbox: state.outbox,
    settings: state.settings,
    signedInAs: () => state.session,
    signIn: (email) => {
      // A social sign-in CREATES the account when it is the first one — with no
      // password and an address the provider already proved. That is precisely
      // the state the security card exists to get somebody out of.
      if (!state.users.has(email)) state.users.set(email, { password: null, verified: true });
      state.session = email;
      notify(state);
    },
  };
}
