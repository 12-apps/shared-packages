// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSharedWorkerHost,
  sharedWorkerConnector,
  type ChannelHost,
} from "../channel-host";
import type { RealtimeMessage, RealtimeStatus } from "../types";
import {
  ALIVE_EVERY_MS,
  WORKER_READY_MS,
  type TabMessage,
  type WorkerMessage,
} from "../worker/protocol";

/**
 * The SharedWorker host, and the one thing it cannot afford to assume.
 *
 * `connect()` yielding a port proves nothing. `new SharedWorker(…)` succeeds even when the
 * script it names is not a script — measured: Vite once inlined the worker module as a
 * `data:video/mp2t` URI of raw TypeScript, so the worker never executed and its port never
 * answered. The dangerous half of that is already structurally impossible (nothing reports
 * `connected` unless the worker posts a status), but the subsystem was still silently lost
 * for such a host: permanent `disconnected`, no error, no warning.
 *
 * So the worker posts `ready` on `onconnect` and the host waits for a frame. These cases
 * drive both outcomes, plus the guarantee that a mute worker costs nothing beyond the wait.
 */

/** A port the test answers for — or deliberately does not. */
function fakePort() {
  const posted: TabMessage[] = [];
  const state = { started: false, closed: false };
  const port = {
    postMessage: (message: TabMessage) => posted.push(message),
    start: () => {
      state.started = true;
    },
    close: () => {
      state.closed = true;
    },
    onmessage: null as ((event: MessageEvent) => void) | null,
  };
  return {
    port: port as unknown as MessagePort,
    posted,
    state,
    /** The worker speaking. */
    answer: (message: WorkerMessage): void => {
      port.onmessage?.({ data: message } as MessageEvent);
    },
    /** Whether the host is still listening to this port at all. */
    listening: (): boolean => port.onmessage !== null,
  };
}

/** Every frame of one verb the tab has posted, in order. */
function framesOf(posted: readonly TabMessage[], type: TabMessage["type"]): TabMessage[] {
  return posted.filter((message) => message.type === type);
}

/** A stand-in for the in-page host, recording what it was handed. */
function fakeLocalHost() {
  const calls = { topics: [] as readonly string[], closed: false, built: 0 };
  const build = (): ChannelHost => {
    calls.built += 1;
    return {
      kind: "in-page",
      setTopics: (topics) => {
        calls.topics = topics;
      },
      close: () => {
        calls.closed = true;
      },
    };
  };
  return { calls, build };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sharedWorkerConnector", () => {
  it("answers null where the engine has no SharedWorker, rather than throwing", () => {
    // jsdom has none, which is also the CSP-forbids-workers and the old-engine case. An
    // optimisation may never be the reason a screen stops working.
    expect(sharedWorkerConnector(() => ({}) as SharedWorker)()).toBeNull();
  });

  it("swallows a construction that throws", () => {
    vi.stubGlobal("SharedWorker", class {});
    expect(
      sharedWorkerConnector(() => {
        throw new Error("blocked by CSP");
      })(),
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("createSharedWorkerHost — a worker that answers", () => {
  it("stays on the worker and forwards its frames", () => {
    vi.useFakeTimers();
    const wire = fakePort();
    const local = fakeLocalHost();
    const statuses: RealtimeStatus[] = [];
    const messages: RealtimeMessage[] = [];
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: (status) => statuses.push(status), onMessage: (m) => messages.push(m) },
      () => wire.port,
      { fallback: local.build },
    );
    if (!host) throw new Error("expected a host");

    wire.answer({ type: "ready" });
    vi.advanceTimersByTime(WORKER_READY_MS * 3);

    host.setTopics(["kitchen"]);
    wire.answer({ type: "status", status: "connected" });
    wire.answer({
      type: "event",
      message: { topic: "tenant:t-1:kitchen", type: "kitchen.changed", data: {}, ts: 0, id: "e-1" },
    });

    expect(host.kind).toBe("shared-worker");
    expect(local.calls.built).toBe(0);
    expect(statuses).toEqual(["connected"]);
    expect(messages.map((message) => message.type)).toEqual(["kitchen.changed"]);
    expect(wire.posted).toContainEqual({
      type: "subscribe",
      endpoint: "/api/admin/loja-a/realtime",
      topics: ["kitchen"],
    });
    host.close();
  });

  it("takes a STATUS as proof of life too, for a worker built before `ready` existed", () => {
    // A stale cached worker chunk still answers with a status the moment a tab subscribes.
    // Demoting a worker that is demonstrably working would be the fallback causing the
    // outage it exists to prevent.
    vi.useFakeTimers();
    const wire = fakePort();
    const local = fakeLocalHost();
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: () => {}, onMessage: () => {} },
      () => wire.port,
      { fallback: local.build },
    );
    if (!host) throw new Error("expected a host");

    wire.answer({ type: "status", status: "connecting" });
    vi.advanceTimersByTime(WORKER_READY_MS * 3);
    expect(local.calls.built).toBe(0);
    expect(host.kind).toBe("shared-worker");
    host.close();
  });
});

