// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebEvents } from "../create-web-events";
import { fallbackRefetchInterval, reconcileRefetchInterval } from "../use-realtime";
import type { RealtimeMessage, RealtimeTransport, WireSource } from "../types";

/**
 * `createWebEvents` mounted for real.
 *
 * The three claims worth proving at this layer:
 *   1. one connection per provider, with the union of every screen's topics on it;
 *   2. an event reaches only the screens that asked for its topic;
 *   3. the SCOPE is in the type of the hook — a user-scoped consumer never resolves the
 *      tenant provider, because the tenant endpoint does not serve user topics and the
 *      connection would open, report itself live, and carry nothing.
 */

/**
 * A controllable wire.
 *
 * Note what this replaces: jsdom HAS `WebSocket` but NOT `EventSource`, so a channel
 * mounted with the real default factory takes the SOCKET path and genuinely `POST`s for a
 * ticket. Injecting `createSource` is what keeps that out of a component test — and it also
 * forces the in-page host, which is what a test can drive.
 */
function fakeWire() {
  const built: { url: string; transport: RealtimeTransport; source: FakeSource }[] = [];

  class FakeSource implements WireSource {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    close(): void {}
  }

  return {
    built,
    factory: (url: string, transport: RealtimeTransport): WireSource => {
      const source = new FakeSource();
      built.push({ url, transport, source });
      return source;
    },
    /**
     * Select a stream by URL, never by index: an app-wide provider opens LAST (React runs
     * a child's effects before its parent's), so `.at(-1)` silently returns the wrong one.
     */
    byUrl: (fragment: string): FakeSource => {
      const found = built.find((entry) => entry.url.includes(fragment));
      if (!found) throw new Error(`no stream for ${fragment}; have ${built.map((e) => e.url)}`);
      return found.source;
    },
  };
}

/** The wire firing, not the user — so it belongs inside `act`. */
function goLive(source: WireSource): void {
  act(() => {
    source.onopen?.({});
  });
}
function deliverHint(source: WireSource, message: RealtimeMessage): void {
  act(() => {
    source.onmessage?.({ data: JSON.stringify(message) });
  });
}

const NOW_MS = 1_767_225_600_000;
const hint = (topic: string): RealtimeMessage => ({
  topic,
  type: "changed",
  data: {},
  ts: NOW_MS,
  id: `${topic}-1`,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebEvents — endpoints", () => {
  it("derives both surfaces from the api base, the origin host's spellings by default", () => {
    const events = createWebEvents();
    expect(events.tenantEndpoint("loja-a")).toBe("/api/admin/loja-a/realtime");
    expect(events.userEndpoint()).toBe("/api/account/realtime");
  });

  it("encodes a slug, so a slug can never inject a path segment", () => {
    expect(createWebEvents().tenantEndpoint("a/b")).toBe("/api/admin/a%2Fb/realtime");
  });

  it("takes a host's own mount and paths", () => {
    const events = createWebEvents({
      apiBase: "/v2",
      tenantPath: (slug) => `/stores/${slug}/events`,
      userPath: "/me/events",
    });
    expect(events.tenantEndpoint("loja-a")).toBe("/v2/stores/loja-a/events");
    expect(events.userEndpoint()).toBe("/v2/me/events");
  });
});

describe("createWebEvents — one connection, many screens", () => {
  it("puts the UNION of every screen's topics on one stream", async () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Kitchen(): JSX.Element {
      const { status } = events.useTopics({ topics: ["kitchen"] });
      return <span data-testid="kitchen">{status}</span>;
    }
    function Orders(): JSX.Element {
      events.useTopics({ topics: ["orders"] });
      return <span />;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Kitchen />
        <Orders />
      </events.Provider>,
    );

    // The union is applied on a microtask, so the channel only ever sees where it landed —
    // never the EMPTY state a navigation passes through.
    await waitFor(() => {
      expect(wire.byUrl("topics=kitchen%2Corders")).toBeDefined();
    });
    // ONE stream, not one per screen.
    expect(wire.built).toHaveLength(1);
  });

  it("routes an event only to the screen that asked for its topic", async () => {
    const wire = fakeWire();
    const events = createWebEvents();
    const seen = { kitchen: 0, orders: 0 };

    function Kitchen(): JSX.Element {
      events.useTopics({
        topics: ["kitchen"],
        onMessage: () => {
          seen.kitchen += 1;
        },
      });
      return <span />;
    }
    function Orders(): JSX.Element {
      events.useTopics({
        topics: ["orders"],
        onMessage: () => {
          seen.orders += 1;
        },
      });
      return <span />;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Kitchen />
        <Orders />
      </events.Provider>,
    );
    await waitFor(() => {
      expect(wire.byUrl("topics=kitchen%2Corders")).toBeDefined();
    });

    const source = wire.byUrl("realtime");
    goLive(source);
    deliverHint(source, hint("tenant:t-1:kitchen"));
    expect(seen).toEqual({ kitchen: 1, orders: 0 });
  });

  it("reports the status every screen keys its poll off", async () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Screen(): JSX.Element {
      const { status, connected } = events.useTopics({ topics: ["kitchen"] });
      return <span data-testid="status">{`${status}:${String(connected)}`}</span>;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Screen />
      </events.Provider>,
    );
    await waitFor(() => {
      expect(wire.byUrl("realtime")).toBeDefined();
    });
    goLive(wire.byUrl("realtime"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected:true");
    });
  });

  it("opens NOTHING when the endpoint is null — realtime simply off", () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Screen(): JSX.Element {
      const { status } = events.useTopics({ topics: ["kitchen"] });
      return <span data-testid="status">{status}</span>;
    }

    render(
      <events.Provider endpoint={null} createSource={wire.factory}>
        <Screen />
      </events.Provider>,
    );
    expect(wire.built).toEqual([]);
    // `disconnected` is the honest answer: consumers keep their full-speed poll.
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
  });

  it("wants nothing when a screen's topics are null", () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Screen(): JSX.Element {
      // A screen whose permissions reach no topic — a normal state, not an error.
      events.useTopics({ topics: null });
      return <span />;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Screen />
      </events.Provider>,
    );
    expect(wire.built).toEqual([]);
  });

  it("reports which host is carrying the connection", async () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Screen(): JSX.Element {
      const { host } = events.useTopics({ topics: ["kitchen"] });
      return <span data-testid="host">{host ?? "none"}</span>;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Screen />
      </events.Provider>,
    );
    // `createSource` forces in-page: a caller that supplies a wire is asking for the
    // connection to be here, where it can drive it.
    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toBe("in-page");
    });
  });
});

