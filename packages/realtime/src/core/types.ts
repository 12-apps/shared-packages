/**
 * Core types of the realtime pub/sub library.
 *
 * Three layers, each replaceable without touching the others (the same shape
 * as `@12-apps/jobs`):
 *   - TOPICS name a stream of related events (`./topics`) — tenant-scoped,
 *     colon-separated, e.g. `tenant:<clientId>:kitchen`.
 *   - The RUNTIME (`./runtime`) is the process-wide publish/subscribe entry
 *     point everything goes through.
 *   - A DRIVER moves the bytes. Redis pub/sub across processes in production,
 *     inline in-process delivery in dev/tests.
 *
 * Nothing here imports Redis, Prisma, React or the host app. The HTTP wire
 * (SSE today) lives in the host — this library deliberately knows nothing
 * about transports, so the wire can change without touching a publisher.
 */

/**
 * The logging port. Structurally satisfied by a winston logger (what the host
 * app has) and by `console` (what a test wants), so the library needs no
 * logging dependency of its own.
 */
export interface RealtimeLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/**
 * One event on a topic — the envelope every driver carries verbatim.
 *
 * ## The payload rule (same doctrine as job payloads)
 *
 * `data` carries IDENTIFIERS, never state: `{ ticketId }`, not the rendered
 * ticket. Realtime delivery is BEST-EFFORT — a subscriber that was offline for
 * two seconds missed those events forever, so the contract consumers build on
 * is "an event is a hint to re-read", never "the event is the data". The
 * database stays the source of truth and polling stays the fallback.
 */
export interface RealtimeEvent<TData = unknown> {
  /** Dot-namespaced event type, stable on the wire: `kitchen.ticket.updated`. */
  type: string;
  /** Identifiers only — see the payload rule above. */
  data: TData;
  /** Server timestamp (epoch ms), stamped by `publish`. */
  ts: number;
  /** Unique id for this emission (logging / client-side de-dup). */
  id: string;
}

/**
 * What a publisher provides — the runtime stamps `ts`, and `id` unless the
 * publisher supplies one.
 */
export interface RealtimeEventInput<TData = unknown> {
  type: string;
  data: TData;
  /**
   * Override the generated emission id.
   *
   * Exactly one caller has a reason to: the transactional OUTBOX
   * (`../server/outbox.ts`), whose publish is AT-LEAST-ONCE. A re-published row
   * is the SAME event, so it must carry the same id — otherwise a duplicate is
   * indistinguishable from a second, real change and a consumer that wanted to
   * de-duplicate has nothing stable to key on. Every other publisher leaves it
   * unset and gets a fresh per-process id.
   */
  id?: string;
}

/** A subscriber callback. Errors thrown here are caught and logged, never propagated to the publisher. */
export type RealtimeHandler = (topic: string, event: RealtimeEvent) => void;

/** Why a publish did not reach the bus. */
export type PublishSkipReason = "no-driver" | "invalid-topic" | "error";

/**
 * The result of a publish.
 *
 * Publishing NEVER throws (see `publishRealtimeEvent`): realtime is a latency
 * optimisation over polling, so a bus outage must degrade to "the client's
 * poll picks it up", not fail the request or job that emitted the event.
 */
export interface PublishResult {
  published: boolean;
  reason?: PublishSkipReason;
}

/** Detach one subscription. Idempotent. */
export type Unsubscribe = () => Promise<void>;

/**
 * The driver port. `inline` and `redis` implement it; a third (NATS,
 * Postgres LISTEN/NOTIFY) would need no change above this line.
 */
export interface RealtimeDriver {
  readonly kind: string;
  /** Deliver one event to every current subscriber of `topic`. Throws only on a real backend fault. */
  publish(topic: string, event: RealtimeEvent): Promise<void>;
  /**
   * Register `handler` for events on `topic`. Resolves once the subscription
   * is live (for Redis: the SUBSCRIBE has been confirmed), so a publish after
   * the resolve is guaranteed to be observed by a local subscriber.
   */
  subscribe(topic: string, handler: RealtimeHandler): Promise<Unsubscribe>;
  /** Release connections. Idempotent; in-flight handlers finish. */
  close(): Promise<void>;
}
