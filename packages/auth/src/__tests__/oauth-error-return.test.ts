// @vitest-environment node
// Node, not jsdom: Auth.js encrypts its PKCE cookie with jose, which rejects
// jsdom's Uint8Array, and the sign-in then fails as `Configuration`.

import { Auth } from "@auth/core";
import type { Provider } from "@auth/core/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiAuth } from "../create-api-auth";
import { CREDENTIALS_PROVIDER_ID } from "../credentials-provider-id";
import { signInStartCookieName } from "../oauth-error-return";

/**
 * A failed OAuth round trip returns to the page that started it (FUT-4595).
 *
 * Driven through `createApiAuth` and the real Auth.js, the way a browser does
 * it: CSRF, the sign-in POST from a page, the provider's redirect back to the
 * callback. Only the identity provider is fake, and it is never reached — a
 * refusal is answered before any token request.
 */

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/auth`;
const START = "/entrar?volta=%2Fpainel%2Fpedidos&challenge=abc";

/** A plain OAuth 2 provider: no discovery, so nothing leaves the process. */
const oauthProvider = {
  id: "acme",
  name: "Acme",
  type: "oauth",
  clientId: "client-id",
  clientSecret: "client-secret",
  authorization: "https://idp.example/authorize",
  token: "https://idp.example/token",
  userinfo: "https://idp.example/userinfo",
  checks: ["pkce"],
} as unknown as Provider;

/**
 * An OIDC provider whose discovery the callback must fetch. With the fetch
 * failing, Auth.js answers `Configuration` before it even reads the refusal —
 * the code the live reproduction got.
 */
const oidcProvider = {
  id: "oidc-idp",
  name: "OIDC IdP",
  type: "oidc",
  issuer: "https://oidc.example",
  clientId: "client-id",
  clientSecret: "client-secret",
  authorization: "https://oidc.example/authorize",
  checks: ["pkce"],
} as unknown as Provider;

/** A browser's cookie jar, reduced to what these requests carry. */
class Jar {
  private readonly cookies = new Map<string, string>();

  take(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function makeAuth(providers: Provider[] = [oauthProvider], errorReturnsToStart = true) {
  return createApiAuth({ providers, signInGate: () => true, errorReturnsToStart });
}

type Auth = ReturnType<typeof makeAuth>;

/** CSRF, then the sign-in POST a provider button submits. */
async function startSignIn(
  auth: Auth,
  jar: Jar,
  provider: string,
  referer: string | null,
): Promise<Response> {
  const csrf = await auth.handler(new Request(`${BASE}/csrf`));
  jar.take(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    cookie: jar.header(),
  };
  if (referer !== null) headers.referer = referer;
  const response = await auth.handler(
    new Request(`${BASE}/signin/${provider}`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/painel/pedidos` }).toString(),
    }),
  );
  jar.take(response);
  return response;
}

/** The provider sending the browser back, here with its refusal on the query. */
async function callback(auth: Auth, jar: Jar, provider: string, query: string): Promise<Response> {
  const response = await auth.handler(
    new Request(`${BASE}/callback/${provider}?${query}`, { headers: { cookie: jar.header() } }),
  );
  jar.take(response);
  return response;
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "");
}

const START_COOKIE = signInStartCookieName(false);

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-value-long-enough");
  vi.stubEnv("AUTH_TRUST_HOST", "true");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("ADMIN_EMAILS", "");
  // Auth.js logs every failure through the package's redacting logger.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a refused consent returns to the page that started the sign-in", () => {
  it("lands on the start page, its query kept, explained as OAuthCallback", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    const started = await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);
    expect(location(started).origin).toBe("https://idp.example");
    expect(jar.has(START_COOKIE)).toBe(true);

    const target = location(await callback(auth, jar, "acme", "error=access_denied"));

    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("volta")).toBe("/painel/pedidos");
    expect(target.searchParams.get("challenge")).toBe("abc");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
    // Spent: the next failure must not reuse it.
    expect(jar.has(START_COOKIE)).toBe(false);
  });

  it("is OAuthCallback, not Configuration, when Auth.js trips before reading the refusal", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const auth = makeAuth([oidcProvider]);
    const jar = new Jar();
    await startSignIn(auth, jar, "oidc-idp", `${ORIGIN}${START}`);

    const target = location(await callback(auth, jar, "oidc-idp", "error=access_denied"));

    expect(`${target.pathname}`).toBe("/entrar");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
  });

  it("reads a refusal posted as a form, though the start cookie never rides it", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);

    // A `form_post` answer is a CROSS-SITE POST: the browser sends no Lax
    // cookie with it — not the start, not Auth.js's PKCE — so this is what
    // arrives. The failure goes to the sign-in page, as it always did, but the
    // refusal still reads as one.
    const response = await auth.handler(
      new Request(`${BASE}/callback/acme`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ error: "access_denied" }).toString(),
      }),
    );

    const target = location(response);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
  });

  it("keeps Auth.js's code for a provider error that is not a refused consent", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);

    const target = location(await callback(auth, jar, "acme", "error=server_error"));

    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("error")).toBe("OAuthCallbackError");
  });

  it("keeps a code the start page carried itself", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}/convite?code=XYZ`);

    const target = location(await callback(auth, jar, "acme", "error=access_denied"));

    expect(target.pathname).toBe("/convite");
    expect(target.searchParams.get("code")).toBe("XYZ");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
  });

  it("replaces an error left on the start page by an earlier attempt", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}/login?error=OAuthCallback&callbackUrl=%2Fconta`);

    const target = location(await callback(auth, jar, "acme", "error=access_denied"));

    expect(target.pathname).toBe("/login");
    expect(target.searchParams.getAll("error")).toEqual(["OAuthCallback"]);
    expect(target.searchParams.get("callbackUrl")).toBe("/conta");
  });
});

