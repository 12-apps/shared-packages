import { render, screen, waitFor } from "@testing-library/react";
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
