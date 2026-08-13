/// <reference lib="webworker" />
import { SharedRealtimeChannel } from "../shared-channel";
import type { RealtimeTransportConfig } from "../types";

import { WorkerHub } from "./hub";
import { SWEEP_EVERY_MS } from "./protocol";

/**
 * `@12-apps/realtime/worker` — the SharedWorker body (FUT-660). Wiring only: every rule
 * lives in `./hub.ts`, which knows nothing about worker globals and is tested without
 * one.
 *
 * ## Why the HOST owns the worker file and this is only its body
 *
 * A SharedWorker is a separate script, and getting a browser to load one is a BUILD
 * instruction as much as a runtime one: bundlers detect `new SharedWorker(new URL("…",
 * import.meta.url))` literally and emit that module as its own chunk. A published
 * package cannot portably do that for a consumer — the URL would have to resolve
 * inside `node_modules`, through whatever bundler the host happens to use, and a
 * failure there is a BUILD failure, not something the runtime fallback can catch.
 *
 * So the split is: the host writes a two-line worker module its own bundler compiles,
 *
 *     // src/realtime-worker.ts
 *     import { startRealtimeWorker } from "@12-apps/realtime/worker";
 *     startRealtimeWorker();
 *
 * and hands `createWebEvents` a connector for it:
 *
 *     connectWorker: sharedWorkerConnector(
 *       () => new URL("./realtime-worker.ts", import.meta.url),
 *     )
 *
 * Without a connector the connection lives in the page, which is fully functional —
 * the worker is an OPTIMISATION and may never be the reason a screen stops working.
 *
 * ## Why a SharedWorker and not a Service Worker
 *
 * A Service Worker is the wrong primitive for a held connection: browsers terminate an
 * idle one aggressively, and an open WebSocket is not a reason to keep it alive. The
 * channel would die and resurrect on its own — strictly worse than a connection owned
 * by the page. A SharedWorker lives as long as a port is attached, which is exactly the
 * lifetime wanted here.
 *
 * ## Everything the channel needs is available here
 *
 * `WebSocket`, `EventSource` and `fetch` are all exposed to workers, and a same-origin
 * `fetch` from a worker carries the session cookie — so the ticket round trip is the
 * same authenticated request it is in the page. Nothing about the connection had to be
 * reimplemented: `SharedRealtimeChannel` runs here unchanged, and the paging it does
 * over `MAX_TOPICS_PER_TICKET` matters more here, because the union is across TABS
 * rather than across one page's screens.
 */

export interface RealtimeWorkerOptions {
  /**
   * Where the ws/ticket endpoints live, when they are not the defaults.
   *
   * A worker reads `location`, which is its own script URL and therefore the same
   * origin as the tabs that spawned it — so the DEFAULTS are correct for the ordinary
   * same-origin arrangement and this is only needed by a host that moved either
   * endpoint. It has to be passed again here because a worker shares no closure with
   * the page: whatever `createWebEvents` was configured with is not visible from
   * inside this script.
   */
  transport?: RealtimeTransportConfig;
}

/** The worker global this entry installs itself on. */
interface SharedWorkerScope {
  onconnect: ((event: { ports: readonly MessagePort[] }) => void) | null;
}

/**
 * Install the hub on this worker's `onconnect`, and start the port sweep.
 *
 * Returns the hub so a host (or a test) can inspect it; the return value is normally
 * ignored.
 */
export function startRealtimeWorker(options: RealtimeWorkerOptions = {}): WorkerHub {
  const hub = new WorkerHub(
    (endpoint, handlers) =>
      new SharedRealtimeChannel({
        endpoint,
        transport: options.transport,
        onMessage: handlers.onMessage,
        onStatusChange: handlers.onStatusChange,
      }),
  );

  const scope = self as unknown as SharedWorkerScope;
  scope.onconnect = (event) => {
    const port = event.ports[0];
    if (!port) return;
    hub.connect(port, Date.now());
    port.onmessage = (message: MessageEvent) => hub.handle(port, message.data, Date.now());
    port.start();
  };

  setInterval(() => hub.sweep(Date.now()), SWEEP_EVERY_MS);

  return hub;
}