describe("createSharedWorkerHost — a worker that never answers", () => {
  it("falls back to the page, REPLAYS the topics, and says the host changed", () => {
    vi.useFakeTimers();
    const wire = fakePort();
    const local = fakeLocalHost();
    const kinds: ChannelHost["kind"][] = [];
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: () => {}, onMessage: () => {} },
      () => wire.port,
      { fallback: local.build, onHostChange: (kind) => kinds.push(kind) },
    );
    if (!host) throw new Error("expected a host");

    // The tab asks for topics while the worker is still being waited on — the ordinary
    // sequence, since the provider applies the union immediately after construction.
    host.setTopics(["kitchen", "orders"]);
    expect(local.calls.built).toBe(0);

    vi.advanceTimersByTime(WORKER_READY_MS);

    // The port is released and the in-page host takes over WHERE THE WORKER LEFT OFF —
    // replaying the union is the difference between a fallback and a restart.
    expect(wire.state.closed).toBe(true);
    expect(wire.listening()).toBe(false);
    expect(local.calls.built).toBe(1);
    expect(local.calls.topics).toEqual(["kitchen", "orders"]);
    // And the arrangement is reported, so `useTopics().host` and a health readout stop
    // saying `shared-worker` next to a permanent `disconnected`.
    expect(kinds).toEqual(["in-page"]);
    expect(host.kind).toBe("in-page");
    host.close();
  });

  it("routes later topic changes to the page host, not to the dead port", () => {
    vi.useFakeTimers();
    const wire = fakePort();
    const local = fakeLocalHost();
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: () => {}, onMessage: () => {} },
      () => wire.port,
      { fallback: local.build },
    );
    if (!host) throw new Error("expected a host");
    vi.advanceTimersByTime(WORKER_READY_MS);

    const postedBefore = wire.posted.length;
    host.setTopics(["tables"]);
    expect(local.calls.topics).toEqual(["tables"]);
    expect(wire.posted).toHaveLength(postedBefore);
    host.close();
    expect(local.calls.closed).toBe(true);
  });

  it("builds no fallback for a host that closed while still waiting", () => {
    vi.useFakeTimers();
    const wire = fakePort();
    const local = fakeLocalHost();
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: () => {}, onMessage: () => {} },
      () => wire.port,
      { fallback: local.build },
    );
    if (!host) throw new Error("expected a host");

    // An unmount inside the wait — a navigation, a tenant switch. A fallback armed here
    // would open a connection nothing will ever close.
    host.close();
    vi.advanceTimersByTime(WORKER_READY_MS * 3);
    expect(local.calls.built).toBe(0);
    expect(wire.state.closed).toBe(true);
    expect(wire.posted.at(-1)).toEqual({ type: "bye" });
  });
});

/**
 * The tab's half of the liveness protocol.
 *
 * A SharedWorker is never told a port went away: closing a tab, navigating it, or
 * discarding it under memory pressure all leave a port that looks exactly like an idle one.
 * The hub's side of that — sweeping whatever stopped answering — is covered in
 * `registry.test.ts`; what a sweep needs to be SAFE is that a live tab keeps speaking, which
 * only this side can prove. A tab that stops announcing loses its topics mid-service, and a
 * tab that never says goodbye holds a subscription open after it is gone.
 */
describe("createSharedWorkerHost — the tab's liveness chatter", () => {
  /** A tab on an ANSWERING worker, which is the only state where the chatter survives. */
  function announcingTab(): { wire: ReturnType<typeof fakePort>; host: ChannelHost } {
    const wire = fakePort();
    const local = fakeLocalHost();
    const host = createSharedWorkerHost(
      "/api/admin/loja-a/realtime",
      { onStatusChange: () => {}, onMessage: () => {} },
      () => wire.port,
      { fallback: local.build },
    );
    if (!host) throw new Error("expected a host");
    // The worker answering is what keeps the connection ON it — the ready timeout would
    // otherwise fall back to the page and detach the chatter along with it.
    wire.answer({ type: "ready" });
    return { wire, host };
  }

  /** The page going away — the browser firing, not the user. */
  function hidePage(): void {
    window.dispatchEvent(new Event("pagehide"));
  }

  it("keeps announcing itself, because a closed tab announces nothing", () => {
    vi.useFakeTimers();
    const tab = announcingTab();

    vi.advanceTimersByTime(ALIVE_EVERY_MS * 2 + 1);

    // Silence is the ONLY signal the worker has, so silence has to mean gone. A tab that
    // stopped announcing while still on screen would have its topics swept out from under
    // it — the kitchen tablet the browser throttled, mid-service.
    expect(framesOf(tab.wire.posted, "alive")).toHaveLength(2);
  });

  it("says goodbye and stops announcing when it closes", () => {
    vi.useFakeTimers();
    const tab = announcingTab();

    tab.host.close();
    vi.advanceTimersByTime(ALIVE_EVERY_MS * 3);

    // The goodbye releases the port's topics at once rather than after three missed
    // announcements; the silence afterwards is what makes it true.
    expect(tab.wire.posted.at(-1)).toEqual({ type: "bye" });
    expect(framesOf(tab.wire.posted, "alive")).toEqual([]);
    expect(tab.wire.state.closed).toBe(true);
  });

  it("says goodbye on `pagehide`, and stops listening once it has closed", () => {
    vi.useFakeTimers();
    const tab = announcingTab();

    // `pagehide` rather than `beforeunload`: it is the one that fires on iOS and on a
    // bfcache navigation, which is most of how a tab actually goes away.
    hidePage();
    expect(framesOf(tab.wire.posted, "bye")).toHaveLength(1);

    tab.host.close();
    const settled = framesOf(tab.wire.posted, "bye").length;
    hidePage();
    // The listener goes with the timer — a page that hides after this host closed is no
    // longer its business, and the port it would speak through is already gone.
    expect(framesOf(tab.wire.posted, "bye")).toHaveLength(settled);
  });
});