describe("a failure that is not the provider's keeps Auth.js's code", () => {
  it("goes back to the start with that code", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);

    // No refusal on the query, and the PKCE verifier lost on the way: Auth.js's
    // own failure, which is not the person's to explain away.
    const response = await auth.handler(
      new Request(`${BASE}/callback/acme?code=abc`, {
        headers: { cookie: `${START_COOKIE}=${encodeURIComponent(START)}` },
      }),
    );

    const target = location(response);
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("error")).toBe("Configuration");
  });
});

describe("where no start is known, the failure goes where it always went", () => {
  it("uses the sign-in page when the POST carried no Referer", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", null);
    expect(jar.has(START_COOKIE)).toBe(false);

    const target = location(await callback(auth, jar, "acme", "error=access_denied"));

    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
  });

  it("never follows a Referer on another origin", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", "https://evil.example/entrar?volta=x");
    expect(jar.has(START_COOKIE)).toBe(false);

    const target = location(await callback(auth, jar, "acme", "error=access_denied"));

    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/login");
  });

  it("does not take an auth route as the start", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${BASE}/signin`);

    expect(jar.has(START_COOKIE)).toBe(false);
  });

  it("ignores a start cookie that is not a same-origin path", async () => {
    const auth = makeAuth();

    const response = await auth.handler(
      new Request(`${BASE}/callback/acme?error=access_denied`, {
        headers: { cookie: `${START_COOKIE}=${encodeURIComponent("//evil.example/x")}` },
      }),
    );

    const target = location(response);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/login");
  });

  it("ignores a backslash path a browser would read as another host", async () => {
    const auth = makeAuth();

    const response = await auth.handler(
      new Request(`${BASE}/callback/acme?error=access_denied`, {
        headers: { cookie: `${START_COOKIE}=${encodeURIComponent("/\\evil.example/x")}` },
      }),
    );

    const target = location(response);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/login");
  });

  it("forgets a stale start when a later sign-in has none", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    jar.set(START_COOKIE, encodeURIComponent("/old-page"));

    await startSignIn(auth, jar, "acme", null);

    expect(jar.has(START_COOKIE)).toBe(false);
  });
});

describe("the routes it does not touch", () => {
  it("adds no cookie to a sign-in that has nothing to remember or forget", async () => {
    const auth = makeAuth();
    const jar = new Jar();
    const response = await startSignIn(auth, jar, "acme", null);

    expect(response.headers.getSetCookie().join("\n")).not.toContain("sign-in-start");
  });

  it("names the cookie __Host- on https, so no sibling subdomain can set it", () => {
    expect(signInStartCookieName(true)).toBe("__Host-authjs.sign-in-start");
  });
});

describe("a planted start cookie never leads off the origin", () => {
  // Each normalises, in the URL parser, into a path that starts with `//`.
  for (const planted of ["/.//evil.com/x", "/a/..//evil.com", "/%2e//evil.com", "/..//evil.com"]) {
    it(`refuses ${planted}`, async () => {
      const auth = makeAuth();

      const response = await auth.handler(
        new Request(`${BASE}/callback/acme?error=access_denied`, {
          headers: { cookie: `${START_COOKIE}=${encodeURIComponent(planted)}` },
        }),
      );

      const target = location(response);
      expect(target.origin).toBe(ORIGIN);
      expect(target.pathname).toBe("/login");
    });
  }

  it("ignores, on https, a start cookie under a name a subdomain could set", async () => {
    const auth = makeAuth();
    const secure = "https://shop.example";

    // `__Secure-` may carry `Domain=`; only the `__Host-` name is read.
    const response = await auth.handler(
      new Request(`${secure}/api/auth/callback/acme?error=access_denied`, {
        headers: { cookie: `__Secure-authjs.sign-in-start=${encodeURIComponent("/entrar")}` },
      }),
    );

    const target = location(response);
    expect(target.origin).toBe(secure);
    expect(target.pathname).toBe("/login");
  });
});

