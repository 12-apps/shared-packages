import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebAuth, sameOriginCallbackUrl } from "../create-web-auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LOCATION = { href: "https://app.example.com/orders", origin: "https://app.example.com" };

describe("sameOriginCallbackUrl", () => {
  it("keeps an ordinary relative path", () => {
    expect(sameOriginCallbackUrl("/orders/42", LOCATION)).toBe("/orders/42");
  });

  it("keeps a same-origin absolute URL", () => {
    expect(sameOriginCallbackUrl("https://app.example.com/x", LOCATION)).toBe(
      "https://app.example.com/x",
    );
  });

  it("rejects a protocol-relative URL, which a startsWith('/') check would allow", () => {
    // `//evil.example` is not a path — browsers resolve it as an EXTERNAL URL
    // on the current scheme. This is the open redirect the guard exists for.
    expect(sameOriginCallbackUrl("//evil.example/steal", LOCATION)).toBe(LOCATION.href);
  });

  it("rejects the backslash variant of the same trick", () => {
    expect(sameOriginCallbackUrl("/\\evil.example/steal", LOCATION)).toBe(LOCATION.href);
  });

  it("rejects a different origin", () => {
    expect(sameOriginCallbackUrl("https://evil.example/steal", LOCATION)).toBe(
      LOCATION.href,
    );
  });

  it("rejects an origin that merely starts with ours", () => {
    // `app.example.com.evil.test` passes a naive `startsWith(origin)` check.
    expect(
      sameOriginCallbackUrl("https://app.example.com.evil.test/x", LOCATION),
    ).toBe(LOCATION.href);
  });

  it("falls back to the current href when nothing is given", () => {
    expect(sameOriginCallbackUrl(undefined, LOCATION)).toBe(LOCATION.href);
  });
});

describe("createWebAuth", () => {
  function stubFetch(handler: (url: string) => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function Probe({ useSession }: { useSession: () => { status: string } }): JSX.Element {
    const { status } = useSession();
    return <span data-testid="status">{status}</span>;
  }

  it("reports unauthenticated when the endpoint answers 200 with no user", async () => {
    // Auth.js answers 200 `{}` rather than 401, so the presence of `user` — not
    // the status code — is what distinguishes the two.
    stubFetch(() => new Response("{}", { status: 200 }));
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    });
  });

  it("reports authenticated once a user comes back", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
    );
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });
  });

  it("reports unauthenticated rather than crashing when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    });
  });

  it("reads the session from the configured base path", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    const { SessionProvider, useSession } = createWebAuth({ basePath: "/custom/auth" });

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/custom/auth/session",
        expect.objectContaining({ credentials: "same-origin" }),
      );
    });
  });

  it("picks up a global fetch installed AFTER the surface was built", async () => {
    // The order every other test in this file happens to use — stub, then build
    // — is the one order a host never uses. An app calls `createWebAuth()` at
    // module scope, so the factory runs at IMPORT time and any stub a suite
    // installs in `beforeEach` lands afterwards. Reading the global once inside
    // the factory therefore froze the real `fetch` in, and every SPA suite that
    // stubs it hung on a session request nothing was left to answer.
    const { SessionProvider, useSession } = createWebAuth();
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
    );

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("still lets an explicit fetchImpl override the global", async () => {
    // The late binding is only the DEFAULT. A story or a design review that
    // hands in its own transport must keep it even where a global exists.
    stubFetch(() => {
      throw new Error("the global fetch must not be reached");
    });
    const injected = vi.fn(
      async () => new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
    );
    const { SessionProvider, useSession } = createWebAuth({ fetchImpl: injected });

    render(
      <SessionProvider>
        <Probe useSession={useSession} />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });
    expect(injected).toHaveBeenCalled();
  });

  it("throws a named error when useSession is used outside the provider", () => {
    const { useSession } = createWebAuth();

    function Orphan(): JSX.Element {
      useSession();
      return <span />;
    }

    // React logs the boundary-less throw; silence it so the suite output stays
    // readable while still asserting the message.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/must be used within a SessionProvider/);
  });

  it("keeps two instances' contexts apart", async () => {
    // Each call builds its own context, so an app mounting two surfaces cannot
    // have one provider satisfy the other's hook.
    stubFetch(() => new Response("{}", { status: 200 }));
    const first = createWebAuth();
    const second = createWebAuth();

    function OrphanOfSecond(): JSX.Element {
      second.useSession();
      return <span />;
    }

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <first.SessionProvider>
          <OrphanOfSecond />
        </first.SessionProvider>,
      ),
    ).toThrow(/must be used within a SessionProvider/);
  });
});

