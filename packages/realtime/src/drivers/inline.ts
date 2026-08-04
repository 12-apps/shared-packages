/**
 * The INLINE driver: deliver events to subscribers in the calling process,
 * synchronously inside `publish`.
 *
 * For unit/integration tests (which boot PGlite and must not need a Redis
 * container) and for local development without `docker compose up`. In a
 * single-process dev stack it is a REAL bus: the inline jobs driver runs
 * handlers in-process too, so a job's `publish` reaches an open SSE stream in
 * the same process end-to-end.
 *
 * What it deliberately does NOT do is cross a process boundary — a separate
 * worker process publishing inline would be talking to itself. The host's
 * driver factory refuses it in production for exactly that reason.
 */

import type {
  RealtimeDriver,
  RealtimeEvent,
  RealtimeHandler,
  RealtimeLogger,
  Unsubscribe,
} from "../core/types";

interface InlineRealtimeDriverOptions {
  logger?: RealtimeLogger;
}

/** A record of what was published, for assertions. */
export interface InlinePublishRecord {
  topic: string;
  event: RealtimeEvent;
  /** How many local subscribers received it. */
  delivered: number;
}

export interface InlineRealtimeDriver extends RealtimeDriver {
  /** Every publish since the driver was created, in order. */
  readonly published: readonly InlinePublishRecord[];
  /** Forget the recorded publishes. */
  clearPublished(): void;
}

export function createInlineRealtimeDriver(
  options: InlineRealtimeDriverOptions = {},
): InlineRealtimeDriver {
  const logger = options.logger ?? console;
  const subscribers = new Map<string, Set<RealtimeHandler>>();
  const published: InlinePublishRecord[] = [];
  let closed = false;

  return {
    kind: "inline",
    published,
    clearPublished() {
      published.length = 0;
    },

    publish(topic: string, event: RealtimeEvent): Promise<void> {
      const handlers = subscribers.get(topic);
      const record: InlinePublishRecord = { topic, event, delivered: 0 };
      published.push(record);
      if (!handlers || closed) return Promise.resolve();
      for (const handler of [...handlers]) {
        try {
          handler(topic, event);
          record.delivered += 1;
        } catch (error) {
          // A broken subscriber must never fail the publisher (or starve its
          // sibling subscribers) — same rule the Redis driver gets for free
          // from the process boundary.
          logger.error(`subscriber for "${topic}" threw:`, error);
        }
      }
      return Promise.resolve();
    },

    subscribe(topic: string, handler: RealtimeHandler): Promise<Unsubscribe> {
      let handlers = subscribers.get(topic);
      if (!handlers) {
        handlers = new Set();
        subscribers.set(topic, handlers);
      }
      handlers.add(handler);
      return Promise.resolve(() => {
        const set = subscribers.get(topic);
        if (set) {
          set.delete(handler);
          if (set.size === 0) subscribers.delete(topic);
        }
        return Promise.resolve();
      });
    },

    close(): Promise<void> {
      closed = true;
      subscribers.clear();
      return Promise.resolve();
    },
  };
}