describe("createWebEvents — the scope is in the type of the hook", () => {
  it("throws when a tenant-scoped screen has no tenant provider", () => {
    const events = createWebEvents();
    function Screen(): JSX.Element {
      events.useTopics({ topics: ["kitchen"] });
      return <span />;
    }
    // A wiring bug in an app that owns its shell, and worth shouting about.
    expect(() => render(<Screen />)).toThrow(/useTopics needs the <Provider>/);
  });

  it("degrades a user-scoped consumer to disconnected with no provider", () => {
    const events = createWebEvents();
    function Bell(): JSX.Element {
      const { status } = events.useUserTopics({ topics: ["notifications"] });
      return <span data-testid="bell">{status}</span>;
    }
    // The bell and the consent dialog mount in whatever host embeds them; a host that has
    // not adopted the provider must keep working, and nothing may report itself live.
    render(<Bell />);
    expect(screen.getByTestId("bell").textContent).toBe("disconnected");
  });

  it("does NOT resolve the tenant provider from a user-scoped hook", async () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Bell(): JSX.Element {
      const { status } = events.useUserTopics({ topics: ["notifications"] });
      return <span data-testid="bell">{status}</span>;
    }

    render(
      <events.Provider endpoint="/api/admin/loja-a/realtime" createSource={wire.factory}>
        <Bell />
      </events.Provider>,
    );
    // Inside an admin app the NEARER provider is always the tenant one. A shared context
    // would have the bell ask a store's endpoint for `notifications`, which it does not
    // serve — a connection that opens, reports itself live and carries nothing.
    expect(screen.getByTestId("bell").textContent).toBe("disconnected");
    // And the bell contributed nothing to the tenant stream.
    await waitFor(() => {
      expect(wire.built).toEqual([]);
    });
  });

  it("serves a user-scoped consumer from the USER provider", async () => {
    const wire = fakeWire();
    const events = createWebEvents();

    function Bell(): JSX.Element {
      const { status } = events.useUserTopics({ topics: ["notifications"] });
      return <span data-testid="bell">{status}</span>;
    }

    render(
      <events.UserProvider createSource={wire.factory}>
        <Bell />
      </events.UserProvider>,
    );
    await waitFor(() => {
      expect(wire.byUrl("/api/account/realtime")).toBeDefined();
    });
    goLive(wire.byUrl("/api/account/realtime"));
    await waitFor(() => {
      expect(screen.getByTestId("bell").textContent).toBe("connected");
    });
  });

  it("keeps two factories' providers invisible to each other", () => {
    const first = createWebEvents();
    const second = createWebEvents();
    function Screen(): JSX.Element {
      second.useTopics({ topics: ["kitchen"] });
      return <span />;
    }
    // Contexts are created PER FACTORY CALL, so a nested embed with its own api base cannot
    // borrow the outer app's connection.
    expect(() =>
      render(
        <first.Provider endpoint="/api/admin/loja-a/realtime" createSource={() => null}>
          <Screen />
        </first.Provider>,
      ),
    ).toThrow(/useTopics needs the <Provider>/);
  });
});

describe("the polling seams", () => {
  it("reconcile keeps polling while connected — the default choice", () => {
    // Never `false`: delivery is best-effort with no replay, so a screen that stops polling
    // when it stops hearing has no route back to the truth.
    expect(reconcileRefetchInterval("connected", 5_000, 30_000)).toBe(30_000);
    expect(reconcileRefetchInterval("disconnected", 5_000, 30_000)).toBe(5_000);
    expect(reconcileRefetchInterval("unavailable", 5_000, 30_000)).toBe(5_000);
    expect(reconcileRefetchInterval("connecting", 5_000, 30_000)).toBe(5_000);
  });

  it("fallback pauses only while connected", () => {
    expect(fallbackRefetchInterval("connected", 5_000)).toBe(false);
    expect(fallbackRefetchInterval("disconnected", 5_000)).toBe(5_000);
    expect(fallbackRefetchInterval("unavailable", 5_000)).toBe(5_000);
  });
});