describe("createWebAuth sign-out", () => {
  /**
   * Enough backend to reproduce the deployment this was found on.
   *
   * A store reached on its OWN domain, whose `/api/auth/**` requests the host
   * re-origins onto the platform's `AUTH_URL` — which it must, because the OAuth
   * client's redirect URIs name the platform and nothing else. Auth.js then
   * answers sign-out with a 302 to the platform's homepage, and a browser told
   * to follow that from the store's origin gets no `Access-Control-Allow-Origin`
   * and reports the whole call as an opaque `TypeError: Failed to fetch`.
   *
   * The stub throws exactly that, and honours `X-Auth-Return-Redirect` exactly
   * as `@auth/core` does: the same session-clearing response, handed back as
   * `200 { url }` with no `Location` to chase.
   *
   * `signedOut` lives on an object rather than in a `let` the stub reassigns,
   * so the flakiness gate's closed-over-binding rule has nothing to complain
   * about — and so the session endpoint answers the same way the real one does,
   * from state the sign-out actually changed.
   */
  function stubCrossOriginSignOutBackend(): {
    fetchMock: ReturnType<typeof vi.fn>;
    server: { signedOut: boolean };
  } {
    const server = { signedOut: false };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/csrf")) {
        return new Response(JSON.stringify({ csrfToken: "csrf-1" }), { status: 200 });
      }
      if (url.endsWith("/signout")) {
        // The cookie is cleared BEFORE the redirect either way — which is what
        // made the production failure so misleading.
        server.signedOut = true;
        if (!new Headers(init?.headers).has("X-Auth-Return-Redirect")) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(JSON.stringify({ url: "https://platform.example/" }), {
          status: 200,
        });
      }
      return new Response(
        server.signedOut ? "{}" : JSON.stringify({ user: { id: "u1" } }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, server };
  }

  function SignOutProbe({
    useSession,
    onError,
  }: {
    useSession: () => { status: string; signOut: () => Promise<void> };
    onError: (error: unknown) => void;
  }): JSX.Element {
    const { status, signOut } = useSession();
    return (
      <>
        <span data-testid="status">{status}</span>
        <button
          type="button"
          data-testid="sign-out"
          onClick={() => {
            void signOut().catch(onError);
          }}
        >
          sign out
        </button>
      </>
    );
  }

  it("signs out on a custom domain, where following the redirect fails as CORS", async () => {
    // The regression: sign-out asks for JSON, so there is no cross-origin
    // `Location` for the browser to chase and the promise resolves.
    stubCrossOriginSignOutBackend();
    const onError = vi.fn();
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <SignOutProbe useSession={useSession} onError={onError} />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });

    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    });
    // A rejection here is what left the SPA signed in against a backend that had
    // already dropped the session.
    expect(onError).not.toHaveBeenCalled();
  });

  it("posts the CSRF token and asks Auth.js not to redirect", async () => {
    const { fetchMock } = stubCrossOriginSignOutBackend();
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <SignOutProbe useSession={useSession} onError={vi.fn()} />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });

    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/signout",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          body: "csrfToken=csrf-1",
          headers: expect.objectContaining({ "X-Auth-Return-Redirect": "1" }),
        }),
      );
    });
  });

  /** Signed in, but the sign-out endpoint itself is broken. */
  function stubRefusingSignOutBackend(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/csrf")) {
          return new Response(JSON.stringify({ csrfToken: "csrf-1" }), { status: 200 });
        }
        if (String(input).endsWith("/signout")) return new Response("", { status: 500 });
        return new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 });
      }),
    );
  }

  it("still rejects when the backend refuses the sign-out", async () => {
    // The header removes the spurious failure, not the real one: a 500 must
    // still reach the caller rather than being reported as a sign-out.
    stubRefusingSignOutBackend();
    const onError = vi.fn();
    const { SessionProvider, useSession } = createWebAuth();

    render(
      <SessionProvider>
        <SignOutProbe useSession={useSession} onError={onError} />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    });

    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Sign-out request failed: 500" }),
      );
    });
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });
});
