import { SharedRealtimeChannel } from "./shared-channel";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransportConfig,
  WireSourceFactory,
} from "./types";
import {
  ALIVE_EVERY_MS,
  WORKER_READY_MS,
  type TabMessage,
  type WorkerMessage,
} from "./worker/protocol";

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
 * The tab's liveness chatter: the `alive` timer and the `pagehide` goodbye.
 *
 * A SharedWorker is never told a port went away — closing a tab, navigating it, or
 * discarding it under memory pressure all leave a port that looks exactly like an idle one.
 * So a tab announces itself on a timer and says goodbye when it can. `pagehide` rather than
 * `beforeunload`: it is the one that fires on iOS and on a bfcache navigation.
 */
function keepPortAlive(send: (message: TabMessage) => void): {
  farewell: () => void;
  detach: () => void;
} {
  const alive = setInterval(() => send({ type: "alive" }), ALIVE_EVERY_MS);
  const farewell = (): void => send({ type: "bye" });
  const canListen = typeof window !== "undefined";
  if (canListen) window.addEventListener("pagehide", farewell);
  return {
    farewell,
    detach: () => {
      clearInterval(alive);
      if (canListen) window.removeEventListener("pagehide", farewell);
    },
  };
}

/**
 * Route the worker's frames to the tab's handlers, and report that it spoke at all.
 *
 * ANY recognised frame is proof of life, not just `ready`: a stale cached worker chunk from
 * before that verb existed still answers with a `status` the moment a tab subscribes, and
 * treating only `ready` as evidence would demote a worker that is demonstrably working.
 */
function forwardWorkerFrames(
  port: MessagePort,
  handlers: ChannelHostHandlers,
  onAnswer: () => void,
): void {
  port.onmessage = (event: MessageEvent) => {
    const data = event.data as WorkerMessage;
    if (!data?.type) return;
    onAnswer();
    if (data.type === "status") handlers.onStatusChange(data.status);
    else if (data.type === "event") handlers.onMessage(data.message);
  };
  port.start();
}

export interface SharedWorkerHostOptions {
  /** Where the connection goes if the worker never answers. */
  fallback: () => ChannelHost;
  /**
   * Told when the arrangement changed UNDER the caller (worker → page), so a health
   * readout and `useTopics().host` report what is actually carrying the connection.
   */
  onHostChange?: (kind: ChannelHost["kind"]) => void;
  /** Test seam; defaults to {@link WORKER_READY_MS}. */
  readyMs?: number;
}

/**
 * The connection in a SharedWorker, shared with every other tab on this endpoint.
 * `null` when no connector was configured or the platform will not give us one.
 *
 * ## A worker that starts and never answers is DETECTED, not assumed away
 *
 * `connect()` yielding a port proves nothing: `new SharedWorker(…)` succeeds even when the
 * script it names is not a script. That is measured, not hypothetical — Vite once inlined
 * the worker module as a `data:video/mp2t` URI of raw TypeScript, so the worker never
 * executed and its port never answered. The dangerous half of that bug is already
 * structurally impossible (`status` only advances when the worker posts one, so nothing
 * reports `connected`), but the subsystem was still silently lost for that host: permanent
 * `disconnected`, no error, no warning, and no degradation anywhere a person would look.
 *
 * So the worker posts `ready` on `onconnect` and this waits for ANY frame from it. If none
 * arrives, the port is closed and `options.fallback()` — the in-page host, which is fully
 * functional — takes over with the topics already asked for. An optimisation may never be
 * the reason a screen stops working, and "may never" is worth more as a timeout than as a
 * sentence in a docstring.
 */
export function createSharedWorkerHost(
  endpoint: string,
  handlers: ChannelHostHandlers,
  connect: WorkerConnector,
  options: SharedWorkerHostOptions,
): ChannelHost | null {
  const port = connect();
  if (!port) return null;

  // Container properties rather than closed-over `let`s: the flakiness gate is right that a
  // reassigned capture is hard to reason about, and these are read from three callbacks.
  const state = {
    answered: false,
    closed: false,
    /** The in-page host, once the worker has been given up on. */
    local: null as ChannelHost | null,
    /** The last union asked for, so a fallback starts where the worker left off. */
    topics: [] as readonly string[],
  };

  const send = (message: TabMessage): void => port.postMessage(message);
  const { farewell, detach } = keepPortAlive(send);

  /** Give up on the worker and run the connection in this page instead. */
  const fallBack = (): void => {
    if (state.answered || state.closed || state.local) return;
    detach();
    port.onmessage = null;
    port.close();
    const local = options.fallback();
    state.local = local;
    // Whatever was asked for while the worker was still being waited on. Replaying it is
    // the difference between a fallback and a restart.
    local.setTopics(state.topics);
    options.onHostChange?.(local.kind);
  };

  const readyTimer = setTimeout(fallBack, options.readyMs ?? WORKER_READY_MS);
  forwardWorkerFrames(port, handlers, () => {
    state.answered = true;
    clearTimeout(readyTimer);
  });

  return {
    // A getter, because this can change once: the contract is `readonly`, not constant.
    get kind(): ChannelHost["kind"] {
      return state.local?.kind ?? "shared-worker";
    },
    setTopics(topics) {
      state.topics = topics;
      if (state.local) {
        state.local.setTopics(topics);
        return;
      }
      send({ type: "subscribe", endpoint, topics: [...topics] });
    },
    close() {
      state.closed = true;
      clearTimeout(readyTimer);
      if (state.local) {
        state.local.close();
        return;
      }
      detach();
      farewell();
      port.close();
    },
  };
}