/** Every Set-Cookie with its value blanked, so two runs can be compared. */
function cookieShapes(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((line) => line.replace(/^([^=]+)=[^;]*/, "$1=<value>"))
    .sort();
}

describe("a successful sign-in is untouched", () => {
  function stubProvider(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://idp.example/token")) {
        return Response.json({ access_token: "access", token_type: "bearer" });
      }
      if (url.startsWith("https://idp.example/userinfo")) {
        return Response.json({ sub: "user-1", email: "pessoa@example.com", name: "Pessoa" });
      }
      throw new TypeError(`unexpected fetch ${url}`);
    });
  }

  async function roundTrip(errorReturnsToStart: boolean): Promise<Response> {
    const auth = makeAuth([oauthProvider], errorReturnsToStart);
    const jar = new Jar();
    await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);
    if (errorReturnsToStart) expect(jar.has(START_COOKIE)).toBe(true);
    return callback(auth, jar, "acme", "code=authorization-code");
  }

  it("keeps Auth.js's redirect and cookies, and clears the start", async () => {
    stubProvider();
    const on = await roundTrip(true);
    const off = await roundTrip(false);

    expect(location(on).toString()).toBe(`${ORIGIN}/painel/pedidos`);
    expect(on.headers.get("location")).toBe(off.headers.get("location"));
    const sessions = on.headers.getSetCookie().filter((line) => line.startsWith("authjs.session-token="));
    expect(sessions).toHaveLength(1);
    // Auth.js's own cookies exactly as it set them, plus the start's clear.
    const startClear = `${START_COOKIE}=<value>; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    expect(cookieShapes(on)).toEqual([...cookieShapes(off), startClear].sort());
  });
});

describe("a JSON answer is never rewritten", () => {
  it("leaves a credentials callback's body and status alone, and clears a stale start", async () => {
    async function credentialsCallback(errorReturnsToStart: boolean): Promise<Response> {
      const auth = createApiAuth({
        providers: [oauthProvider],
        signInGate: () => true,
        errorReturnsToStart,
        emailPassword: {
          authenticate: () => Promise.resolve({ ok: false, reason: "invalid-credentials" }),
        },
      });
      const jar = new Jar();
      const csrf = await auth.handler(new Request(`${BASE}/csrf`));
      jar.take(csrf);
      const { csrfToken } = (await csrf.json()) as { csrfToken: string };
      jar.set(START_COOKIE, encodeURIComponent("/entrar?volta=x"));
      return auth.handler(
        new Request(`${BASE}/callback/${CREDENTIALS_PROVIDER_ID}`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-auth-return-redirect": "1",
            cookie: jar.header(),
          },
          body: new URLSearchParams({ csrfToken, email: "a@b.c", password: "wrong" }).toString(),
        }),
      );
    }

    const on = await credentialsCallback(true);
    const off = await credentialsCallback(false);

    expect(on.status).toBe(off.status);
    expect(await on.text()).toBe(await off.text());
    expect(on.headers.getSetCookie().join("\n")).toMatch(/authjs\.sign-in-start=; .*Max-Age=0/);
  });
});

describe("off by default: the handler is Auth.js's, untouched", () => {
  it("sets no start cookie and answers exactly as Auth.js does", async () => {
    const auth = makeAuth([oauthProvider], false);
    const jar = new Jar();
    const started = await startSignIn(auth, jar, "acme", `${ORIGIN}${START}`);
    expect(started.headers.getSetCookie().join("\n")).not.toContain("sign-in-start");

    const request = (): Request =>
      new Request(`${BASE}/callback/acme?error=access_denied`, {
        headers: { cookie: `${jar.header()}; ${START_COOKIE}=${encodeURIComponent(START)}` },
      });
    const viaHandler = await auth.handler(request());
    const direct = (await Auth(request(), auth.config)) as Response;

    expect(viaHandler.status).toBe(direct.status);
    expect(viaHandler.headers.get("location")).toBe(direct.headers.get("location"));
    expect(cookieShapes(viaHandler)).toEqual(cookieShapes(direct));
    expect(location(viaHandler).pathname).toBe("/login");
    expect(location(viaHandler).searchParams.get("error")).toBe("OAuthCallbackError");
  });

  it("is off when createApiAuth is given no option", async () => {
    // The options object a host passes today, with nothing new in it.
    const auth = createApiAuth({ providers: [oauthProvider], signInGate: () => true });

    const response = await auth.handler(
      new Request(`${BASE}/callback/acme?error=access_denied`, {
        headers: { cookie: `${START_COOKIE}=${encodeURIComponent(START)}` },
      }),
    );

    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("OAuthCallbackError");
    expect(response.headers.getSetCookie().join("\n")).not.toContain("sign-in-start");
  });
});
