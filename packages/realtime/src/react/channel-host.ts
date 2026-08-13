import { SharedRealtimeChannel } from "./shared-channel";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransportConfig,
  WireSourceFactory,
} from "./types";
import { ALIVE_EVERY_MS, type TabMessage, type WorkerMessage } from "./worker/protocol";

/**
 * Where the connection actually lives (FUT-660).
 *
 * ## Two hosts, one contract
 *
 * The provider says "these are the topics" and hears back frames and a status. It does
 * not care whether the connection is in this page or in a SharedWorker shared with every
 * other tab — and the two are deliberately interchangeable, because the worker is an
 * OPTIMISATION and must never be a dependency. No connector configured, an engine with
 * no SharedWorker, a CSP that forbids worker scripts, a test environment: the in-page
 * host runs and nothing above notices.
 *
 * That is also why the tab keeps its registry either way. Routing events to screens
 * stays where the screens are; the worker only ever knows a topic list.
 */

/** Not exported: both hosts take it, and a caller builds it as a literal. */
interface ChannelHostHandlers {
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
}

export interface ChannelHost {
  setTopics(topics: readonly string[]): void;
  close(): void;
  /** Which arrangement this is — for a health readout, and for the harness's proof. */
  readonly kind: "in-page" | "shared-worker";
}

/** How a host reaches its SharedWorker. `null` means "not available; use the page". */
export type WorkerConnector = () => MessagePort | null;

/**
 * Wrap a HOST's SharedWorker construction in the capability guard.
 *
 * ## Why the host performs the `new SharedWorker(...)`, and not this function
 *
 * `new SharedWorker(new URL("./worker.ts", import.meta.url), { type: "module" })` is a BUILD
 * instruction as much as a runtime one: bundlers pattern-match that whole expression and emit
 * the target as its own COMPILED worker chunk. Split it up and the match is lost — and it is
 * lost in the worst possible way.
 *
 * That was MEASURED, not guessed. An earlier version of this seam took `() => new URL(…)` and
 * constructed the worker here. Vite saw a lone `new URL("../realtime/worker.ts",
 * import.meta.url)` in the host module, treated it as an ASSET reference, and inlined the file
 * as `data:video/mp2t;base64,…` — the raw, uncompiled TypeScript. The worker would then never
 * execute, so its port never answered, so every tab sat `disconnected` while
 * `useTopics().host` reported `shared-worker`. A screen that believes it is live while
 * receiving nothing is the exact failure this subsystem exists to prevent, and NO runtime
 * fallback can catch it: the construction succeeds.
 *
 * So the host passes a thunk that performs the construction, keeping the literal where its own
 * bundler can see it, and this function contributes only what a host should not have to
 * repeat: the capability check and the swallow. An engine without `SharedWorker`, a CSP that
 * forbids worker scripts, a browser that will not build a module worker — all answer `null`,
 * and the caller runs the in-page host. An optimisation may never be the reason a screen stops
 * working.
 *
 *     connectWorker: sharedWorkerConnector(
 *       () => new SharedWorker(new URL("./realtime-worker.ts", import.meta.url), {
 *         type: "module",
 *         name: "realtime-events",
 *       }),
 *     )
 */
export function sharedWorkerConnector(spawn: () => SharedWorker): WorkerConnector {
  return () => {
    if (typeof SharedWorker === "undefined") return null;
    try {
      return spawn().port;
    } catch {
      return null;
    }
  };
}

export interface LocalHostOptions {
  transport?: RealtimeTransportConfig;
  createSource?: WireSourceFactory;
  random?: () => number;
}

/** The connection in this page — the FUT-659 arrangement. */
export function createLocalHost(
  endpoint: string,
  handlers: ChannelHostHandlers,
  options: LocalHostOptions = {},
): ChannelHost {
  const channel = new SharedRealtimeChannel({ endpoint, ...options, ...handlers });
  return {
    kind: "in-page",
    setTopics: (topics) => channel.setTopics(topics),
    close: () => channel.close(),
  };
}

/**
 * The connection in a SharedWorker, shared with every other tab on this endpoint.
 * `null` when no connector was configured or the platform will not give us one.
 */
export function createSharedWorkerHost(
  endpoint: string,
  handlers: ChannelHostHandlers,
  connect: WorkerConnector,
): ChannelHost | null {
  const port = connect();
  if (!port) return null;

  const send = (message: TabMessage): void => port.postMessage(message);
  port.onmessage = (event: MessageEvent) => {
    const data = event.data as WorkerMessage;
    if (data?.type === "status") handlers.onStatusChange(data.status);
    else if (data?.type === "event") handlers.onMessage(data.message);
  };
  port.start();

  // The worker is never told a port went away, so a tab says so on its way out and
  // announces itself on a timer in case it cannot. `pagehide` rather than
  // `beforeunload`: it is the one that fires on iOS and on a bfcache navigation.
  const alive = setInterval(() => send({ type: "alive" }), ALIVE_EVERY_MS);
  const farewell = (): void => send({ type: "bye" });
  const canListen = typeof window !== "undefined";
  if (canListen) window.addEventListener("pagehide", farewell);

  return {
    kind: "shared-worker",
    setTopics(topics) {
      send({ type: "subscribe", endpoint, topics: [...topics] });
    },
    close() {
      clearInterval(alive);
      if (canListen) window.removeEventListener("pagehide", farewell);
      farewell();
      port.close();
    },
  };
}
